// Helpers that compose stages with sensible defaults.
//
// - `deterministicStage` — pure (or async-pure) compute, no LLM call.
// - `llmStage` — wraps an LLM call with structured-output validation
//   and the framework retry policy (schema-validation + transient).
//   Implementation lives in `llm-stage-helpers.ts`; this file re-exports
//   it (and its supporting seam functions) so the ~20 existing direct
//   import sites under `src/extensions/` and the public barrel see no
//   path change.
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

export {
    readLlmStageConfig,
    isLlmStage,
    applyRetrySuffix,
    buildLlmRequest,
    validateLlmOutcome,
    failureRetryReason,
    llmStage,
    LlmStageRetryExhaustedError,
} from "./llm-stage-helpers.js"
export type { TLlmStageConfig } from "./llm-stage-helpers.js"

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

// -- Retry policy --

export type TRetryReason =
    | "schema_validation"
    | "transient"
    | "rate_limit"
    | "quota_exhausted"

export type TRetryPolicy = {
    maxAttempts: number
    backoffMs: number
    retryOn: readonly TRetryReason[]
    /** Bound on the per-retry appended validation-error fragment. */
    maxAppendedErrorBytes?: number
}

export const DEFAULT_RETRY_POLICY: TRetryPolicy = {
    maxAttempts: 2,
    backoffMs: 500,
    retryOn: ["schema_validation", "transient"],
    maxAppendedErrorBytes: 2048,
}

/**
 * Thrown by any stage when an `AbortSignal` cancels execution
 * mid-flight. The executor recognizes this class and marks the stage
 * as `skipped` (not `failed`); no `ProcessingFailure` is recorded
 * because a caller-driven cancellation is not a stage failure to
 * report. Distinguishing abort from a genuine provider error matters
 * for server-side cancellation observability (a server SSE bridge
 * routes these differently).
 */
export class StageAbortedError extends Error {
    public readonly stageId: string

    constructor(args: { stageId: string; message?: string }) {
        super(args.message ?? "aborted")
        this.name = "StageAbortedError"
        this.stageId = args.stageId
    }
}

// -- Token-usage side channel ---------------------------------------------
//
// llmStage (in llm-stage-helpers.ts) and the executor (in scheduler.ts)
// share a tiny side-channel so the executor can attach token usage to the
// matching `stage:end` event without changing the stage `run` return
// shape. The side channel is a per-pipeline-run weak map keyed by the
// StageContext object. `stashTokenUsage` is exported (rather than kept
// module-private) solely so `llmStage`'s implementation, which now lives
// in the sibling `llm-stage-helpers.ts`, can write into the same map
// `readStashedTokenUsage` reads from.

const TOKEN_USAGE_CHANNELS = new WeakMap<
    TStageContext,
    Map<string, import("../llm/types.js").TLlmTokenUsage>
>()

export function stashTokenUsage(
    ctx: TStageContext,
    stageId: string,
    usage: import("../llm/types.js").TLlmTokenUsage
): void {
    let bucket = TOKEN_USAGE_CHANNELS.get(ctx)
    if (!bucket) {
        bucket = new Map()
        TOKEN_USAGE_CHANNELS.set(ctx, bucket)
    }
    bucket.set(stageId, usage)
}

export function readStashedTokenUsage(
    ctx: TStageContext,
    stageId: string
): import("../llm/types.js").TLlmTokenUsage | undefined {
    return TOKEN_USAGE_CHANNELS.get(ctx)?.get(stageId)
}

/**
 * Thrown by `subPipelineStage`'s wrapper when the nested pipeline
 * returns `output: null` (any required dep of its finalize was
 * skipped/failed, or its finalize itself returned null). The wrapper
 * surfaces this as a stage failure on the outer pipeline so the
 * caller sees a clean per-stage failure rather than an LLM-flavored
 * misnomer. Kept separate from `LlmStageRetryExhaustedError` because
 * no LLM call and no retry are involved.
 */
export class SubPipelineFailedError extends Error {
    public readonly stageId: string
    public readonly code: string
    public readonly failureContext: Record<string, unknown> | undefined

    constructor(args: {
        stageId: string
        code: string
        message: string
        context?: Record<string, unknown>
    }) {
        super(args.message)
        this.name = "SubPipelineFailedError"
        this.stageId = args.stageId
        this.code = args.code
        this.failureContext = args.context
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
