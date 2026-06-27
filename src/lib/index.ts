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
export { validateDerivationStructure } from "./utils/derivation-validation.js"
export type * from "./core/interfaces/index.js"
export type { TExpressionManagerSnapshot } from "./core/expression-manager.js"
export { VariableManager } from "./core/variable-manager.js"
export type { TVariableManagerSnapshot } from "./core/variable-manager.js"
export { ClaimLibrary } from "./core/claim-library.js"
export type { TClaimCreateInput } from "./core/claim-library.js"
export { VersionedLibrary } from "./core/versioned-library.js"
export type { TVersionedEntity } from "./core/versioned-library.js"
export { ClaimCitationLibrary } from "./core/claim-citation-library.js"
export { ClaimAxiomLibrary } from "./core/claim-axiom-library.js"
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
    emptyClaimConnectionLookup,
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
// The barrel exports the expression-manager *data* types (snapshot +
// inputs), not the `ExpressionManager` class itself — it is internal
// engine machinery referenced only by `PremiseEngine`'s protected
// `expressions` member. typedoc's `intentionallyNotExported` suppresses
// the "referenced but not documented" warning rather than leaking the
// class (and its `ChangeCollector` dependency) into the public docs.
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
export {
    GrammarTierSchema,
    GrammarRuleCodeSchema,
    ViolationSchema,
} from "./grammar/types.js"
export type {
    TGrammarTier,
    TGrammarRuleCode,
    TViolation,
} from "./grammar/types.js"
export { validate as validateGrammar } from "./grammar/validate.js"
export type { TValidatorContext } from "./grammar/validators/context.js"
export type { TPopulateResult } from "./grammar/populate-from.js"
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
    executePipeline,
    executeStage,
    executeFinalize,
    launchStage,
    completeStage,
    optional,
    deterministicStage,
    llmStage,
    subPipelineStage,
    isLlmStage,
    DEFAULT_RETRY_POLICY,
    PipelineConfigurationError,
    LlmStageRetryExhaustedError,
    StageAbortedError,
    SubPipelineFailedError,
    LLM_QUOTA_EXHAUSTED,
    LLM_RATE_LIMITED,
    LLM_TRANSIENT_ERROR,
    LLM_NON_RETRYABLE_ERROR,
    LLM_UNKNOWN_ERROR,
    OUTPUT_SCHEMA_INVALID,
} from "./pipelines/index.js"
export type {
    TStage,
    TStageContext,
    TStageStatus,
    TPipeline,
    TPipelineFinalize,
    TProcessingFailure,
    TPipelineResult,
    TPipelineEvent,
    TDepSpec,
    TOptionalDep,
    TRetryPolicy,
    TRetryReason,
    TExecutePipelineDeps,
    TStageOutcomeRecord,
    TExecuteStageDeps,
    TExecuteStageResult,
    TExecuteFinalizeResult,
    TLaunchStageResult,
} from "./pipelines/index.js"
export type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
    TLlmTokenUsage,
    TLlmModel,
    TReasoningEffort,
    TToolSpec,
    TResponseStatus,
    TRetrievedResponse,
} from "./llm/index.js"
// Concrete OpenAI Responses-API provider, surfaced from the lib
// barrel for ergonomic single-import access from consumers
// (`@proposit/proposit-core` package-root import). The provider also
// has a dedicated subpath export at `@proposit/proposit-core/extensions/openai`
// for callers that prefer to tree-shake provider machinery out of
// their builds.
export { createOpenAiResponsesProvider } from "../extensions/openai/index.js"
export type {
    TCreateOpenAiResponsesProviderOptions,
    TOpenAiFetch,
} from "../extensions/openai/index.js"
export {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
} from "../extensions/openai/index.js"
// NOTE: the ingestion pipelines + their task contract are NOT re-exported
// from this root barrel. They ship as their own subpaths —
// `@proposit/proposit-core/pipelines/base` (the shared contract +
// helpers) and `@proposit/proposit-core/pipelines/ingestion` (the
// `createScholarPipeline` / `createScribePipeline` factories). The root
// barrel carries only the engine, the pipeline framework, and the
// provider extensions.
export {
    InvalidArgumentStructureError,
    UnknownExpressionError,
    NotOperatorNotDecidableError,
} from "./core/review-errors.js"
export type { TNotOperatorNotDecidableReason } from "./core/review-errors.js"
export { collectArgumentReferencedClaims } from "./core/review-helpers.js"
export type { TCollectArgumentReferencedClaimsResult } from "./core/review-helpers.js"
export { canonicalizeOperatorAssignments } from "./core/review-helpers.js"
export type { TCanonicalizeOperatorAssignmentsInput } from "./core/review-helpers.js"
// Conversation primitive — multi-turn LLM exchange support.
// Subpath: @proposit/proposit-core/conversation
export {
    executeTurn,
    createConversation,
    ConversationClosedError,
} from "./conversation/index.js"
export type {
    TTurnInput,
    TTurnResult,
    TExecuteTurnDeps,
    TConversation,
    TMultiTurnInput,
    TMultiTurnOutput,
    TResponseId,
} from "./conversation/index.js"
// Builder extension — Argument Builder turn factories.
// Subpath: @proposit/proposit-core/builder
export {
    createReviewTurn,
    createSimulateTurn,
    createDistillTurn,
} from "../extensions/builder/index.js"
export type { TDistillTurnOptions } from "../extensions/builder/index.js"
