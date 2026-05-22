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
    DEFAULT_RETRY_POLICY,
    LlmStageRetryExhaustedError,
} from "./stage-helpers.js"
export type { TRetryPolicy, TRetryReason } from "./stage-helpers.js"

export { executePipeline, PipelineConfigurationError } from "./execute.js"
export type { TExecutePipelineDeps } from "./execute.js"
