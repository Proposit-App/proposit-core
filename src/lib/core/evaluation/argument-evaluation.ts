import {
    isClaimBound,
    isPremiseBound,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreCounterexample,
    TCoreDerivationStep,
    TCoreExpressionAssignment,
    TCorePropagationOptions,
    TCoreTrivalentValue,
    TCoreValueAttribution,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
    TCoreVariableAssignment,
    TCoreVariableProvenance,
    TCorePremiseEvaluationResult,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import {
    kleeneAnd,
    kleeneNot,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "./kleene.js"
import { createPremiseBoundResolver } from "./premise-resolver.js"
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
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            resolver?: (variableId: string) => boolean | null
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
 * Kleene-evaluate an expression subtree under a fixed variable assignment.
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
export function evaluateSubtreeKleene(
    rootExpressionId: string,
    getExpression: (id: string) => TCorePropositionalExpression | undefined,
    getChildren: (parentId: string) => TCorePropositionalExpression[],
    variables: TCoreVariableAssignment
): TCoreTrivalentValue {
    const expr = getExpression(rootExpressionId)
    if (!expr) return null

    if (expr.type === "variable") {
        return variables[expr.variableId] ?? null
    }

    const recurse = (
        child: TCorePropositionalExpression
    ): TCoreTrivalentValue =>
        evaluateSubtreeKleene(child.id, getExpression, getChildren, variables)
    const children = getChildren(expr.id)

    if (expr.type === "formula") {
        return children.length > 0 ? recurse(children[0]) : null
    }

    switch (expr.operator) {
        case "not":
            return children.length > 0 ? kleeneNot(recurse(children[0])) : null
        case "and":
            return children.reduce<TCoreTrivalentValue>(
                (acc, child) => kleeneAnd(acc, recurse(child)),
                true
            )
        case "or":
            return children.reduce<TCoreTrivalentValue>(
                (acc, child) => kleeneOr(acc, recurse(child)),
                false
            )
        case "implies":
            return children.length >= 2
                ? kleeneImplies(recurse(children[0]), recurse(children[1]))
                : null
        case "iff":
            return children.length >= 2
                ? kleeneIff(recurse(children[0]), recurse(children[1]))
                : null
        default:
            return null
    }
}

/**
 * Run fixed-point constraint propagation over the operators the reader
 * accepted. Fills unknown (null) variable values based on operator semantics.
 * Never overwrites user-assigned values (true/false).
 *
 * Only acceptances propagate. A rejection is not a truth value: it strikes the
 * premise it lives in, and the caller excludes that premise here via
 * `options.excludedPremiseIds` — so nothing inside a struck premise
 * contributes, and no value is ever forced `false` by a refusal.
 *
 * Because closure only ever fills `null`s from the seed, it is monotone and
 * its result is the **least fixed point** of that seed. The attribution
 * counterfactual depends on that: withholding an assertion and re-closing must
 * not let mutually supporting premises certify each other.
 *
 * Axiomatic-bound variables are forced to `true` by `ArgumentEngine`'s
 * pre-pass before this function runs; they land in the propagator's
 * `userAssigned` set and are immune to overwrite.
 */
export function propagateOperatorConstraints(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCorePropagationOptions
): TCoreVariableAssignment {
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
    variables: TCoreVariableAssignment
    provenance: Record<string, TCoreVariableProvenance>
} {
    const vars: TCoreVariableAssignment = { ...assignment.variables }
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
     * Resolve the current Kleene value of an expression subtree
     * given the current variable assignments. Does not force-accept
     * nested operators — evaluates them normally via Kleene logic.
     */
    const resolveValue = (exprId: string): TCoreTrivalentValue => {
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

        switch (op) {
            case "not":
                return kleeneNot(resolveValue(children[0].id))
            case "and":
                return children.reduce<TCoreTrivalentValue>(
                    (acc, child) => kleeneAnd(acc, resolveValue(child.id)),
                    true
                )
            case "or":
                return children.reduce<TCoreTrivalentValue>(
                    (acc, child) => kleeneOr(acc, resolveValue(child.id)),
                    false
                )
            case "implies": {
                return kleeneImplies(
                    resolveValue(children[0].id),
                    resolveValue(children[1].id)
                )
            }
            case "iff": {
                return kleeneIff(
                    resolveValue(children[0].id),
                    resolveValue(children[1].id)
                )
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

    // Track which variable IDs were explicitly set by the user
    // (true or false). These are never overwritten by propagation.
    const userAssigned = new Set<string>()
    for (const [varId, val] of Object.entries(vars)) {
        if (val !== null && val !== undefined) userAssigned.add(varId)
    }

    const provenance: Record<string, TCoreVariableProvenance> = {}
    for (const [varId, val] of Object.entries(vars)) {
        provenance[varId] = {
            value: val ?? null,
            origin: userAssigned.has(varId) ? "asserted" : "unassigned",
        }
    }

    /**
     * Try to set a child expression's variable to a value, recording the step
     * that produced it. Never overwrites a value already present: closure only
     * fills `null`s, which is what makes it a least fixed point.
     * Returns true if a value changed.
     */
    const trySetChild = (
        child: TCorePropositionalExpression,
        value: boolean,
        step: TCoreDerivationStep
    ): boolean => {
        const varId = resolveLeafVariableId(child)
        if (varId == null || userAssigned.has(varId)) return false
        if ((vars[varId] ?? null) !== null) return false
        vars[varId] = value
        provenance[varId] = { value, origin: "derived", derivedBy: step }
        return true
    }

    // One pass over accepted operators; a rejection propagates nothing.
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
                        if (trySetChild(children[0], false, stepFrom([])))
                            changed = true
                    }
                    break
                }
                case "and": {
                    // A ∧ B accepted => all children must be true
                    for (const child of children) {
                        if (trySetChild(child, true, stepFrom([])))
                            changed = true
                    }
                    break
                }
                case "or": {
                    // A ∨ B accepted: if all-but-one are false, remaining must be true
                    const unknownChildren: TCorePropositionalExpression[] = []
                    let allOthersAreFalse = true
                    for (const child of children) {
                        const childValue = resolveValue(child.id)
                        if (childValue === null) {
                            unknownChildren.push(child)
                        } else if (childValue !== false) {
                            allOthersAreFalse = false
                        }
                    }
                    if (unknownChildren.length === 1 && allOthersAreFalse) {
                        const consumed = children
                            .filter(
                                (child) => child.id !== unknownChildren[0].id
                            )
                            .map((child) => child.id)
                        if (
                            trySetChild(
                                unknownChildren[0],
                                true,
                                stepFrom(consumed)
                            )
                        )
                            changed = true
                    }
                    break
                }
                case "implies": {
                    // A → B accepted: if A=true => B=true; if B=false => A=false
                    if (children.length >= 2) {
                        const leftValue = resolveValue(children[0].id)
                        const rightValue = resolveValue(children[1].id)
                        if (leftValue === true) {
                            if (
                                trySetChild(
                                    children[1],
                                    true,
                                    stepFrom([children[0].id])
                                )
                            )
                                changed = true
                        }
                        if (rightValue === false) {
                            if (
                                trySetChild(
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
                    // A ↔ B accepted: if A known => B matches; if B known => A matches
                    if (children.length >= 2) {
                        const leftValue = resolveValue(children[0].id)
                        const rightValue = resolveValue(children[1].id)
                        if (leftValue !== null) {
                            if (
                                trySetChild(
                                    children[1],
                                    leftValue,
                                    stepFrom([children[0].id])
                                )
                            )
                                changed = true
                        }
                        if (rightValue !== null) {
                            if (
                                trySetChild(
                                    children[0],
                                    rightValue,
                                    stepFrom([children[1].id])
                                )
                            )
                                changed = true
                        }
                    }
                    break
                }
            }
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

    const propagation = closeUnderAcceptedOperators(ctx, assignment, {
        excludedPremiseIds: struckIds,
    })
    const propagatedAssignment: TCoreExpressionAssignment = {
        variables: propagation.variables,
        operatorAssignments: assignment.operatorAssignments,
    }

    try {
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
        ).reduce<TCoreTrivalentValue>(
            (acc, result) => kleeneAnd(acc, result.rootValue ?? null),
            true
        )
        const survivingSupport = surviving(supportingEvaluations)
        const survivingSupportingPremisesTrue =
            survivingSupport.reduce<TCoreTrivalentValue>(
                (acc, result) => kleeneAnd(acc, result.rootValue ?? null),
                true
            )
        const conclusionTrue: TCoreTrivalentValue =
            conclusionEvaluation.rootValue ?? null
        const premisesHoldConclusionFalse = kleeneAnd(
            isAdmissibleAssignment,
            kleeneAnd(
                survivingSupportingPremisesTrue,
                kleeneNot(conclusionTrue)
            )
        )

        const includeExpressionValues = options?.includeExpressionValues ?? true
        const includeDiagnostics = options?.includeDiagnostics ?? true

        // Attribution: withhold an assertion, recompute closure from what is
        // left, and ask again. Never delete a tag from an already-derived
        // value — the intervention has to be re-derived, not un-derived.
        const forcedTrueVariableIds = options?.forcedTrueVariableIds
        const isReaderAsserted = (variableId: string): boolean =>
            forcedTrueVariableIds?.has(variableId) !== true &&
            (assignment.variables[variableId] ?? null) !== null
        const hasAcceptedOperator = Object.values(
            assignment.operatorAssignments
        ).includes("accepted")
        const withhold = (
            withheldVariableIds: ReadonlySet<string>
        ): TCoreVariableAssignment => {
            if (!hasAcceptedOperator) {
                // Nothing can be derived, so closure is the seed minus what
                // was withheld.
                const reduced = { ...assignment.variables }
                for (const variableId of withheldVariableIds)
                    delete reduced[variableId]
                return reduced
            }
            return closeUnderAcceptedOperators(ctx, assignment, {
                excludedPremiseIds: struckIds,
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
            const counterfactual: TCoreExpressionAssignment = {
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
            includeDiagnostics && hasAcceptedOperator
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
            conclusionAttribution,
            claimAttribution,
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
