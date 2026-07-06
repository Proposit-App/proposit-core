// Public barrel for the pipeline framework.

export {
    optional,
    isOptionalDep,
    depId,
    ProcessingFailureSchema,
} from "./types.js"
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

export { executePipeline, PipelineConfigurationError } from "./scheduler.js"
export type { TExecutePipelineDeps } from "./scheduler.js"

export {
    executeStage,
    executeFinalize,
    launchStage,
    completeStage,
} from "./single-stage.js"
export type {
    TStageOutcomeRecord,
    TExecuteStageDeps,
    TExecuteStageResult,
    TExecuteFinalizeResult,
    TLaunchStageResult,
} from "./single-stage.js"

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
    debugMaxLengthTruncation,
} from "./debug-log.js"
