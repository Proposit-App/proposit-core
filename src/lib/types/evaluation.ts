import type { TCoreArgumentRoleState } from "../schemata/index.js"

export type { TCoreArgumentRoleState }

/**
 * The fourth truth value: the reader's assignments, run through the steps they
 * granted, force this both true and false.
 *
 * Only evaluation produces it. A reader assigns `TCoreTrivalentValue`, and the
 * assignment types below deliberately exclude this literal so a caller cannot
 * feed it back in.
 */
export const CONTESTED = "contested"

/** The type of {@link CONTESTED}. */
export type TCoreContestedValue = typeof CONTESTED

/** Three-valued truth value: true, false, or null (unset/unknown). */
export type TCoreTrivalentValue = boolean | null

/**
 * Four-valued truth value — the three a reader may assign, plus
 * {@link CONTESTED}, which only evaluation can produce.
 */
export type TCoreQuadrivalentValue = TCoreTrivalentValue | TCoreContestedValue

/** Narrows a four-valued truth value to {@link CONTESTED}. */
export function isContested(
    value: TCoreQuadrivalentValue | undefined
): value is TCoreContestedValue {
    return value === CONTESTED
}

/** Maps variable IDs to three-valued truth values. */
export type TCoreVariableAssignment = Record<string, TCoreTrivalentValue>

/** Maps variable IDs to the four-valued results constraint closure produced. */
export type TCoreResolvedVariableValues = Record<string, TCoreQuadrivalentValue>

/**
 * Operator decision recorded by a reader.
 *
 * `"accepted"` grants the step: constraint propagation may derive values
 * through it. `"rejected"` withholds the step and **strikes the whole premise
 * the operator lives in** from the evaluated set — it asserts nothing, and in
 * particular never forces the expression or its children to `false`.
 */
export type TCoreOperatorAssignment = "accepted" | "rejected"

/** Full expression assignment: variable truth values and operator acceptance states. */
export interface TCoreExpressionAssignment {
    /** Variable ID → true/false/null (null = unset/not sure). */
    variables: TCoreVariableAssignment
    /** Operator expression ID → accepted/rejected. Unset operators evaluate normally. */
    operatorAssignments: Record<string, TCoreOperatorAssignment>
}

/**
 * An assignment carrying the values constraint closure resolved, which may
 * include {@link CONTESTED}. Evaluation feeds its own closure output back into
 * premise evaluation through this type; a reader supplies
 * {@link TCoreExpressionAssignment}, which is assignable to this one but never
 * the reverse.
 */
export interface TCoreResolvedAssignment {
    /** Variable ID → true/false/null/contested. */
    variables: TCoreResolvedVariableValues
    /** Operator expression ID → accepted/rejected. Unset operators evaluate normally. */
    operatorAssignments: Record<string, TCoreOperatorAssignment>
}

/** Severity level for validation issues. */
export type TCoreValidationSeverity = "error" | "warning"

/** Machine-readable codes for all validation issues. */
export type TCoreValidationCode =
    | "ARGUMENT_NO_CONCLUSION"
    | "ARGUMENT_CONCLUSION_NOT_FOUND"
    | "ARGUMENT_VARIABLE_ID_SYMBOL_MISMATCH"
    | "ARGUMENT_VARIABLE_SYMBOL_AMBIGUOUS"
    | "PREMISE_EMPTY"
    | "PREMISE_ROOT_MISSING"
    | "PREMISE_ROOT_MISMATCH"
    | "EXPR_CHILD_COUNT_INVALID"
    | "EXPR_BINARY_POSITIONS_INVALID"
    | "EXPR_VARIABLE_UNDECLARED"
    | "ASSIGNMENT_MISSING_VARIABLE"
    | "ASSIGNMENT_UNKNOWN_VARIABLE"
    | "SOURCE_VARIABLE_ASSOCIATION_INVALID_VARIABLE"
    | "SOURCE_EXPRESSION_ASSOCIATION_INVALID_PREMISE"
    | "SOURCE_EXPRESSION_ASSOCIATION_INVALID_EXPRESSION"
    | "SOURCE_ORPHANED"
    | "EXPR_BOUND_PREMISE_EMPTY"
    | "DERIVATION_STRUCTURE_INVALID"

export interface TCoreValidationIssue {
    /** Machine-readable issue code for callers/tests/UI logic. */
    code: TCoreValidationCode
    /** Severity level; `error` blocks evaluation/validity checks. */
    severity: TCoreValidationSeverity
    /** Human-readable explanation of the issue. */
    message: string
    /** Premise associated with the issue, when applicable. */
    premiseId?: string
    /** Expression associated with the issue, when applicable. */
    expressionId?: string
    /** Variable associated with the issue, when applicable. */
    variableId?: string
}

