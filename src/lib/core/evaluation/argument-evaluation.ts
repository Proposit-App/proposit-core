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
    type TCoreExpressionAssignment,
    type TCoreQuadrivalentValue,
    type TCoreResolvedAssignment,
    type TCoreResolvedVariableValues,
    type TCoreValueAttribution,
    type TCoreValidityCheckOptions,
    type TCoreValidityCheckResult,
    type TCorePremiseEvaluationResult,
    type TCoreValidationResult,
} from "../../types/evaluation.js"
import {
    belnapAnd,
    belnapNot,
    belnapOr,
    belnapXor,
    belnapImplies,
    belnapIff,
} from "./belnap.js"
import { createPremiseBoundResolver } from "./premise-resolver.js"
import {
    closeUnderAcceptedOperators,
    propagateOperatorConstraints,
} from "./propagation.js"
import { isPremiseSetSatisfiable } from "./satisfiability.js"
import { makeErrorIssue, makeValidationResult } from "./validation.js"

export { closeUnderAcceptedOperators, propagateOperatorConstraints }

/**
 * Read-only interface providing the data an evaluation needs from an
 * argument engine. This is intentionally narrow — evaluation should
 * not mutate anything.
 */
export interface TArgumentEvaluationContext {
    /** The argument's own ID. */
    argumentId: string
    /**
     * Whether the argument is a response. A response has no conclusion and is
     * not evaluated against one, so evaluation and the validity check refuse
     * it with `ARGUMENT_IS_RESPONSE`. Absent means a standard argument.
     */
    isResponse?: boolean
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
        case "xor":
            // `false` is the identity for parity, as `true` is for `and`.
            return children.reduce<TCoreQuadrivalentValue>(
                (acc, child) => belnapXor(acc, recurse(child)),
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
 * The refusal both evaluation and the validity check give a response: it has
 * no conclusion to evaluate against.
 */
function responseRefusal(): {
    ok: false
    validation: TCoreValidationResult
} {
    return {
        ok: false,
        validation: makeValidationResult([
            makeErrorIssue({
                code: "ARGUMENT_IS_RESPONSE",
                message:
                    "A response argument has no conclusion and is not evaluated against one; check its links with checkLink and checkResponseCoherent.",
            }),
        ]),
    }
}

/**
 * Evaluates an argument under a three-valued expression assignment.
 */
export function evaluateArgument(
    ctx: TArgumentEvaluationContext,
    assignment: TCoreExpressionAssignment,
    options?: TCoreArgumentEvaluationOptions
): TCoreArgumentEvaluationResult {
    if (ctx.isResponse === true) return responseRefusal()
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

    // A key is unknown only when no evaluated premise names it. Checking each
    // premise against its own variables instead would reject every reader who
    // assigns variables in two different premises.
    if (options?.strictUnknownAssignmentKeys === true) {
        const knownVariableIds = new Set(allVariableIds)
        const unknownKeys = Object.keys(assignment.variables)
            .filter((variableId) => !knownVariableIds.has(variableId))
            .sort()
        if (unknownKeys.length > 0) {
            return {
                ok: false,
                validation: makeValidationResult([
                    makeErrorIssue({
                        code: "ASSIGNMENT_UNKNOWN_VARIABLE",
                        message: `Assignment contains variable IDs no evaluated premise references: ${unknownKeys.join(", ")}`,
                    }),
                ]),
            }
        }
    }

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

    // A rejection of the conclusion premise's root step withholds the final
    // inference. It is reported here and nowhere else: the conclusion premise
    // is not struck and every aggregate keeps its value, because an operator
    // decision is never a truth value. A rejection of a nested operator in the
    // conclusion premise stays ignored. Formula (parenthesis) nodes at the
    // root are looked through, so the step is the first expression below them.
    const conclusionExpressions = conclusion.getExpressions()
    let conclusionRoot = conclusionExpressions.find(
        (expr) => expr.parentId === null
    )
    while (conclusionRoot?.type === "formula") {
        const formulaId = conclusionRoot.id
        conclusionRoot = conclusionExpressions.find(
            (expr) => expr.parentId === formulaId
        )
    }
    const conclusionRootId = conclusionRoot?.id
    const conclusionInferenceRejected =
        conclusionRootId !== undefined &&
        assignment.operatorAssignments[conclusionRootId] === "rejected"

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
            strictUnknownKeys: false,
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
            ...(conclusionInferenceRejected
                ? { conclusionInferenceRejected: true as const }
                : {}),
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
    if (ctx.isResponse === true) return responseRefusal()
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
