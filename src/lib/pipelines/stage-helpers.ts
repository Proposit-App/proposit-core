// Helpers that compose stages with sensible defaults.
//
// - `deterministicStage` — pure (or async-pure) compute, no LLM call.
// - `llmStage` — wraps an LLM call with structured-output validation
//   and the framework retry policy (schema-validation + transient).
// - `subPipelineStage` — recursively executes a nested pipeline as a
//   single stage in the outer pipeline. Reserved for future
//   composition; implemented + tested but unused by Phase 1 pipelines.

import type { TSchema } from "typebox"
import { Value } from "typebox/value"
import type {
    TDepSpec,
    TPipeline,
    TPipelineEvent,
    TStage,
    TStageContext,
} from "./types.js"
import type { TLlmRequest, TReasoningEffort, TToolSpec } from "../llm/types.js"
import { executePipeline } from "./execute.js"

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

export type TRetryReason = "schema_validation" | "transient" | "rate_limit"

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

const TRUNCATION_SUFFIX = "…<truncated>"

function truncateValidationError(error: string, capBytes: number): string {
    // NOTE: `capBytes` is measured in JavaScript `string.length` —
    // UTF-16 code units, not UTF-8 bytes. The spec (§6.3) phrases the
    // cap as "bytes"; for ASCII-heavy validation errors the two are
    // equal, and for non-ASCII paths a 2048 cap is roughly 2–4 KB of
    // UTF-8 depending on character distribution. We accept this drift
    // for V1: realistic TypeBox validation errors are short and
    // English; a future polish pass can switch to
    // `new TextEncoder().encode(error).length` if a real workload
    // shows the distinction matters.
    if (error.length <= capBytes) {
        return error
    }
    const head = Math.max(0, capBytes - TRUNCATION_SUFFIX.length)
    return error.slice(0, head) + TRUNCATION_SUFFIX
}