export interface TCoreValidationResult {
    /** `true` iff no `error`-severity issues are present. */
    ok: boolean
    /** Full list of validation findings (errors and warnings). */
    issues: TCoreValidationIssue[]
}

export interface TCoreDirectionalVacuity {
    /** Truth value of the antecedent for this directional implication view. */
    antecedentTrue: TCoreQuadrivalentValue
    /** Truth value of the consequent for this directional implication view. */
    consequentTrue: TCoreQuadrivalentValue
    /** Result of evaluating `antecedent -> consequent`. */
    implicationValue: TCoreQuadrivalentValue
    /** `true` iff the implication is true because the antecedent is false; `null` if indeterminate. */
    isVacuouslyTrue: TCoreQuadrivalentValue
    /** `true` iff the antecedent was true (the implication "fired"); `null` if indeterminate. */
    fired: TCoreQuadrivalentValue
}

export type TCorePremiseInferenceDiagnostic =
    | {
          kind: "implies"
          premiseId: string
          rootExpressionId: string
          leftValue: TCoreQuadrivalentValue
          rightValue: TCoreQuadrivalentValue
          rootValue: TCoreQuadrivalentValue
          antecedentTrue: TCoreQuadrivalentValue
          consequentTrue: TCoreQuadrivalentValue
          isVacuouslyTrue: TCoreQuadrivalentValue
          fired: TCoreQuadrivalentValue
          firedAndHeld: TCoreQuadrivalentValue
      }
    | {
          kind: "iff"
          premiseId: string
          rootExpressionId: string
          leftValue: TCoreQuadrivalentValue
          rightValue: TCoreQuadrivalentValue
          rootValue: TCoreQuadrivalentValue
          leftToRight: TCoreDirectionalVacuity
          rightToLeft: TCoreDirectionalVacuity
          bothSidesTrue: TCoreQuadrivalentValue
          bothSidesFalse: TCoreQuadrivalentValue
      }

export interface TCorePremiseEvaluationResult {
    /** ID of the evaluated premise. */
    premiseId: string
    /** Premise classification derived from the root expression. */
    premiseType: "inference" | "constraint"
    /** Root expression ID, if the premise has a root. */
    rootExpressionId?: string
    /** Truth value of the root expression, if the premise was evaluable. */
    rootValue?: TCoreQuadrivalentValue
    /** Per-expression truth values keyed by expression ID. */
    expressionValues: Record<string, TCoreQuadrivalentValue>
    /** Referenced variable truth values keyed by variable ID. */
    variableValues: Record<string, TCoreQuadrivalentValue>
    /** Inference-specific diagnostics for `implies`/`iff` roots. */
    inferenceDiagnostic?: TCorePremiseInferenceDiagnostic
}

export interface TCoreArgumentEvaluationOptions {
    /** Reject assignment keys that are not referenced by the evaluated premises. */
    strictUnknownAssignmentKeys?: boolean
    /** Include per-expression truth maps in premise results (may be verbose). */
    includeExpressionValues?: boolean
    /** Include inference diagnostics in premise results. */
    includeDiagnostics?: boolean
    /** Run argument/premise evaluability validation before evaluating. */
    validateFirst?: boolean
    /**
     * Variable IDs the reader did not assign and cannot be credited with —
     * typically axiomatic-bound variables, which the engine forces true. They
     * are never treated as reader assertions and are left out of the
     * reached-without-assertion counterfactual. Unless
     * `satisfiabilityForcedTrueVariableIds` is given, they are also pinned
     * `true` in every row of the premise-set satisfiability search.
     */
    forcedTrueVariableIds?: ReadonlySet<string>
    /**
     * Variable IDs pinned `true` in the premise-set satisfiability search,
     * when that set differs from `forcedTrueVariableIds`. Defaults to it.
     *
     * The two are separate because a citation belongs in one and not the
     * other. Asking whether the premises can hold at all takes a cited claim
     * at its source's word, so a citation is pinned here. But a reader may
     * disagree with a source, and their assignment on a citation-bound
     * variable is their own assertion — so a citation must stay out of
     * `forcedTrueVariableIds`, which is what decides that.
     */
    satisfiabilityForcedTrueVariableIds?: ReadonlySet<string>
    /**
     * Premise-set satisfiability computed by the caller. Supplying it skips
     * the search — `checkArgumentValidity` computes it once and threads it
     * through its truth-table rows, where the surviving set never varies.
     */
    premiseSetSatisfiable?: TCoreTrivalentValue
}

