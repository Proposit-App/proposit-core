// Public barrel for the pipeline framework.

export { optional, isOptionalDep, depId } from "./types.js"
export type {
    TDepSpec,
    TOptionalDep,
    TStage,
    TStageContext,
    TStageStatus,
    TPipeline,
    TPipelineFinalize,
    TProcessingFailure,
    TPipelineResult,
    TPipelineEvent,
} from "./types.js"

export {
    deterministicStage,
    llmStage,
    subPipelineStage,
    isLlmStage,
    DEFAULT_RETRY_POLICY,
    LlmStageRetryExhaustedError,
    StageAbortedError,
    SubPipelineFailedError,
} from "./stage-helpers.js"
export type { TRetryPolicy, TRetryReason } from "./stage-helpers.js"

export {
    executePipeline,
    executeStage,
    executeFinalize,
    launchStage,
    completeStage,
    PipelineConfigurationError,
} from "./execute.js"
export type {
    TExecutePipelineDeps,
    TStageOutcomeRecord,
    TExecuteStageDeps,
    TExecuteStageResult,
    TExecuteFinalizeResult,
    TLaunchStageResult,
} from "./execute.js"

export {
    LLM_QUOTA_EXHAUSTED,
    LLM_RATE_LIMITED,
    LLM_TRANSIENT_ERROR,
    LLM_NON_RETRYABLE_ERROR,
    LLM_UNKNOWN_ERROR,
    OUTPUT_SCHEMA_INVALID,
} from "./failure-codes.js"

export {
    isDebugEnabled,
    PROPOSIT_PIPELINE_DEBUG_ENV_VAR,
    PROPOSIT_PIPELINE_DEBUG_PREFIX,
    debugPipelineStart,
    debugPipelineEnd,
    debugStageStart,
    debugStageEnd,
    debugLlmRequest,
    debugLlmResponse,
    debugLlmFailure,
} from "./debug-log.js"
