import type { TCoreArgumentRoleState } from "../schemata/index.js"

export type { TCoreArgumentRoleState }

/** Three-valued truth value: true, false, or null (unset/unknown). */
export type TCoreTrivalentValue = boolean | null

/** Maps variable IDs to three-valued truth values. */
export type TCoreVariableAssignment = Record<string, TCoreTrivalentValue>

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
    antecedentTrue: TCoreTrivalentValue
    /** Truth value of the consequent for this directional implication view. */
    consequentTrue: TCoreTrivalentValue
    /** Result of evaluating `antecedent -> consequent`. */
    implicationValue: TCoreTrivalentValue
    /** `true` iff the implication is true because the antecedent is false; `null` if indeterminate. */
    isVacuouslyTrue: TCoreTrivalentValue
    /** `true` iff the antecedent was true (the implication "fired"); `null` if indeterminate. */
    fired: TCoreTrivalentValue
}

export type TCorePremiseInferenceDiagnostic =
    | {
          kind: "implies"
          premiseId: string
          rootExpressionId: string
          leftValue: TCoreTrivalentValue
          rightValue: TCoreTrivalentValue
          rootValue: TCoreTrivalentValue
          antecedentTrue: TCoreTrivalentValue
          consequentTrue: TCoreTrivalentValue
          isVacuouslyTrue: TCoreTrivalentValue
          fired: TCoreTrivalentValue
          firedAndHeld: TCoreTrivalentValue
      }
    | {
          kind: "iff"
          premiseId: string
          rootExpressionId: string
          leftValue: TCoreTrivalentValue
          rightValue: TCoreTrivalentValue
          rootValue: TCoreTrivalentValue
          leftToRight: TCoreDirectionalVacuity
          rightToLeft: TCoreDirectionalVacuity
          bothSidesTrue: TCoreTrivalentValue
          bothSidesFalse: TCoreTrivalentValue
      }

export interface TCorePremiseEvaluationResult {
    /** ID of the evaluated premise. */
    premiseId: string
    /** Premise classification derived from the root expression. */
    premiseType: "inference" | "constraint"
    /** Root expression ID, if the premise has a root. */
    rootExpressionId?: string
    /** Truth value of the root expression, if the premise was evaluable. */
    rootValue?: TCoreTrivalentValue
    /** Per-expression truth values keyed by expression ID. */
    expressionValues: Record<string, TCoreTrivalentValue>
    /** Referenced variable truth values keyed by variable ID. */
    variableValues: Record<string, TCoreTrivalentValue>
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
     * Variable IDs pinned `true` in every row of the premise-set
     * satisfiability search — typically axiomatic-bound variables, which the
     * engine forces true. They are also never treated as reader assertions.
     */
    forcedTrueVariableIds?: ReadonlySet<string>
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
    /** The assignment used for this evaluation. */
    assignment?: TCoreExpressionAssignment
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
    isAdmissibleAssignment?: TCoreTrivalentValue
    /**
     * `true` iff every surviving supporting premise evaluates to true.
     *
     * Vacuously `true` when every supporting premise is struck — read it
     * together with `survivingSupportingPremiseCount`, and never as
     * "the argument worked". Whether the argument reached its conclusion is
     * `conclusionAttribution`, not this field.
     */
    survivingSupportingPremisesTrue?: TCoreTrivalentValue
    /** The truth value of the conclusion premise root expression. */
    conclusionTrue?: TCoreTrivalentValue
    /**
     * `true` iff constraints are satisfied, every surviving supporting premise
     * is true, and the conclusion is false.
     *
     * A reader-relative gap under one assignment — **not** a countermodel to
     * entailment, which is the stronger claim `checkValidity` answers.
     */
    premisesHoldConclusionFalse?: TCoreTrivalentValue
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
    propagatedVariableValues?: Record<string, TCoreTrivalentValue>
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
export type TCoreValueOrigin = "asserted" | "derived" | "unassigned"

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
    value: TCoreTrivalentValue
    /** `"asserted"` for a reader-supplied `true`/`false`, `"derived"` for anything propagation produced, `"unassigned"` otherwise. */
    origin: TCoreValueOrigin
    /** The immediate producing step; present iff `origin === "derived"`. */
    derivedBy?: TCoreDerivationStep
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
    assignment: TCoreExpressionAssignment
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
