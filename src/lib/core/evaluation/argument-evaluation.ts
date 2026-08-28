import {
    isClaimBound,
    isPremiseBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import {
    CONTESTED,
    type TCoreArgumentEvaluationOptions,
    type TCoreArgumentEvaluationResult,
    type TCoreCounterexample,
    type TCoreDerivationStep,
    type TCoreExpressionAssignment,
    type TCorePropagationOptions,
    type TCoreQuadrivalentValue,
    type TCoreResolvedAssignment,
    type TCoreResolvedVariableValues,
    type TCoreValueAttribution,
    type TCoreValidityCheckOptions,
    type TCoreValidityCheckResult,
    type TCoreVariableProvenance,
    type TCorePremiseEvaluationResult,
    type TCoreValidationResult,
} from "../../types/evaluation.js"
import {
    belnapAnd,
    belnapNot,
    belnapOr,
    belnapImplies,
    belnapIff,
    hasFalseComponent,
    hasTrueComponent,
    joinKnowledge,
} from "./belnap.js"
import { createPremiseBoundResolver } from "./premise-resolver.js"
import { isPremiseSetSatisfiable } from "./satisfiability.js"
import { makeErrorIssue, makeValidationResult } from "./validation.js"

/**
 * Read-only interface providing the data an evaluation needs from an
 * argument engine. This is intentionally narrow — evaluation should
 * not mutate anything.
 */
export interface TArgumentEvaluationContext {
    /** The argument's own ID. */
    argumentId: string
    /** Returns the conclusion PremiseEngine, or undefined. */
    getConclusionPremise(): TEvaluablePremise | undefined
    /** Returns supporting premises (inference premises minus conclusion). */
    listSupportingPremises(): TEvaluablePremise[]
    /** Returns all premises. */
    listPremises(): TEvaluablePremise[]
    /** The conclusion premise ID, if set. */
    conclusionPremiseId: string | undefined
    /** Look up a variable by ID. */
    getVariable(variableId: string): TCorePropositionalVariable | undefined
    /** Look up a premise by ID. */
    getPremise(premiseId: string): TEvaluablePremise | undefined
    /** Pre-evaluation structural validation. */
    validateEvaluability(): TCoreValidationResult
}

/**
 * Narrow view of a PremiseEngine needed for evaluation.
 */
export interface TEvaluablePremise {
    getId(): string
    /**
     * The premise entity's `type`. Derivation premises are engine wiring
     * rather than a user-authored inferential step, so a rejection recorded
     * inside one never strikes it. Optional: an implementation that omits it
     * is treated as a freeform premise.
     */
    getPremiseType?(): string
    getExpressions(): TCorePropositionalExpression[]
    getChildExpressions(parentId: string): TCorePropositionalExpression[]
    getVariables(): TCorePropositionalVariable[]
    /**
     * Evaluate this premise under an assignment.
     *
     * **The result must depend only on the variables this premise reaches** —
     * those named by `getExpressions()`, plus, transitively, those reached by
     * the premise behind any internally premise-bound variable among them.
     * Reading a variable outside that set is outside the contract even though
     * the whole assignment is in scope, and the type cannot express the
     * restriction.
     *
     * It is load-bearing rather than tidy: the satisfiability search splits the
     * premises into groups that share no reachable variable and walks each over
     * its own columns alone. A premise that consults a variable it does not
     * reach is walked without that variable varying, so it can report
     * satisfiable for a set that is not — which suppresses, or fails to
     * suppress, derivation across the whole argument.
     */
    evaluate(
        assignment: TCoreResolvedAssignment,
        options?: {
            strictUnknownKeys?: boolean
            resolver?: (variableId: string) => TCoreQuadrivalentValue
        }
    ): TCorePremiseEvaluationResult
    /**
     * Returns the operator expressions a reviewer can accept or reject,
     * in pre-order tree order. Excludes `"not"` operators and skips
     * formula nodes. See `TExpressionQueries.getDecidableOperatorExpressions`
     * on the full `PremiseEngine` for the authoritative contract.
     */
    getDecidableOperatorExpressions(): TCorePropositionalExpression[]
}

/**
 * Evaluate an expression subtree under a fixed variable assignment, using the
 * four-valued Belnap connectives.
 *
 * Total and side-effect free: unknown/missing variables and empty operators
 * yield `null`, and `formula` wrappers pass through to their single child.
 * Unlike `PremiseEngine.evaluate`, it never throws on a non-evaluable tree —
 * so callers deriving display-time defaults can evaluate a subtree of an
 * argument that is not yet fully evaluable.
 *
 * The operator base cases (`and` seeds `true`, `or` seeds `false`) match
 * `propagateOperatorConstraints`' internal resolver so the two agree.
 */
export function evaluateSubtree(
    rootExpressionId: string,
    getExpression: (id: string) => TCorePropositionalExpression | undefined,
    getChildren: (parentId: string) => TCorePropositionalExpression[],
    variables: TCoreResolvedVariableValues
): TCoreQuadrivalentValue {
    const expr = getExpression(rootExpressionId)
    if (!expr) return null

    if (expr.type === "variable") {
        return variables[expr.variableId] ?? null
    }

    const recurse = (
        child: TCorePropositionalExpression
    ): TCoreQuadrivalentValue =>
        evaluateSubtree(child.id, getExpression, getChildren, variables)
    const children = getChildren(expr.id)

    if (expr.type === "formula") {
        return children.length > 0 ? recurse(children[0]) : null
    }

    switch (expr.operator) {
        case "not":
            return children.length > 0 ? belnapNot(recurse(children[0])) : null
        case "and":
            return children.reduce<TCoreQuadrivalentValue>(
                (acc, child) => belnapAnd(acc, recurse(child)),
                true
            )
        case "or":
            return children.reduce<TCoreQuadrivalentValue>(
                (acc, child) => belnapOr(acc, recurse(child)),
                false
            )
        case "implies":
            return children.length >= 2
                ? belnapImplies(recurse(children[0]), recurse(children[1]))
                : null
        case "iff":
            return children.length >= 2
                ? belnapIff(recurse(children[0]), recurse(children[1]))
                : null
        default:
            return null
    }
}

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

/**
 * Evaluates an argument under a three-valued expression assignment.
 */
export function evaluateArgument(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCoreArgumentEvaluationOptions
): TCoreArgumentEvaluationResult {
    const validateFirst = options?.validateFirst ?? true
    if (validateFirst) {
        const validation = ctx.validateEvaluability()
        if (!validation.ok) {
            return {
                ok: false,
                validation,
            }
        }
    }

    const conclusion = ctx.getConclusionPremise()
    if (!conclusion) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ARGUMENT_NO_CONCLUSION",
                    message: "Argument has no designated conclusion premise.",
                }),
            ]),
        }
    }

    const supportingPremises = ctx.listSupportingPremises()
    const supportingIds = new Set(supportingPremises.map((pm) => pm.getId()))
    const constraintPremises = ctx
        .listPremises()
        .filter(
            (pm) =>
                pm.getId() !== ctx.conclusionPremiseId &&
                !supportingIds.has(pm.getId())
        )

    const allRelevantPremises = [
        conclusion,
        ...supportingPremises,
        ...constraintPremises,
    ]
    const allVariableIds = [
        ...new Set(
            allRelevantPremises.flatMap((pm) =>
                pm
                    .getExpressions()
                    .filter((expr) => expr.type === "variable")
                    .map((expr) => expr.variableId)
            )
        ),
    ].sort()

    // Claim-bound and externally-bound premise variables get truth-table columns;
    // internally-bound premise variables are resolved lazily.
    const referencedVariableIds = allVariableIds.filter((vid) => {
        const v = ctx.getVariable(vid)
        if (v == null) return false
        if (isClaimBound(v)) return true
        if (isPremiseBound(v) && v.boundArgumentId !== ctx.argumentId)
            return true
        return false
    })

    // A rejection strikes the premise it lives in: that premise stops
    // constraining the evaluation and asserts nothing. The conclusion premise
    // and derivation premises are exempt — a rejection recorded against
    // either is ignored, and observably so, because the struck set is
    // reported.
    const struckPremiseIds = allRelevantPremises
        .filter(
            (pm) =>
                pm.getId() !== ctx.conclusionPremiseId &&
                pm.getPremiseType?.() !== "derivation" &&
                pm
                    .getExpressions()
                    .some(
                        (expr) =>
                            assignment.operatorAssignments[expr.id] ===
                            "rejected"
                    )
        )
        .map((pm) => pm.getId())
    const struckIds = new Set(struckPremiseIds)

    try {
        const premiseSetSatisfiable =
            options?.premiseSetSatisfiable !== undefined
                ? options.premiseSetSatisfiable
                : isPremiseSetSatisfiable(ctx, {
                      premises: [
                          ...supportingPremises,
                          ...constraintPremises,
                      ].filter((pm) => !struckIds.has(pm.getId())),
                      freeVariableIds: referencedVariableIds,
                      // Deliberately not `forcedTrueVariableIds`. That set
                      // also decides what counts as a reader's assertion, and
                      // a citation belongs in this question but not that one.
                      forcedTrueVariableIds:
                          options?.satisfiabilityForcedTrueVariableIds ??
                          options?.forcedTrueVariableIds,
                  })

        // Contradicting premises license nothing: exclude every premise from
        // the closure so the reader is shown only what they asserted.
        const derivationSuppressed = premiseSetSatisfiable === false
        const closureExclusions = derivationSuppressed
            ? new Set(ctx.listPremises().map((pm) => pm.getId()))
            : struckIds
        const propagation = closeUnderAcceptedOperators(ctx, assignment, {
            excludedPremiseIds: closureExclusions,
        })
        const propagatedAssignment: TCoreResolvedAssignment = {
            variables: propagation.variables,
            operatorAssignments: assignment.operatorAssignments,
        }

        const resolver = createPremiseBoundResolver(ctx, propagatedAssignment)

        const evalOpts = {
            strictUnknownKeys: options?.strictUnknownAssignmentKeys ?? false,
            resolver,
        }
        const conclusionEvaluation = conclusion.evaluate(
            propagatedAssignment,
            evalOpts
        )
        const supportingEvaluations = supportingPremises.map((pm) =>
            pm.evaluate(propagatedAssignment, evalOpts)
        )
        const constraintEvaluations = constraintPremises.map((pm) =>
            pm.evaluate(propagatedAssignment, evalOpts)
        )

        const surviving = (
            results: TCorePremiseEvaluationResult[]
        ): TCorePremiseEvaluationResult[] =>
            results.filter((result) => !struckIds.has(result.premiseId))

        const isAdmissibleAssignment = surviving(
            constraintEvaluations
        ).reduce<TCoreQuadrivalentValue>(
            (acc, result) => belnapAnd(acc, result.rootValue ?? null),
            true
        )
        // A derivation premise is engine-synthesized wiring: it records
        // that a claim follows from its citation or axiom, not something the
        // author offered in support of the conclusion. The exclusion is by
        // premise type on purpose — `listSupportingPremises` selects on
        // `isInference()`, true of any implies/iff root, which cannot tell a
        // populated derivation premise from authored support. Without this, a
        // reader's answer about a claim no authored premise references moves
        // the aggregate.
        const derivationPremiseIds = new Set(
            supportingPremises
                .filter((pm) => pm.getPremiseType?.() === "derivation")
                .map((pm) => pm.getId())
        )
        const authoredSupport = supportingEvaluations.filter(
            (result) => !derivationPremiseIds.has(result.premiseId)
        )
        const survivingSupport = surviving(authoredSupport)
        const survivingSupportingPremisesTrue =
            survivingSupport.reduce<TCoreQuadrivalentValue>(
                (acc, result) => belnapAnd(acc, result.rootValue ?? null),
                true
            )
        const conclusionTrue: TCoreQuadrivalentValue =
            conclusionEvaluation.rootValue ?? null
        // `survivingSupportingPremisesTrue` folds an empty list to `true`, so
        // when the reader struck every supporting premise there is no case left
        // to weigh — say so rather than reporting that the premises held and
        // the conclusion failed. An argument authored with no supporting
        // premises is the entailment-from-nothing case and keeps its answer.
        const allSupportStruck =
            authoredSupport.length > 0 && survivingSupport.length === 0
        const premisesHoldConclusionFalse = allSupportStruck
            ? null
            : belnapAnd(
                  isAdmissibleAssignment,
                  belnapAnd(
                      survivingSupportingPremisesTrue,
                      belnapNot(conclusionTrue)
                  )
              )

        // Reported unconditionally, not behind `includeDiagnostics`: a
        // contested value can leave every aggregate above reading clean, so
        // this is the only fact that always records one.
        const contestedVariableIds = Object.entries(propagation.provenance)
            .filter(([, entry]) => entry.value === CONTESTED)
            .map(([variableId]) => variableId)
            .sort()

        const includeExpressionValues = options?.includeExpressionValues ?? true
        const includeDiagnostics = options?.includeDiagnostics ?? true

        // Attribution: withhold an assertion, recompute closure from what is
        // left, and ask again. Never delete a tag from an already-derived
        // value — the intervention has to be re-derived, not un-derived.
        const forcedTrueVariableIds = options?.forcedTrueVariableIds
        const isReaderAsserted = (variableId: string): boolean =>
            forcedTrueVariableIds?.has(variableId) !== true &&
            (assignment.variables[variableId] ?? null) !== null
        const canDerive =
            !derivationSuppressed &&
            Object.values(assignment.operatorAssignments).includes("accepted")
        const withhold = (
            withheldVariableIds: ReadonlySet<string>
        ): TCoreResolvedVariableValues => {
            if (!canDerive) {
                // Nothing can be derived, so closure is the seed minus what
                // was withheld.
                const reduced = { ...assignment.variables }
                for (const variableId of withheldVariableIds)
                    delete reduced[variableId]
                return reduced
            }
            return closeUnderAcceptedOperators(ctx, assignment, {
                excludedPremiseIds: closureExclusions,
                withheldVariableIds,
            }).variables
        }

        const conclusionClaimVariableIds = [
            ...new Set(
                conclusion
                    .getExpressions()
                    .filter((expr) => expr.type === "variable")
                    .map((expr) => expr.variableId)
            ),
        ].filter((vid) => {
            if (forcedTrueVariableIds?.has(vid) === true) return false
            const variable = ctx.getVariable(vid)
            return variable != null && isClaimBound(variable)
        })
        let reachedWithoutAssertion = conclusionTrue === true
        if (conclusionClaimVariableIds.length > 0) {
            const counterfactual: TCoreResolvedAssignment = {
                variables: withhold(new Set(conclusionClaimVariableIds)),
                operatorAssignments: assignment.operatorAssignments,
            }
            const rootValue = conclusion.evaluate(counterfactual, {
                strictUnknownKeys: false,
                resolver: createPremiseBoundResolver(ctx, counterfactual),
            }).rootValue
            reachedWithoutAssertion = (rootValue ?? null) === true
        }
        const conclusionAttribution: TCoreValueAttribution = {
            assertedByReader: conclusionClaimVariableIds.some(isReaderAsserted),
            reachedWithoutAssertion,
        }

        // One closure per reader-asserted claim, and only when something could
        // have been derived at all.
        const claimAttribution =
            includeDiagnostics && canDerive
                ? Object.fromEntries(
                      referencedVariableIds
                          .filter((vid) => {
                              const variable = ctx.getVariable(vid)
                              return (
                                  variable != null &&
                                  isClaimBound(variable) &&
                                  isReaderAsserted(vid)
                              )
                          })
                          .map((vid) => {
                              const asserted = assignment.variables[vid]
                              const reclosed = withhold(new Set([vid]))
                              return [
                                  vid,
                                  {
                                      assertedByReader: true,
                                      reachedWithoutAssertion:
                                          (reclosed[vid] ?? null) === asserted,
                                  } satisfies TCoreValueAttribution,
                              ]
                          })
                  )
                : undefined
        const strip = (
            result: TCorePremiseEvaluationResult
        ): TCorePremiseEvaluationResult => ({
            ...result,
            expressionValues: includeExpressionValues
                ? result.expressionValues
                : {},
            inferenceDiagnostic: includeDiagnostics
                ? result.inferenceDiagnostic
                : undefined,
        })

        const propagatedVariableValues = includeDiagnostics
            ? Object.fromEntries(
                  referencedVariableIds.map((vid) => [
                      vid,
                      propagatedAssignment.variables[vid] ?? null,
                  ])
              )
            : undefined
        const variableProvenance = includeDiagnostics
            ? Object.fromEntries(
                  referencedVariableIds.map((vid) => [
                      vid,
                      propagation.provenance[vid] ?? {
                          value: null,
                          origin: "unassigned" as const,
                      },
                  ])
              )
            : undefined

        return {
            ok: true,
            assignment: {
                variables: { ...propagatedAssignment.variables },
                operatorAssignments: {
                    ...propagatedAssignment.operatorAssignments,
                },
            },
            referencedVariableIds,
            conclusion: strip(conclusionEvaluation),
            supportingPremises: supportingEvaluations.map(strip),
            constraintPremises: constraintEvaluations.map(strip),
            struckPremiseIds,
            survivingSupportingPremiseCount: survivingSupport.length,
            isAdmissibleAssignment,
            survivingSupportingPremisesTrue,
            conclusionTrue,
            premisesHoldConclusionFalse,
            contestedVariableIds,
            conclusionAttribution,
            claimAttribution,
            premiseSetSatisfiable,
            propagatedVariableValues,
            variableProvenance,
        }
    } catch (error) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ASSIGNMENT_MISSING_VARIABLE",
                    message:
                        error instanceof Error
                            ? error.message
                            : "Argument evaluation failed.",
                }),
            ]),
        }
    }
}

