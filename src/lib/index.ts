/**
 * Library barrel export. Re-exports core classes, evaluation types, diff
 * types, schemata, and the diff function.
 */
export * from "./schemata/index.js"
export { ArgumentEngine, defaultGenerateId } from "./core/argument-engine.js"
export type {
    TLogicEngineOptions,
    TArgumentEngineSnapshot,
} from "./core/argument-engine.js"
export { PremiseEngine } from "./core/premise-engine.js"
export type { TPremiseEngineSnapshot } from "./core/premise-engine.js"
export type * from "./core/interfaces/index.js"
export type { TExpressionManagerSnapshot } from "./core/expression-manager.js"
export { VariableManager } from "./core/variable-manager.js"
export type { TVariableManagerSnapshot } from "./core/variable-manager.js"
export { ClaimLibrary } from "./core/claim-library.js"
export { SourceLibrary } from "./core/source-library.js"
export { VersionedLibrary } from "./core/versioned-library.js"
export type { TVersionedEntity } from "./core/versioned-library.js"
export { ClaimSourceLibrary } from "./core/claim-source-library.js"
export { ArgumentLibrary } from "./core/argument-library.js"
export type { TArgumentLibraryLibraries } from "./core/argument-library.js"
export { ForkNamespace } from "./core/fork-namespace.js"
export { ForkLibrary } from "./core/fork-library.js"
export { PropositCore } from "./core/proposit-core.js"
export type { TPropositCoreOptions } from "./core/proposit-core.js"
export * from "./types/evaluation.js"
export { gradeEvaluation } from "./core/evaluation/grading.js"
export type {
    TCoreEvaluationGrade,
    TCoreEvaluationGrading,
} from "./core/evaluation/grading.js"
export {
    evaluateArgument,
    checkArgumentValidity,
    propagateOperatorConstraints,
} from "./core/evaluation/argument-evaluation.js"
export type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "./core/evaluation/argument-evaluation.js"
export * from "./types/diff.js"
export * from "./types/mutation.js"
export { mergeChangesets, orderChangeset } from "./utils/changeset.js"
export type { TOrderedOperation } from "./utils/changeset.js"
export {
    createLookup,
    EMPTY_CLAIM_LOOKUP,
    EMPTY_SOURCE_LOOKUP,
    EMPTY_CLAIM_SOURCE_LOOKUP,
} from "./utils/lookup.js"
export * from "./types/checksum.js"
export {
    computeHash,
    canonicalSerialize,
    entityChecksum,
} from "./core/checksum.js"
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./core/diff.js"
export * from "./types/relationships.js"
export {
    analyzePremiseRelationships,
    buildPremiseProfile,
} from "./core/relationships.js"
export {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "./consts.js"
export { parseFormula } from "./core/parser/formula.js"
export type { TFormulaAST } from "./core/parser/formula.js"
export type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./core/expression-manager.js"
export {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    DEFAULT_POSITION_CONFIG,
    midpoint,
} from "./utils/position.js"
export type { TCorePositionConfig } from "./utils/position.js"
export * from "./types/reactive.js"
export * from "./types/grammar.js"
export * from "./types/fork.js"
export { forkArgumentEngine } from "./core/fork.js"
export * from "./parsing/index.js"
export * from "./types/validation.js"
export {
    validateArgument,
    validateArgumentAfterPremiseMutation,
    validateArgumentEvaluability,
    collectArgumentReferencedVariables,
} from "./core/argument-validation.js"
export type {
    TArgumentValidationContext,
    TValidatablePremise,
} from "./core/argument-validation.js"
export { InvariantViolationError } from "./core/invariant-violation-error.js"
export {
    InvalidArgumentStructureError,
    UnknownExpressionError,
    NotOperatorNotDecidableError,
} from "./core/review-errors.js"
export type { TNotOperatorNotDecidableReason } from "./core/review-errors.js"