export interface TCoreArgumentEvaluationResult {
    /** `false` means evaluation could not be completed (typically validation failure). */
    ok: boolean
    /** Validation output when `ok === false`, or when validation was requested and included. */
    validation?: TCoreValidationResult
    /** The assignment used for this evaluation, after constraint closure. */
    assignment?: TCoreResolvedAssignment
    /** All variable IDs referenced across evaluated supporting/conclusion/constraint premises. */
    referencedVariableIds?: string[]
    /** Evaluation result for the designated conclusion premise. */
    conclusion?: TCorePremiseEvaluationResult
    /** Evaluation results for premises designated as supporting the argument. */
    supportingPremises?: TCorePremiseEvaluationResult[]
    /** Evaluation results for constraint premises (used to determine admissibility). */
    constraintPremises?: TCorePremiseEvaluationResult[]
    /**
     * IDs of premises struck from the evaluated set because the reader
     * rejected an operator inside them. Struck premises are still evaluated
     * and still present in `supportingPremises` / `constraintPremises`, so a
     * consumer can render them crossed out — they are simply excluded from the
     * aggregates, from constraint propagation, and from the satisfiability
     * search.
     *
     * The conclusion premise and derivation premises are never struck.
     */
    struckPremiseIds?: string[]
    /** Number of supporting premises that were not struck. */
    survivingSupportingPremiseCount?: number
    /** `true` iff every surviving constraint premise evaluates to true. */
    isAdmissibleAssignment?: TCoreQuadrivalentValue
    /**
     * `true` iff every surviving supporting premise evaluates to true.
     *
     * Vacuously `true` when every supporting premise is struck — read it
     * together with `survivingSupportingPremiseCount`, and never as
     * "the argument worked". Whether the argument reached its conclusion is
     * `conclusionAttribution`, not this field.
     */
    survivingSupportingPremisesTrue?: TCoreQuadrivalentValue
    /** The truth value of the conclusion premise root expression. */
    conclusionTrue?: TCoreQuadrivalentValue
    /**
     * `true` iff constraints are satisfied, every surviving supporting premise
     * is true, and the conclusion is false.
     *
     * A reader-relative gap under one assignment — **not** a countermodel to
     * entailment, which is the stronger claim `checkValidity` answers.
     *
     * It rests on `survivingSupportingPremisesTrue`, which is vacuously `true`
     * when nothing survives, so this field is `null` when the argument had
     * supporting premises and the reader struck every one of them: the case was
     * withheld, not weighed and found wanting. An argument authored with no
     * supporting premises at all is the entailment-from-nothing case and still
     * reports `true` for a false conclusion.
     */
    premisesHoldConclusionFalse?: TCoreQuadrivalentValue
    /**
     * Variable IDs whose value came out {@link CONTESTED}, sorted. Always
     * present when `ok`, and **not** gated on `includeDiagnostics`.
     *
     * Read this rather than inferring a conflict from the aggregates above.
     * Propagation carries only the told-true component forward, so a contested
     * variable can yield an uncontested `true` downstream and leave
     * `conclusionTrue`, `isAdmissibleAssignment`,
     * `survivingSupportingPremisesTrue`, `premisesHoldConclusionFalse` and
     * `premiseSetSatisfiable` all reading clean while the reader's inputs
     * still force something both true and false. A non-empty array is the one
     * fact that always records it.
     *
     * Variable-keyed, covering every premise in the argument rather than only
     * `referencedVariableIds`. `variableProvenance[id].contestedBy` names the
     * granted steps behind each entry.
     */
    contestedVariableIds?: string[]
    /**
     * Where the conclusion's truth came from. `assertedByReader` records that
     * the reader supplied a value for at least one claim the conclusion
     * premise references; `reachedWithoutAssertion` withholds all of them,
     * re-runs constraint propagation from the reduced seed, and reports
     * whether the conclusion premise root still comes back `true`.
     */
    conclusionAttribution?: TCoreValueAttribution
    /**
     * Per-claim attribution, one entry per reader-asserted claim-bound
     * variable. `reachedWithoutAssertion` here asks whether the **same value**
     * returns once the reader's own assignment of that variable is withheld —
     * the conclusion asks whether it comes back `true`. Populated only when
     * `includeDiagnostics: true`, and omitted entirely when no operator is
     * accepted (nothing can be derived, so every answer would be `false`).
     */
    claimAttribution?: Record<string, TCoreValueAttribution>
    /**
     * `true` iff some total assignment makes every surviving premise true.
     * Asked of the surviving premise set alone, ignoring the reader's own
     * assignment. `null` means "not determined" — the premise set has more
     * free variables than the search ceiling.
     *
     * When `false`, constraint propagation is skipped entirely: nothing is
     * derived, and the conclusion reports only what the reader asserted.
     */
    premiseSetSatisfiable?: TCoreTrivalentValue
    /**
     * Evaluator's authoritative propagated variable values across the whole
     * argument. Populated only when `includeDiagnostics: true`. Key set
     * matches `referencedVariableIds`; still-unresolved variables appear
     * with value `null`.
     */
    propagatedVariableValues?: TCoreResolvedVariableValues
    /**
     * Where each propagated value came from, keyed like
     * `propagatedVariableValues`. Populated only when
     * `includeDiagnostics: true`.
     */
    variableProvenance?: Record<string, TCoreVariableProvenance>
}

