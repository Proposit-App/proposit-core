import type {
    TCoreArgument,
    TCoreArgumentRoleState,
    TCorePremise,
} from "../schemata/index.js"

/** Role that a premise plays in an argument. */
export type TCorePremiseRole = "supporting" | "conclusion"

export type { TCoreArgumentRoleState }

export interface TCoreArgumentEngineData {
    /** Snapshot of the argument metadata managed by the engine. */
    argument: TCoreArgument
    /** Serialized premise snapshots (one per premise manager). */
    premises: TCorePremise[]
    /** Current role assignments for the premises in this engine. */
    roles: TCoreArgumentRoleState
}

/** Maps variable IDs to boolean truth values. */
export type TCoreVariableAssignment = Record<string, boolean>

/** Severity level for validation issues. */
export type TCoreValidationSeverity = "error" | "warning"

/** Machine-readable codes for all validation issues. */
export type TCoreValidationCode =
    | "ARGUMENT_NO_CONCLUSION"
    | "ARGUMENT_CONCLUSION_NOT_FOUND"
    | "ARGUMENT_SUPPORTING_PREMISE_NOT_FOUND"
    | "ARGUMENT_ROLE_OVERLAP"
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
    antecedentTrue: boolean
    /** Truth value of the consequent for this directional implication view. */
    consequentTrue: boolean
    /** Result of evaluating `antecedent -> consequent`. */
    implicationValue: boolean
    /** `true` iff the implication is true because the antecedent is false. */
    isVacuouslyTrue: boolean
    /** `true` iff the antecedent was true (the implication "fired"). */
    fired: boolean
}

export type TCorePremiseInferenceDiagnostic =
    | {
          kind: "implies"
          premiseId: string
          rootExpressionId: string
          leftValue: boolean
          rightValue: boolean
          rootValue: boolean
          antecedentTrue: boolean
          consequentTrue: boolean
          isVacuouslyTrue: boolean
          fired: boolean
          firedAndHeld: boolean
      }
    | {
          kind: "iff"
          premiseId: string
          rootExpressionId: string
          leftValue: boolean
          rightValue: boolean
          rootValue: boolean
          leftToRight: TCoreDirectionalVacuity
          rightToLeft: TCoreDirectionalVacuity
          bothSidesTrue: boolean
          bothSidesFalse: boolean
      }

export interface TCorePremiseEvaluationResult {
    /** ID of the evaluated premise. */
    premiseId: string
    /** Premise classification derived from the root expression. */
    premiseType: "inference" | "constraint"
    /** Root expression ID, if the premise has a root. */
    rootExpressionId?: string
    /** Truth value of the root expression, if the premise was evaluable. */
    rootValue?: boolean
    /** Per-expression truth values keyed by expression ID. */
    expressionValues: Record<string, boolean>
    /** Referenced variable truth values keyed by variable ID. */
    variableValues: Record<string, boolean>
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
    /** The assignment used for this evaluation (variableId -> boolean). */
    assignment?: TCoreVariableAssignment
    /** All variable IDs referenced across evaluated supporting/conclusion/constraint premises. */
    referencedVariableIds?: string[]
    /** Evaluation result for the designated conclusion premise. */
    conclusion?: TCorePremiseEvaluationResult
    /** Evaluation results for premises designated as supporting the argument. */
    supportingPremises?: TCorePremiseEvaluationResult[]
    /** Evaluation results for constraint premises (used to determine admissibility). */
    constraintPremises?: TCorePremiseEvaluationResult[]
    /** `true` iff all constraint premises evaluate to true under the assignment. */
    isAdmissibleAssignment?: boolean
    /** `true` iff every supporting premise evaluates to true. */
    allSupportingPremisesTrue?: boolean
    /** The truth value of the conclusion premise root expression. */
    conclusionTrue?: boolean
    /** `true` iff constraints are satisfied, all supporting premises are true, and the conclusion is false. */
    isCounterexample?: boolean
    /** Convenience inverse of `isCounterexample` for the evaluated assignment. */
    preservesTruthUnderAssignment?: boolean
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
    assignment: TCoreVariableAssignment
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
