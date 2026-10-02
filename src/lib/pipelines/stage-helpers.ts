// Helpers that compose stages with sensible defaults.
//
// - `deterministicStage` — pure (or async-pure) compute, no LLM call.
// - `llmStage` — wraps an LLM call with structured-output validation
//   and the framework retry policy (schema-validation + transient).
//   Implementation lives in `llm-stage-helpers.ts`; this file re-exports
//   it (and its supporting seam functions) so the ~20 existing direct
//   import sites under `src/extensions/` and the public barrel see no
//   path change.
// - The retry policy, the stage errors and the token-usage side channel
//   live in `stage-primitives.ts`; this file re-exports them for the same
//   reason.
// - `subPipelineStage` — recursively executes a nested pipeline as a
//   single stage in the outer pipeline. Reserved for future
//   composition; implemented + tested but not yet used by any shipped
//   pipeline.

import type { TSchema } from "typebox"
import type {
    TDepSpec,
    TPipeline,
    TPipelineEvent,
    TStage,
    TStageContext,
} from "./types.js"
import { executePipeline } from "./scheduler.js"
import { SubPipelineFailedError } from "./stage-primitives.js"

export {
    readLlmStageConfig,
    isLlmStage,
    applyRetrySuffix,
    buildLlmRequest,
    validateLlmOutcome,
    failureRetryReason,
    llmStage,
} from "./llm-stage-helpers.js"
export type {
    TLlmOutputCheckFailure,
    TLlmStageConfig,
} from "./llm-stage-helpers.js"
export {
    DEFAULT_RETRY_POLICY,
    LlmStageRetryExhaustedError,
    StageAbortedError,
    SubPipelineFailedError,
    readStashedTokenUsage,
    stashTokenUsage,
} from "./stage-primitives.js"
export type { TRetryPolicy, TRetryReason } from "./stage-primitives.js"

// -- Deterministic --

export function deterministicStage<TOutput>(config: {
    id: string
    dependsOn: readonly TDepSpec[]
    outputSchema: TSchema
    fn: (ctx: TStageContext) => Promise<TOutput> | TOutput
}): TStage<TOutput> {
    return {
        id: config.id,
        dependsOn: config.dependsOn,
        outputSchema: config.outputSchema,
        run: async (ctx) => config.fn(ctx),
    }
}

// -- Sub-pipeline --

export function subPipelineStage<TOutput>(config: {
    id: string
    dependsOn: readonly TDepSpec[]
    pipeline: TPipeline<unknown, TOutput>
}): TStage<TOutput> {
    return {
        id: config.id,
        dependsOn: config.dependsOn,
        outputSchema: config.pipeline.outputSchema,
        run: async (ctx) => {
            const prefix = `${config.id}::`
            const forwarded: TStageContext["emit"] = (event) => {
                ctx.emit(prefixSubPipelineEvent(prefix, event))
            }
            const result = await executePipeline(config.pipeline, ctx.input, {
                llm: ctx.llm,
                generateId: ctx.generateId,
                signal: ctx.signal,
                onEvent: forwarded,
            })
            for (const failure of result.failures) {
                ctx.addFailure({
                    code: failure.code,
                    message: failure.message,
                    severity: failure.severity,
                    context: {
                        ...(failure.context ?? {}),
                        subPipelineStageId: config.id,
                        subPipelineStage: failure.stage,
                    },
                })
            }
            if (result.output === null) {
                throw new SubPipelineFailedError({
                    stageId: config.id,
                    code: "SUB_PIPELINE_NULL_OUTPUT",
                    message:
                        "Nested pipeline returned null output; the outer stage cannot complete.",
                    context: {
                        subPipelineId: config.pipeline.id,
                    },
                })
            }
            return result.output
        },
    }
}

function prefixSubPipelineEvent(
    prefix: string,
    event: TPipelineEvent
): TPipelineEvent {
    switch (event.kind) {
        case "pipeline:start":
            return { ...event, pipelineId: prefix + event.pipelineId }
        case "pipeline:end":
            return event
        case "stage:start":
            return { ...event, stageId: prefix + event.stageId }
        case "stage:end":
            return { ...event, stageId: prefix + event.stageId }
        case "stage:retry":
            return { ...event, stageId: prefix + event.stageId }
        case "stage:llm-request":
            return { ...event, stageId: prefix + event.stageId }
        case "stage:llm-response-created":
            return { ...event, stageId: prefix + event.stageId }
        case "stage:llm-text-delta":
            return { ...event, stageId: prefix + event.stageId }
        case "stage:llm-call":
            return { ...event, stageId: prefix + event.stageId }
        default: {
            // Exhaustiveness guard: a new TPipelineEvent variant added
            // without a case above fails compilation here (TS2322), so
            // the sub-pipeline prefixing can never silently drop one.
            const _exhaustive: never = event
            return _exhaustive
        }
    }
}