/** Whether a value was supplied by the reader, and whether it holds without that. */
export interface TCoreValueAttribution {
    /** `true` iff the reader supplied `true` or `false`. An explicit unknown is a decision, not an assertion. */
    assertedByReader: boolean
    /** `true` iff the value still holds once the reader's own assertion is withheld and closure is recomputed. */
    reachedWithoutAssertion: boolean
}

/** Where a propagated variable value came from. */
export type TCoreValueOrigin =
    | "asserted"
    | "derived"
    | "contested"
    | "unassigned"

/** The granted operator step that produced a derived value. */
export interface TCoreDerivationStep {
    /** The accepted operator expression that produced the value. */
    expressionId: string
    /** The premise that operator lives in. */
    premiseId: string
    /**
     * Variable IDs whose values the step consumed. One immediate step is
     * recorded per value; walk these transitively to reconstruct a chain.
     */
    fromVariableIds: string[]
}

export interface TCoreVariableProvenance {
    /** The variable's value after propagation. */
    value: TCoreQuadrivalentValue
    /**
     * `"contested"` whenever the value is {@link CONTESTED}, whatever else
     * contributed; otherwise `"asserted"` for a reader-supplied `true`/`false`,
     * `"derived"` for anything propagation produced, `"unassigned"` for a value
     * still unresolved.
     */
    origin: TCoreValueOrigin
    /** The immediate producing step; present iff `origin === "derived"`. */
    derivedBy?: TCoreDerivationStep
    /**
     * Every granted step that contributed a truth component to a contested
     * value, in a stable order; present iff `origin === "contested"`. The
     * reader's own assertion is not a step and never appears here — compare
     * `assignment.variables[id]` to see whether one of the two components came
     * from the reader. `derivedBy` is absent for a contested value: naming one
     * producing step is a lie once two steps disagree.
     */
    contestedBy?: TCoreDerivationStep[]
}

/** Options for `propagateOperatorConstraints`. */
export interface TCorePropagationOptions {
    /**
     * Premise IDs excluded from propagation entirely — their expressions are
     * not indexed, so no operator inside them contributes a value.
     */
    excludedPremiseIds?: ReadonlySet<string>
    /**
     * Variable IDs dropped from the seed before closure runs. Used by the
     * attribution counterfactual: withhold an assertion, then recompute from
     * the remaining inputs rather than deleting a value after the fact.
     */
    withheldVariableIds?: ReadonlySet<string>
}

export interface TCoreValidityCheckOptions {
    /** Stop at first counterexample or continue exhaustively. */
    mode?: "firstCounterexample" | "exhaustive"
    /** Safety limit for the number of variables used in truth-table generation. */
    maxVariables?: number
    /** Safety limit for generated assignments checked before truncating. */
    maxAssignmentsChecked?: number
    /** Include full evaluation payloads for captured counterexamples. */
    includeCounterexampleEvaluations?: boolean
    /** Run evaluability validation before truth-table search. */
    validateFirst?: boolean
    /**
     * IDs to exclude from the 2^n enumeration. Used for axiomatic-bound
     * variables that are forced-true by the engine — they do not appear as
     * free choices in the truth-table search.
     */
    excludedVariableIds?: Set<string>
    /**
     * IDs that are fixed to `true` in every generated assignment. Typically
     * the same set as `excludedVariableIds` — axiomatic-bound variables are
     * both excluded from enumeration and pinned to `true` in each row.
     */
    forcedTrueVariableIds?: Set<string>
}

export interface TCoreCounterexample {
    /** Assignment under which the argument fails to preserve truth. */
    assignment: TCoreResolvedAssignment
    /** Full argument evaluation result for that assignment. */
    result: TCoreArgumentEvaluationResult
}

export interface TCoreValidityCheckResult {
    /** `false` means the validity check could not run to completion. */
    ok: boolean
    /** Validation output when `ok === false`. */
    validation?: TCoreValidationResult
    /** Validity result when known; may be omitted if truncated before conclusion. */
    isValid?: boolean
    /** Variable IDs used to generate the checked assignments. */
    checkedVariableIds?: string[]
    /** Total number of assignments evaluated (including inadmissible ones). */
    numAssignmentsChecked?: number
    /** Number of assignments satisfying all constraints. */
    numAdmissibleAssignments?: number
    /** Counterexamples found (one or many depending on mode/options). */
    counterexamples?: TCoreCounterexample[]
    /** `true` iff checking stopped due to a configured limit. */
    truncated?: boolean
}
