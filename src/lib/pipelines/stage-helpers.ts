// Helpers that compose stages with sensible defaults.
//
// - `deterministicStage` — pure (or async-pure) compute, no LLM call.
// - `llmStage` — wraps an LLM call with structured-output validation
//   and the framework retry policy (schema-validation + transient).
// - `subPipelineStage` — recursively executes a nested pipeline as a
//   single stage in the outer pipeline. Reserved for future
//   composition; implemented + tested but not yet used by any shipped
//   pipeline.

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
import {
    LLM_NON_RETRYABLE_ERROR,
    LLM_QUOTA_EXHAUSTED,
    LLM_RATE_LIMITED,
    LLM_TRANSIENT_ERROR,
    LLM_UNKNOWN_ERROR,
    OUTPUT_SCHEMA_INVALID,
} from "./failure-codes.js"

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
    if (
        tag === "transient" ||
        tag === "rate_limit" ||
        tag === "quota_exhausted"
    ) {
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

                // Emit the pre-call stage-input event. Fires inside the
                // retry loop after `attempt` is incremented and after the
                // request is built, immediately before `respond()` — so a
                // consumer can surface the as-sent prompts the instant the
                // call starts, without waiting for the post-call
                // `stage:llm-call`. On attempt 2+ `userMessage` already
                // carries the retry-suffix appended by the prior attempt's
                // schema-validation failure path, matching this attempt's
                // eventual `stage:llm-call.prompts.user`.
                ctx.emit({
                    kind: "stage:llm-request",
                    stageId: config.id,
                    attempt,
                    prompts: {
                        system: prompt.system,
                        user: userMessage,
                    },
                    at: now(),
                })

                try {
                    const response = await ctx.llm.respond<TOutput>(req)

                    // When the provider surfaces a response id, emit
                    // the id-created event so consumers can persist
                    // it as early as possible. In synchronous mode this
                    // fires just after the call returns (completion-
                    // time only); in background+stream mode the id is
                    // available before any SSE bytes arrive, but the
                    // provider surfaces it here at return time (the
                    // background+stream branch inside the provider
                    // has already awaited the full stream by then).
                    // Either way the event fires before `stage:llm-call`
                    // on the same attempt, preserving the ordering
                    // guarantee for consumers.
                    if (response.rawResponseId) {
                        ctx.emit({
                            kind: "stage:llm-response-created",
                            stageId: config.id,
                            attempt,
                            responseId: response.rawResponseId,
                            at: now(),
                        })
                    }

                    const validationPassed = Value.Check(
                        config.outputSchema,
                        response.output
                    )
                    let validationError: string | undefined
                    if (!validationPassed) {
                        const errors = [
                            ...Value.Errors(
                                config.outputSchema,
                                response.output
                            ),
                        ]
                        validationError = errors
                            .map((e) => `${e.instancePath}: ${e.message}`)
                            .join("; ")
                    }

                    // Emit per-attempt LLM-call event. Fires after the
                    // call returns and after schema validation has run,
                    // before retry/return branching. `validationError`
                    // is `undefined` when the schema accepted the
                    // output, a string when it rejected. `prompts.user`
                    // is the as-sent message — on attempt 2+ this
                    // includes any retry-suffix appended by the prior
                    // attempt's schema-validation failure path.
                    ctx.emit({
                        kind: "stage:llm-call",
                        stageId: config.id,
                        attempt,
                        prompts: {
                            system: prompt.system,
                            user: userMessage,
                        },
                        output: response.output,
                        tokenUsage: response.tokenUsage,
                        rawResponseId: response.rawResponseId,
                        validationError,
                        at: now(),
                    })

                    if (!validationPassed) {
                        // validationError is defined here because
                        // validationPassed is false.
                        const validationMessage = validationError!
                        lastError = {
                            reason: "schema_validation",
                            code: OUTPUT_SCHEMA_INVALID,
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
                            code: LLM_NON_RETRYABLE_ERROR,
                            message,
                        }
                        break
                    }
                    lastError = {
                        reason,
                        code:
                            reason === "quota_exhausted"
                                ? LLM_QUOTA_EXHAUSTED
                                : reason === "rate_limit"
                                  ? LLM_RATE_LIMITED
                                  : LLM_TRANSIENT_ERROR,
                        message,
                    }
                    // Fail-fast for any reason not opted into `retryOn`.
                    // `quota_exhausted` is absent from every default
                    // policy, so a quota 429 breaks here on attempt 1 —
                    // same control flow `rate_limit` already takes.
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
                code: LLM_UNKNOWN_ERROR,
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
