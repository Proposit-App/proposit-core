// Leaf definitions shared by the stage helpers, the stage runner and the
// scheduler: the retry policy and its reasons, the errors a stage run can
// end in, the token-usage side channel, and the clock. Kept in a module of
// its own that imports only types, so the modules that use these can import
// them without importing each other.

import type { TStageContext } from "./types.js"

export class PipelineConfigurationError extends Error {
    public readonly code:
        | "DAG_CYCLE"
        | "SELF_DEP"
        | "UNKNOWN_DEP"
        | "UNKNOWN_STAGE"
        | "DUPLICATE_STAGE_ID"
        | "GET_OUTSIDE_DEPS"
        | "STATUS_OUTSIDE_DEPS"
    public readonly stageId?: string
    public readonly depId?: string

    constructor(args: {
        code: PipelineConfigurationError["code"]
        message: string
        stageId?: string
        depId?: string
    }) {
        super(args.message)
        this.name = "PipelineConfigurationError"
        this.code = args.code
        this.stageId = args.stageId
        this.depId = args.depId
    }
}

export function now(): number {
    return typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()
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
// llmStage (in llm-stage-helpers.ts) and the stage runner (in
// stage-runner.ts) share a tiny side-channel so the runner can attach
// token usage to the matching `stage:end` event without changing the
// stage `run` return shape. The side channel is a per-pipeline-run weak
// map keyed by the StageContext object. `llmStage` writes into it with
// `stashTokenUsage`; the stage runner reads it with
// `readStashedTokenUsage`.

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

/**
 * Thrown internally by `llmStage` after retry exhaustion. The
 * executor catches it and converts it into a `ProcessingFailure`.
 */
export class LlmStageRetryExhaustedError extends Error {
    public readonly reason: TRetryReason
    public readonly code: string
    public readonly attempts: number
    public readonly stageId: string
    public readonly failureContext: Record<string, unknown> | undefined

    constructor(args: {
        stageId: string
        reason: TRetryReason
        code: string
        attempts: number
        message: string
        context?: Record<string, unknown>
    }) {
        super(args.message)
        this.name = "LlmStageRetryExhaustedError"
        this.stageId = args.stageId
        this.reason = args.reason
        this.code = args.code
        this.attempts = args.attempts
        this.failureContext = args.context
    }
}