/**
 * Thrown by any stage when an `AbortSignal` cancels execution
 * mid-flight. The executor recognizes this class and marks the stage
 * as `skipped` (not `failed`); no `ProcessingFailure` is recorded
 * because a caller-driven cancellation is not a stage failure to
 * report. Distinguishing abort from a genuine provider error matters
 * for server-side cancellation observability (slice 2C's SSE bridge
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

function classifyError(err: unknown): TRetryReason | "non_retryable" {
    if (typeof err !== "object" || err === null) {
        return "non_retryable"
    }
    const tag = (err as { retryReason?: unknown }).retryReason
    if (tag === "transient" || tag === "rate_limit") {
        return tag
    }
    return "non_retryable"
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) return
    if (signal.aborted) return
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort)
            resolve()
        }, ms)
        const onAbort = (): void => {
            clearTimeout(timer)
            signal.removeEventListener("abort", onAbort)
            resolve()
        }
        signal.addEventListener("abort", onAbort, { once: true })
    })
}

function emitRetry(
    ctx: TStageContext,
    stageId: string,
    attempt: number,
    reason: TRetryReason
): void {
    const event: TPipelineEvent = {
        kind: "stage:retry",
        stageId,
        attempt,
        reason,
        at: now(),
    }
    ctx.emit(event)
}

function now(): number {
    return typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now()
}

// -- LLM stage --

export function llmStage<TOutput>(config: {
    id: string
    dependsOn: readonly TDepSpec[]
    outputSchema: TSchema
    model: string
    reasoningEffort?: TReasoningEffort
    buildPrompt: (ctx: TStageContext) => { system: string; user: string }
    tools?: readonly TToolSpec[]
    retry?: Partial<TRetryPolicy>
    maxOutputTokens?: number
}): TStage<TOutput> {
    const policy: TRetryPolicy = {
        ...DEFAULT_RETRY_POLICY,
        ...config.retry,
        retryOn: config.retry?.retryOn ?? DEFAULT_RETRY_POLICY.retryOn,
    }
    const errorCap =
        policy.maxAppendedErrorBytes ??
        DEFAULT_RETRY_POLICY.maxAppendedErrorBytes ??
        2048

    return {
        id: config.id,
        dependsOn: config.dependsOn,
        outputSchema: config.outputSchema,
        run: async (ctx) => {
            const prompt = config.buildPrompt(ctx)
            let userMessage = prompt.user
            let attempt = 0
            let lastError: {
                reason: TRetryReason
                code: string
                message: string
                context?: Record<string, unknown>
            } | null = null

            while (attempt < policy.maxAttempts) {
                attempt += 1
                if (ctx.signal.aborted) {
                    // Loop-top abort: caller cancelled before (or
                    // between) attempts. Surface as a `skipped` stage
                    // rather than a failure.
                    throw new StageAbortedError({ stageId: config.id })
                }

                const req: TLlmRequest<TOutput> = {
                    model: config.model,
                    reasoningEffort: config.reasoningEffort,
                    systemPrompt: prompt.system,
                    userMessage,
                    outputSchema: config.outputSchema,
                    tools: config.tools,
                    maxOutputTokens: config.maxOutputTokens,
                    signal: ctx.signal,
                }

                try {
                    const response = await ctx.llm.respond<TOutput>(req)
                    if (!Value.Check(config.outputSchema, response.output)) {
                        const errors = [
                            ...Value.Errors(
                                config.outputSchema,
                                response.output
                            ),
                        ]
                        const validationMessage = errors
                            .map((e) => `${e.instancePath}: ${e.message}`)
                            .join("; ")
                        lastError = {
                            reason: "schema_validation",
                            code: "OUTPUT_SCHEMA_INVALID",
                            message: validationMessage,
                        }
                        const retryable =
                            policy.retryOn.includes("schema_validation")
                        if (!retryable || attempt >= policy.maxAttempts) {
                            break
                        }
                        emitRetry(ctx, config.id, attempt, "schema_validation")
                        const truncated = truncateValidationError(
                            validationMessage,
                            errorCap
                        )
                        userMessage =
                            prompt.user +
                            "\n\nYour previous response failed schema validation: " +
                            truncated +
                            ". Please retry conforming to the schema."
                        await sleep(policy.backoffMs, ctx.signal)
                        continue
                    }

                    // Token usage emission is handled by the executor at
                    // stage:end time; we return the response output and
                    // attach the usage onto a side channel via failure-free
                    // path.
                    // We stash token usage on a per-stage well-known key
                    // recognized by the executor.
                    stashTokenUsage(ctx, config.id, response.tokenUsage)
                    return response.output
                } catch (err) {
                    if (
                        err instanceof LlmStageRetryExhaustedError &&
                        err.stageId === config.id
                    ) {
                        // Re-throw our own marker; the catch below shouldn't
                        // see it. Defensive.
                        throw err
                    }
                    if (err instanceof StageAbortedError) {
                        throw err
                    }
                    // Mid-flight abort surfaces here when the provider
                    // honored the signal and threw. Recognize it before
                    // classifying as a generic non-retryable failure so
                    // the executor can mark this stage `skipped`, not
                    // `failed` with `LLM_NON_RETRYABLE_ERROR`.
                    if (ctx.signal.aborted) {
                        throw new StageAbortedError({ stageId: config.id })
                    }
                    const reason = classifyError(err)
                    const message =
                        err instanceof Error ? err.message : String(err)
                    if (reason === "non_retryable") {
                        lastError = {
                            reason: "transient",
                            code: "LLM_NON_RETRYABLE_ERROR",
                            message,
                        }
                        break
                    }
                    lastError = {
                        reason,
                        code:
                            reason === "rate_limit"
                                ? "LLM_RATE_LIMITED"
                                : "LLM_TRANSIENT_ERROR",
                        message,
                    }
                    if (!policy.retryOn.includes(reason)) {
                        break
                    }
                    if (attempt >= policy.maxAttempts) {
                        break
                    }
                    emitRetry(ctx, config.id, attempt, reason)
                    await sleep(policy.backoffMs, ctx.signal)
                }
            }

            const failure = lastError ?? {
                reason: "transient" as const,
                code: "LLM_UNKNOWN_ERROR",
                message: "llmStage retry loop exited without error context",
            }
            throw new LlmStageRetryExhaustedError({
                stageId: config.id,
                reason: failure.reason,
                code: failure.code,
                attempts: attempt,
                message: failure.message,
                context: failure.context,
            })
        },
    }
}

// -- Token-usage side channel ---------------------------------------------
//
// llmStage and the executor share a tiny side-channel so the executor
// can attach token usage to the matching `stage:end` event without
// changing the stage `run` return shape. The side channel is a per-
// pipeline-run weak map keyed by the StageContext object.

const TOKEN_USAGE_CHANNELS = new WeakMap<
    TStageContext,
    Map<string, import("../llm/types.js").TLlmTokenUsage>
>()

function stashTokenUsage(
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
    }
}
