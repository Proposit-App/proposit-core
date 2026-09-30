import type { TCorePropositionalExpression } from "../../schemata/index.js"
import {
    CONTESTED,
    type TCoreDerivationStep,
    type TCoreExpressionAssignment,
    type TCorePropagationOptions,
    type TCoreQuadrivalentValue,
    type TCoreResolvedVariableValues,
    type TCoreVariableProvenance,
} from "../../types/evaluation.js"
import type { TArgumentEvaluationContext } from "./argument-evaluation.js"
import {
    belnapAnd,
    belnapNot,
    belnapOr,
    belnapXor,
    belnapImplies,
    belnapIff,
    hasFalseComponent,
    hasTrueComponent,
    joinKnowledge,
} from "./belnap.js"

/**
 * Run constraint propagation to a fixed point over the operators the reader
 * accepted, filling in variable values the granted steps force.
 *
 * Only acceptances propagate. A rejection is not a truth value: it strikes the
 * premise it lives in, and the caller excludes that premise here via
 * `options.excludedPremiseIds` — so nothing inside a struck premise
 * contributes, and no value is ever forced `false` by a refusal.
 *
 * Each step **merges** what it forces into the variable's current value rather
 * than overwriting it or declining to write, so two steps that force opposite
 * values leave the variable `CONTESTED` instead of letting whichever step ran
 * first decide. That merge is the join of the knowledge order, every rule's
 * trigger is monotone in that same order, and the state space is finite — so
 * the sweep converges to the least fixed point above the reader's assignment
 * and reaches it whatever order premises, expressions and rules are visited
 * in.
 *
 * Each rule moves **one truth component in one direction**, and that is not
 * decoration: an accepted `A → B` fires forward on `A` being told true and
 * merges told-true into `B`, and backward on `B` being told false merging
 * told-false into `A`. Transferring both components at once would read the
 * conditional as a biconditional and derive `B` false from `A` false. The
 * one-directional pairing is what a material implication licenses; only `iff`
 * carries both components both ways.
 *
 * Because only the told-true component travels forward, a contested variable
 * can produce an uncontested `true` downstream and leave every aggregate fact
 * reading clean. `evaluateArgument` reports `contestedVariableIds` so a
 * conflict is never inferred from the aggregates. Attribution's counterfactual depends on that: withholding an assertion
 * and re-closing must give one answer, and must not let mutually supporting
 * premises certify each other.
 *
 * A reader's own assertion takes part in the merge like any other source. If
 * the reader asserts a value that a granted step contradicts, the result is
 * `CONTESTED` — the conflict is reported, not silently resolved in either
 * direction.
 *
 * Axiomatic-bound variables are forced to `true` by `ArgumentEngine`'s
 * pre-pass before this function runs, and are merged on the same footing.
 */
export function propagateOperatorConstraints(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCorePropagationOptions
): TCoreResolvedVariableValues {
    return closeUnderAcceptedOperators(ctx, assignment, options).variables
}

/**
 * `propagateOperatorConstraints` plus the provenance of every value it saw or
 * produced. The two share one closure, so a tag is recorded where the value is
 * actually set rather than reconstructed afterwards.
 */
