import type { TCoreArgumentRoleState } from "../schemata/index.js"

export type { TCoreArgumentRoleState }

/** Three-valued truth value: true, false, or null (unset/unknown). */
export type TCoreTrivalentValue = boolean | null

/** Maps variable IDs to three-valued truth values. */
export type TCoreVariableAssignment = Record<string, TCoreTrivalentValue>

/** Operator acceptance state: accepted (true), rejected (false), or unset (normal evaluation). */
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
    /** `true` iff all constraint premises evaluate to true under the assignment. */
    isAdmissibleAssignment?: TCoreTrivalentValue
    /** `true` iff every supporting premise evaluates to true. */
    allSupportingPremisesTrue?: TCoreTrivalentValue
    /** The truth value of the conclusion premise root expression. */
    conclusionTrue?: TCoreTrivalentValue
    /** `true` iff constraints are satisfied, all supporting premises are true, and the conclusion is false. */
    isCounterexample?: TCoreTrivalentValue
    /** Convenience inverse of `isCounterexample` for the evaluated assignment. */
    preservesTruthUnderAssignment?: TCoreTrivalentValue
    /**
     * Evaluator's authoritative propagated variable values across the whole
     * argument. Populated only when `includeDiagnostics: true`. Key set
     * matches `referencedVariableIds`; still-unresolved variables appear
     * with value `null`.
     */
    propagatedVariableValues?: Record<string, TCoreTrivalentValue>
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