/**
 * Enumerates all 2^n variable assignments and checks for counterexamples.
 *
 * The optional `options.excludedVariableIds` set removes the listed IDs from
 * the enumeration — typically axiomatic-bound variables that the engine
 * forces to `true`. The optional `options.forcedTrueVariableIds` set fixes
 * the listed IDs to `true` in every generated assignment. Callers normally
 * pass the same set for both.
 */
export function checkArgumentValidity(
    ctx: TArgumentEvaluationContext,
    options?: TCoreValidityCheckOptions
): TCoreValidityCheckResult {
    const validateFirst = options?.validateFirst ?? true
    if (validateFirst) {
        const validation = ctx.validateEvaluability()
        if (!validation.ok) {
            return {
                ok: false,
                validation,
            }
        }
    }

    const conclusion = ctx.getConclusionPremise()
    if (!conclusion) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ARGUMENT_NO_CONCLUSION",
                    message: "Argument has no designated conclusion premise.",
                }),
            ]),
        }
    }

    const supportingPremises = ctx.listSupportingPremises()
    const supportingIds = new Set(supportingPremises.map((pm) => pm.getId()))
    const constraintPremises = ctx
        .listPremises()
        .filter(
            (pm) =>
                pm.getId() !== ctx.conclusionPremiseId &&
                !supportingIds.has(pm.getId())
        )

    const allVariableIdsForCheck = [
        ...new Set(
            [conclusion, ...supportingPremises, ...constraintPremises].flatMap(
                (pm) =>
                    pm
                        .getExpressions()
                        .filter((expr) => expr.type === "variable")
                        .map((expr) => expr.variableId)
            )
        ),
    ].sort()

    // Claim-bound and externally-bound premise variables get truth-table columns;
    // internally-bound premise variables are resolved lazily. Variables in
    // `excludedVariableIds` (e.g. axiomatic-bound) are removed entirely so they
    // do not appear as free choices in the 2^n enumeration.
    const excludedVariableIds = options?.excludedVariableIds
    const forcedTrueVariableIds = options?.forcedTrueVariableIds
    const checkedVariableIds = allVariableIdsForCheck.filter((vid) => {
        if (excludedVariableIds?.has(vid)) return false
        const v = ctx.getVariable(vid)
        if (v == null) return false
        if (isClaimBound(v)) return true
        if (isPremiseBound(v) && v.boundArgumentId !== ctx.argumentId)
            return true
        return false
    })

    if (
        options?.maxVariables !== undefined &&
        checkedVariableIds.length > options.maxVariables
    ) {
        return {
            ok: false,
            validation: makeValidationResult([
                makeErrorIssue({
                    code: "ASSIGNMENT_UNKNOWN_VARIABLE",
                    message: `Validity check requires ${checkedVariableIds.length} variables, exceeding limit ${options.maxVariables}.`,
                }),
            ]),
        }
    }

    // The generated assignments carry no operator decisions, so nothing is
    // ever struck and the premise set is the same on every row. Computing it
    // once here and threading it through keeps the search 2^n rather than
    // 2^n × 2^n.
    const premiseSetSatisfiable = isPremiseSetSatisfiable(ctx, {
        premises: [...supportingPremises, ...constraintPremises],
        freeVariableIds: checkedVariableIds,
        forcedTrueVariableIds,
    })

    const mode = options?.mode ?? "firstCounterexample"
    const maxAssignmentsChecked = options?.maxAssignmentsChecked
    const counterexamples: TCoreCounterexample[] = []
    let numAssignmentsChecked = 0
    let numAdmissibleAssignments = 0
    let truncated = false

    const totalAssignments = 2 ** checkedVariableIds.length
    for (let mask = 0; mask < totalAssignments; mask++) {
        if (
            maxAssignmentsChecked !== undefined &&
            numAssignmentsChecked >= maxAssignmentsChecked
        ) {
            truncated = true
            break
        }

        const assignment: TCoreExpressionAssignment = {
            variables: {},
            operatorAssignments: {},
        }
        for (let i = 0; i < checkedVariableIds.length; i++) {
            assignment.variables[checkedVariableIds[i]] = Boolean(
                mask & (1 << i)
            )
        }
        if (forcedTrueVariableIds) {
            for (const vid of forcedTrueVariableIds) {
                assignment.variables[vid] = true
            }
        }

        const result = evaluateArgument(ctx, assignment, {
            validateFirst: false,
            includeExpressionValues:
                options?.includeCounterexampleEvaluations ?? false,
            includeDiagnostics:
                options?.includeCounterexampleEvaluations ?? false,
            forcedTrueVariableIds,
            premiseSetSatisfiable,
        })

        if (!result.ok) {
            return {
                ok: false,
                validation: result.validation,
            }
        }

        numAssignmentsChecked += 1

        if (result.isAdmissibleAssignment === true) {
            numAdmissibleAssignments += 1
        }

        if (result.premisesHoldConclusionFalse === true) {
            counterexamples.push({
                assignment: result.assignment!,
                result,
            })
            if (mode === "firstCounterexample") {
                break
            }
        }
    }

    const foundCounterexample = counterexamples.length > 0
    const fullyChecked =
        !truncated &&
        (mode === "exhaustive" ||
            (mode === "firstCounterexample" && !foundCounterexample))

    return {
        ok: true,
        isValid: foundCounterexample ? false : fullyChecked ? true : undefined,
        checkedVariableIds,
        numAssignmentsChecked,
        numAdmissibleAssignments,
        counterexamples,
        truncated,
    }
}