export function closeUnderAcceptedOperators(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCorePropagationOptions
): {
    variables: TCoreResolvedVariableValues
    provenance: Record<string, TCoreVariableProvenance>
} {
    const vars: TCoreResolvedVariableValues = { ...assignment.variables }
    for (const variableId of options?.withheldVariableIds ?? []) {
        delete vars[variableId]
    }
    const opAssignments = assignment.operatorAssignments
    const excludedPremiseIds = options?.excludedPremiseIds

    // Collect all expressions across all premises, indexed by id
    const exprById = new Map<string, TCorePropositionalExpression>()
    // Expression id -> the premise it belongs to
    const premiseIdOf = new Map<string, string>()
    // Children lookup: parentId -> sorted children
    const childrenOf = new Map<string, TCorePropositionalExpression[]>()

    for (const pm of ctx.listPremises()) {
        if (excludedPremiseIds?.has(pm.getId())) continue
        for (const expr of pm.getExpressions()) {
            exprById.set(expr.id, expr)
            premiseIdOf.set(expr.id, pm.getId())
            // Build children map using getChildExpressions for each operator/formula
            if (expr.type === "operator" || expr.type === "formula") {
                childrenOf.set(expr.id, pm.getChildExpressions(expr.id))
            }
        }
    }

    /**
     * Resolve the current four-valued value of an expression subtree given the
     * current variable assignments. Does not force-accept nested operators —
     * evaluates them normally.
     */
    const resolveValue = (exprId: string): TCoreQuadrivalentValue => {
        const expr = exprById.get(exprId)
        if (!expr) return null

        if (expr.type === "variable") {
            return vars[expr.variableId] ?? null
        }

        if (expr.type === "formula") {
            const children = childrenOf.get(expr.id) ?? []
            return children.length > 0 ? resolveValue(children[0].id) : null
        }

        // operator
        const op = expr.operator
        const children = childrenOf.get(expr.id) ?? []

        // Arity is guarded rather than assumed: this function is reachable
        // from the exported closure, which a caller may hand a tree that
        // never passed `validateEvaluability()`.
        switch (op) {
            case "not":
                return children.length > 0
                    ? belnapNot(resolveValue(children[0].id))
                    : null
            case "and":
                return children.reduce<TCoreQuadrivalentValue>(
                    (acc, child) => belnapAnd(acc, resolveValue(child.id)),
                    true
                )
            case "or":
                return children.reduce<TCoreQuadrivalentValue>(
                    (acc, child) => belnapOr(acc, resolveValue(child.id)),
                    false
                )
            case "xor":
                return children.reduce<TCoreQuadrivalentValue>(
                    (acc, child) => belnapXor(acc, resolveValue(child.id)),
                    false
                )
            case "implies": {
                return children.length >= 2
                    ? belnapImplies(
                          resolveValue(children[0].id),
                          resolveValue(children[1].id)
                      )
                    : null
            }
            case "iff": {
                return children.length >= 2
                    ? belnapIff(
                          resolveValue(children[0].id),
                          resolveValue(children[1].id)
                      )
                    : null
            }
        }
    }

    /**
     * Unwrap formula wrappers to find the leaf variable expression.
     * Returns the variableId if the leaf is a variable, otherwise null.
     */
    const resolveLeafVariableId = (
        expr: TCorePropositionalExpression
    ): string | null => {
        if (expr.type === "variable") {
            return expr.variableId
        }
        if (expr.type === "formula") {
            const children = childrenOf.get(expr.id) ?? []
            if (children.length > 0) {
                return resolveLeafVariableId(children[0])
            }
        }
        return null
    }

    /** Variable IDs in an expression subtree that currently hold a value. */
    const collectValuedVariableIds = (exprId: string): string[] => {
        const expr = exprById.get(exprId)
        if (!expr) return []
        if (expr.type === "variable") {
            return (vars[expr.variableId] ?? null) === null
                ? []
                : [expr.variableId]
        }
        return (childrenOf.get(expr.id) ?? []).flatMap((child) =>
            collectValuedVariableIds(child.id)
        )
    }

    // Variable IDs the reader supplied a value for. Propagation merges into
    // them like any other source; the set only tags provenance.
    const userAssigned = new Set<string>()
    for (const [varId, val] of Object.entries(vars)) {
        if (val !== null && val !== undefined) userAssigned.add(varId)
    }

    /**
     * Every granted step that contributed a component to a variable, keyed by
     * the step's expression and the value it forced. A step is recorded each
     * time its rule fires, whether or not the merge changed anything, and the
     * record is overwritten — so at the fixed point every entry carries
     * `fromVariableIds` read off the converged state rather than off whatever
     * was known the first time the rule happened to run.
     */
    const contributions = new Map<
        string,
        Map<string, { step: TCoreDerivationStep; value: boolean }>
    >()

    /**
     * Merge a value into a child expression's leaf variable and record the
     * step that forced it. Returns true iff the variable gained a component
     * it did not already have.
     */
    const mergeIntoChild = (
        child: TCorePropositionalExpression,
        value: boolean,
        step: TCoreDerivationStep
    ): boolean => {
        const varId = resolveLeafVariableId(child)
        if (varId == null) return false

        let byStep = contributions.get(varId)
        if (!byStep) {
            byStep = new Map()
            contributions.set(varId, byStep)
        }
        byStep.set(`${step.expressionId}|${String(value)}`, { step, value })

        const current = vars[varId] ?? null
        const merged = joinKnowledge(current, value)
        if (merged === current) return false
        vars[varId] = merged
        return true
    }

    // One pass over accepted operators; a rejection propagates nothing. Every
    // trigger below reads a truth *component* rather than an exact value, so
    // it can only start holding as the closure learns more, never stop.
    let changed = true
    while (changed) {
        changed = false

        for (const [exprId, expr] of exprById) {
            if (expr.type !== "operator") continue
            if (opAssignments[exprId] !== "accepted") continue

            const op = expr.operator
            const children = childrenOf.get(exprId) ?? []
            const stepFrom = (
                consumedExpressionIds: string[]
            ): TCoreDerivationStep => ({
                expressionId: exprId,
                premiseId: premiseIdOf.get(exprId)!,
                fromVariableIds: [
                    ...new Set(
                        consumedExpressionIds.flatMap(collectValuedVariableIds)
                    ),
                ],
            })

            switch (op) {
                case "not": {
                    // ¬A accepted (= true) => child must be false
                    if (children.length > 0) {
                        if (mergeIntoChild(children[0], false, stepFrom([])))
                            changed = true
                    }
                    break
                }
                case "and": {
                    // A ∧ B accepted => all children must be true
                    for (const child of children) {
                        if (mergeIntoChild(child, true, stepFrom([])))
                            changed = true
                    }
                    break
                }
                case "or": {
                    // A ∨ B accepted: a child whose every sibling is known
                    // false must itself be true.
                    const isFalse = children.map((child) =>
                        hasFalseComponent(resolveValue(child.id))
                    )
                    for (const [index, child] of children.entries()) {
                        const siblingsAllFalse = isFalse.every(
                            (value, other) => other === index || value
                        )
                        if (!siblingsAllFalse) continue
                        const consumed = children
                            .filter((_, other) => other !== index)
                            .map((sibling) => sibling.id)
                        if (mergeIntoChild(child, true, stepFrom(consumed)))
                            changed = true
                    }
                    break
                }
                case "xor": {
                    // A ⊻ B ⊻ C accepted (= odd parity): a child is determined
                    // exactly when its siblings are. Each sibling readable only
                    // one way fixes a parity bit, and the child takes whatever
                    // remainder makes the count odd. A sibling readable *both*
                    // ways leaves both parities open, so both answers merge in
                    // and the child lands on CONTESTED. A sibling readable
                    // neither way carries no parity at all, and nothing is
                    // forced — parity depends on every operand, so one unknown
                    // operand hides the whole relation.
                    //
                    // Both triggers read truth components, which the closure
                    // only ever gains. A later pass can therefore add a forced
                    // value but never retract one — including when a sibling
                    // becomes readable both ways, whose CONTESTED answer
                    // subsumes the single value an earlier pass merged. That is
                    // what keeps the closure monotone, and so order-independent.
                    for (const [index, child] of children.entries()) {
                        const siblings = children.filter(
                            (_, other) => other !== index
                        )
                        const siblingValues = siblings.map((sibling) =>
                            resolveValue(sibling.id)
                        )
                        const everySiblingReadable = siblingValues.every(
                            (value) =>
                                hasTrueComponent(value) ||
                                hasFalseComponent(value)
                        )
                        if (!everySiblingReadable) continue

                        const step = stepFrom(
                            siblings.map((sibling) => sibling.id)
                        )
                        const anySiblingAmbiguous = siblingValues.some(
                            (value) =>
                                hasTrueComponent(value) &&
                                hasFalseComponent(value)
                        )
                        if (anySiblingAmbiguous) {
                            if (mergeIntoChild(child, true, step))
                                changed = true
                            if (mergeIntoChild(child, false, step))
                                changed = true
                            continue
                        }

                        const trueSiblings =
                            siblingValues.filter(hasTrueComponent).length
                        if (mergeIntoChild(child, trueSiblings % 2 === 0, step))
                            changed = true
                    }
                    break
                }
                case "implies": {
                    // A → B accepted: A true => B true; B false => A false
                    if (children.length >= 2) {
                        const leftValue = resolveValue(children[0].id)
                        const rightValue = resolveValue(children[1].id)
                        if (hasTrueComponent(leftValue)) {
                            if (
                                mergeIntoChild(
                                    children[1],
                                    true,
                                    stepFrom([children[0].id])
                                )
                            )
                                changed = true
                        }
                        if (hasFalseComponent(rightValue)) {
                            if (
                                mergeIntoChild(
                                    children[0],
                                    false,
                                    stepFrom([children[1].id])
                                )
                            )
                                changed = true
                        }
                    }
                    break
                }
                case "iff": {
                    // A ↔ B accepted: each side carries its components across
                    if (children.length >= 2) {
                        const sides: [
                            TCorePropositionalExpression,
                            TCorePropositionalExpression,
                        ][] = [
                            [children[0], children[1]],
                            [children[1], children[0]],
                        ]
                        for (const [source, target] of sides) {
                            const sourceValue = resolveValue(source.id)
                            const step = stepFrom([source.id])
                            if (hasTrueComponent(sourceValue)) {
                                if (mergeIntoChild(target, true, step))
                                    changed = true
                            }
                            if (hasFalseComponent(sourceValue)) {
                                if (mergeIntoChild(target, false, step))
                                    changed = true
                            }
                        }
                    }
                    break
                }
            }
        }
    }

    /** Stable step order, so provenance never depends on visitation order. */
    const sortSteps = (
        entries: { step: TCoreDerivationStep; value: boolean }[]
    ): TCoreDerivationStep[] =>
        [...entries]
            .sort(
                (a, b) =>
                    a.step.premiseId.localeCompare(b.step.premiseId) ||
                    a.step.expressionId.localeCompare(b.step.expressionId) ||
                    String(a.value).localeCompare(String(b.value))
            )
            .map((entry) => entry.step)

    const provenance: Record<string, TCoreVariableProvenance> = {}
    for (const varId of new Set([
        ...Object.keys(vars),
        ...contributions.keys(),
    ])) {
        const value = vars[varId] ?? null
        const steps = sortSteps([...(contributions.get(varId)?.values() ?? [])])
        if (value === CONTESTED) {
            provenance[varId] = {
                value,
                origin: "contested",
                contestedBy: steps,
            }
        } else if (userAssigned.has(varId)) {
            provenance[varId] = { value, origin: "asserted" }
        } else if (value !== null && steps.length > 0) {
            provenance[varId] = {
                value,
                origin: "derived",
                derivedBy: steps[0],
            }
        } else {
            provenance[varId] = { value, origin: "unassigned" }
        }
    }

    return { variables: vars, provenance }
}
