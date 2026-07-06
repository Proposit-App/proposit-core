// The `llmStage` implementation and its supporting package-internal seam.
//
// `llmStage`'s body is factored into two package-internal seam functions
// — `buildLlmRequest` (prompt-build + `TLlmRequest` assembly) and
// `validateLlmOutcome` (parse → `Value.Check` → outcome/retry
// classification) — so the SAME logic backs both the in-process
// `llmStage.run` retry loop AND the launch/complete split
// (`launchStage`/`completeStage`, in `single-stage.ts`). None of this is
// exported from the package: there is no consumer use case, and
// `llmStage`'s public return type stays `TStage<TOutput>` (it does NOT
// widen). The resolved config rides an internal-symbol-keyed,
// non-enumerable carrier on the returned stage object, recovered only by
// the package-internal `readLlmStageConfig`.
//
// `stage-helpers.ts` re-exports every name this module exports (and
// nothing else moved) so the ~20 existing direct-import call sites under
// `src/extensions/` and the public barrel see no path change.

import type { TSchema } from "typebox"
import { Pointer, Value } from "typebox/value"
import type {
    TDepSpec,
    TPipelineEvent,
    TStage,
    TStageContext,
} from "./types.js"
import type {
    TLlmRequest,
    TReasoningEffort,
    TResponseStatus,
    TToolSpec,
} from "../llm/types.js"
import { debugMaxLengthTruncation } from "./debug-log.js"
import {
    LLM_NON_RETRYABLE_ERROR,
    LLM_QUOTA_EXHAUSTED,
    LLM_RATE_LIMITED,
    LLM_TRANSIENT_ERROR,
    LLM_UNKNOWN_ERROR,
    OUTPUT_SCHEMA_INVALID,
} from "./failure-codes.js"
import {
    StageAbortedError,
    stashTokenUsage,
    DEFAULT_RETRY_POLICY,
} from "./stage-helpers.js"
import type { TRetryPolicy, TRetryReason } from "./stage-helpers.js"

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

// -- LLM-stage seam (package-internal) ----------------------------------

/**
 * The resolved `llmStage` config the seam functions operate on (defaults
 * merged into `retryPolicy`). Package-internal — not exported.
 */
export type TLlmStageConfig<TOutput> = {
    id: string
    outputSchema: TSchema
    model: string
    reasoningEffort?: TReasoningEffort
    buildPrompt: (ctx: TStageContext) => { system: string; user: string }
    tools?: readonly TToolSpec[]
    maxOutputTokens?: number
    /** The resolved retry policy (factory defaults already merged). */
    retryPolicy: TRetryPolicy
    /**
     * Phantom field carrying the stage's structured-output type `TOutput`
     * through the seam (so `buildLlmRequest` / `validateLlmOutcome` recover
     * it). Always `undefined` at runtime.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _outputTypeMarker?: TOutput
}

// Internal-symbol key for the config carrier. Not exported, so no consumer
// can read or forge it; only this module's `readLlmStageConfig` recovers it.
const LLM_STAGE_CONFIG: unique symbol = Symbol("propositLlmStageConfig")

type TLlmStageCarrier<TOutput> = TStage<TOutput> & {
    readonly [LLM_STAGE_CONFIG]?: TLlmStageConfig<TOutput>
}

/**
 * Recover the resolved `llmStage` config from a stage built by
 * `llmStage`. Returns `undefined` for any stage that is not an LLM stage
 * (a deterministic / sub-pipeline stage carries no config). Package-internal.
 */
export function readLlmStageConfig<TOutput>(
    stage: TStage<TOutput>
): TLlmStageConfig<TOutput> | undefined {
    return (stage as TLlmStageCarrier<TOutput>)[LLM_STAGE_CONFIG]
}

/**
 * True iff `stage` is an LLM-background stage — one built by `llmStage` that
 * carries the resolved LLM config and is therefore driven by `launchStage` /
 * `completeStage`. False for deterministic and sub-pipeline stages (drive those
 * with `executeStage`). Mirrors exactly the check `launchStage`/`completeStage`
 * apply internally, so a consumer driving a pipeline out-of-process can route a
 * stage to the right driver without catching a thrown `PipelineConfigurationError`.
 */
export function isLlmStage<TOutput>(stage: TStage<TOutput>): boolean {
    return readLlmStageConfig(stage) != null
}

/**
 * Append the retry-suffix the in-process loop adds after a failed
 * schema-validation attempt. Shared by the loop and `launchStage` (so a
 * re-launched attempt 2+ rebuilds the identical `userMessage`).
 * Package-internal.
 */
export function applyRetrySuffix(
    baseUser: string,
    validationError: string,
    errorCap: number
): string {
    const truncated = truncateValidationError(validationError, errorCap)
    return (
        baseUser +
        "\n\nYour previous response failed schema validation: " +
        truncated +
        ". Please retry conforming to the schema."
    )
}

// Resolved error-cap for a config's retry policy (the per-retry appended
// validation-error byte bound), defaulted the same way the factory does.
function resolveErrorCap(policy: TRetryPolicy): number {
    return (
        policy.maxAppendedErrorBytes ??
        DEFAULT_RETRY_POLICY.maxAppendedErrorBytes ??
        2048
    )
}

/**
 * Front half of the seam: build the per-attempt prompts + `TLlmRequest`.
 * `userMessage` overrides the prompt's user message (the loop / launch
 * pass the retry-suffixed message on attempt 2+); it defaults to
 * `buildPrompt(ctx).user`. The returned `req` carries NO `onResponseCreated`
 * — the in-process loop attaches its own emitter; the launch path uses the
 * submit return value instead. Package-internal.
 */
export function buildLlmRequest<TOutput>(
    cfg: TLlmStageConfig<TOutput>,
    ctx: TStageContext,
    userMessage?: string
): { req: TLlmRequest<TOutput>; prompts: { system: string; user: string } } {
    const prompt = cfg.buildPrompt(ctx)
    const user = userMessage ?? prompt.user
    const req: TLlmRequest<TOutput> = {
        model: cfg.model,
        reasoningEffort: cfg.reasoningEffort,
        systemPrompt: prompt.system,
        userMessage: user,
        outputSchema: cfg.outputSchema,
        tools: cfg.tools,
        maxOutputTokens: cfg.maxOutputTokens,
        signal: ctx.signal,
    }
    return { req, prompts: { system: prompt.system, user } }
}

// The genuinely-shared validation core: check a PARSED output value
// against the stage schema and format the validation error. Used by both
// the in-process loop (output already parsed by the provider) and
// `validateLlmOutcome`'s completed branch (output parsed from raw text).
// Truncate every string longer than its schema's `maxLength` to that cap,
// mutating `value` in place. Driven off the validator's own `maxLength`
// errors (which carry the JSON-pointer path + the limit), so it handles
// nested objects, arrays, and discriminated unions without walking the
// schema by hand. Re-runs because a union surfaces a failing variant's
// inner errors only once its siblings are reconciled; truncation is
// monotonic (strings only shrink) so the loop converges. The pass cap is a
// backstop against a degenerate schema.
//
// Truncation is non-fatal (ingestion output is human-proofread before
// publish), so it does not surface to the caller. It does emit a
// debug-gated breadcrumb per clipped field — the only signal of whether
// the upstream length steering (shrunk wire `maxLength` + budget hint)
// is still letting overshoots through. `stageId` tags the breadcrumb so
// it groups with the stage's other diagnostic lines.
function clampMaxLengthStrings(
    stageId: string,
    schema: TSchema,
    value: unknown
): void {
    for (let pass = 0; pass < 16; pass++) {
        let changed = false
        for (const err of Value.Errors(schema, value)) {
            if (err.keyword !== "maxLength") continue
            const limit = err.params.limit
            const current = Pointer.Get(value, err.instancePath)
            if (typeof current === "string" && current.length > limit) {
                debugMaxLengthTruncation({
                    stageId,
                    instancePath: err.instancePath,
                    limit,
                    originalLength: current.length,
                })
                Pointer.Set(value, err.instancePath, current.slice(0, limit))
                changed = true
            }
        }
        if (!changed) break
    }
}

function checkLlmOutput<TOutput>(
    cfg: TLlmStageConfig<TOutput>,
    output: unknown
): { valid: boolean; validationError?: string } {
    if (Value.Check(cfg.outputSchema, output)) {
        return { valid: true }
    }
    // OpenAI strict structured-output IGNORES JSON-Schema string `maxLength`,
    // so a model can return an over-long string the schema forbids — a
    // recoverable issue that must NOT fail the whole stage. Truncate any
    // over-long string to its declared cap (in place) and re-check, rather
    // than rejecting the output and halting the pipeline.
    clampMaxLengthStrings(cfg.id, cfg.outputSchema, output)
    if (Value.Check(cfg.outputSchema, output)) {
        return { valid: true }
    }
    const errors = [...Value.Errors(cfg.outputSchema, output)]
    const validationError = errors
        .map((e) => `${e.instancePath}: ${e.message}`)
        .join("; ")
    return { valid: false, validationError }
}

/**
 * Back half of the seam: turn a retrieved background response (RAW
 * assistant text + terminal status + `incompleteReason`) into an outcome
 * + optional typed output + a retry classification.
 *
 * The parse + `Value.Check` half is genuinely shared with the in-process
 * loop (via `checkLlmOutput`). The status/reason → outcome+retry mapping
 * is a DELIBERATE `lib/`-side MIRROR of the OpenAI provider's
 * classification (`extensions/openai/provider.ts`): `src/lib/` may not
 * import the extension classifier (the zero-SDK-import invariant), so the
 * mapping is duplicated here and pinned to the provider by a contract test.
 * Package-internal.
 */
export function validateLlmOutcome<TOutput>(
    cfg: TLlmStageConfig<TOutput>,
    rawText: string | undefined,
    status: TResponseStatus,
    incompleteReason: string | undefined
): {
    outcome: "completed" | "failed" | "skipped"
    output?: TOutput
    failure?: { reason: TRetryReason; code: string; message: string }
    validationError?: string
} {
    if (status === "completed") {
        // Parse the RAW assistant text first. A parse throw mirrors the
        // provider's `SchemaValidationLlmError` (malformed structured-output
        // JSON), which classifies as retryable `schema_validation`.
        let parsed: unknown
        try {
            parsed = JSON.parse(rawText ?? "") as unknown
        } catch (err) {
            const message = `Provider returned malformed JSON in structured-output text: ${
                err instanceof Error ? err.message : String(err)
            }`
            return {
                outcome: "failed",
                failure: {
                    reason: "schema_validation",
                    code: OUTPUT_SCHEMA_INVALID,
                    message,
                },
                validationError: message,
            }
        }
        const checked = checkLlmOutput(cfg, parsed)
        if (checked.valid) {
            return { outcome: "completed", output: parsed as TOutput }
        }
        const validationError =
            checked.validationError ?? "schema validation failed"
        return {
            outcome: "failed",
            failure: {
                reason: "schema_validation",
                code: OUTPUT_SCHEMA_INVALID,
                message: validationError,
            },
            validationError,
        }
    }

    if (status === "cancelled") {
        // A cancelled background response mirrors a mid-flight abort:
        // recorded `skipped`, NO `ProcessingFailure`, so a consumer can
        // distinguish a cancel from a genuine error.
        return { outcome: "skipped" }
    }

    if (status === "incomplete") {
        const reason = incompleteReason ?? "unspecified"
        if (reason === "content_filter") {
            // Deterministic — the policy filter won't change on a re-roll;
            // fail-fast (NO retryReason), mirroring NonRetryableLlmError.
            return {
                outcome: "failed",
                failure: {
                    reason: "transient",
                    code: LLM_NON_RETRYABLE_ERROR,
                    message: formatIncompleteMirror(reason),
                },
            }
        }
        // `max_output_tokens` and any other/unspecified reason → retryable
        // transient (mirrors the provider's conservative TransientLlmError).
        return {
            outcome: "failed",
            failure: {
                reason: "transient",
                code: LLM_TRANSIENT_ERROR,
                message: formatIncompleteMirror(reason),
            },
        }
    }

    // status === "failed" (or any other non-terminal value reaching here):
    // a terminal failed envelope is NonRetryableLlmError → fail-fast (NO
    // retryReason). `transient` would be WRONG (it's in the default
    // retryOn, so the workflow would retry a definitively-failed response).
    return {
        outcome: "failed",
        failure: {
            reason: "transient",
            code: LLM_NON_RETRYABLE_ERROR,
            message: `Provider returned status "${status}".`,
        },
    }
}

// `lib/`-side mirror of the provider's incomplete-reason message. Kept
// terse + reason-naming (the provider's full guidance text lives in
// `extensions/openai/provider.ts#formatIncompleteMessage`, which `lib/`
// cannot import).
function formatIncompleteMirror(reason: string): string {
    return `Provider returned status "incomplete" (reason: ${reason}).`
}

// Whether the failure's `reason` is a RETRYABLE classification to surface
// on `TExecuteStageResult.retryReason`. Fail-fast failures carry a
// `non-retryable` code (LLM_NON_RETRYABLE_ERROR) and surface NO
// retryReason; the genuinely-retryable reasons are the workflow's
// re-launch signal. Package-internal.
export function failureRetryReason(failure: {
    reason: TRetryReason
    code: string
}): TRetryReason | undefined {
    if (failure.code === LLM_NON_RETRYABLE_ERROR) return undefined
    return failure.reason
}

// -- LLM stage --

type TLastError = {
    reason: TRetryReason
    code: string
    message: string
    context?: Record<string, unknown>
}

type TAttemptResult<TOutput> =
    | { kind: "success"; output: TOutput }
    | { kind: "retry"; lastError: TLastError; nextUserMessage: string }
    | { kind: "exhausted"; lastError: TLastError }

// Run one attempt of `llmStage`'s retry loop: build + emit the request,
// call the provider, validate/classify the outcome, and (on a retryable
// failure) sleep out the backoff. Extracted from `llmStage` — the retry
// loop's single attempt body was the bulk of that function.
async function runLlmStageAttempt<TOutput>(
    cfg: TLlmStageConfig<TOutput>,
    ctx: TStageContext,
    prompt: { system: string; user: string },
    policy: TRetryPolicy,
    errorCap: number,
    attempt: number,
    userMessage: string
): Promise<TAttemptResult<TOutput>> {
    if (ctx.signal.aborted) {
        // Loop-top abort: caller cancelled before (or between) attempts.
        // Surface as a `skipped` stage rather than a failure.
        throw new StageAbortedError({ stageId: cfg.id })
    }

    // Emit the `stage:llm-response-created` event the moment the provider
    // surfaces a response id. In background-stream mode this fires
    // MID-FLIGHT — before `respond()` resolves — from the provider's
    // `onResponseCreated` callback (the first `response.created` SSE
    // event). That early emit is load-bearing: a consumer persists the id
    // before a possible crash, so a call interrupted mid-generation can be
    // recovered from the upstream's stored copy rather than blindly
    // re-run. In synchronous mode the callback never fires; the id is
    // surfaced only at completion (below). The `responseIdEmitted` flag
    // dedupes so the event fires at most once per attempt.
    let responseIdEmitted = false
    const emitResponseCreated = (responseId: string): void => {
        if (responseIdEmitted) return
        responseIdEmitted = true
        ctx.emit({
            kind: "stage:llm-response-created",
            stageId: cfg.id,
            attempt,
            responseId,
            at: now(),
        })
    }

    // Build the request via the shared seam, then attach this attempt's
    // mid-flight id emitter (the seam leaves `onResponseCreated` unset —
    // the launch path uses the submit return value instead).
    const { req } = buildLlmRequest(cfg, ctx, userMessage)
    req.onResponseCreated = emitResponseCreated

    // Emit the pre-call stage-input event. Fires inside the retry loop
    // after `attempt` is incremented and after the request is built,
    // immediately before `respond()` — so a consumer can surface the
    // as-sent prompts the instant the call starts, without waiting for the
    // post-call `stage:llm-call`. On attempt 2+ `userMessage` already
    // carries the retry-suffix appended by the prior attempt's
    // schema-validation failure path, matching this attempt's eventual
    // `stage:llm-call.prompts.user`.
    ctx.emit({
        kind: "stage:llm-request",
        stageId: cfg.id,
        attempt,
        prompts: {
            system: prompt.system,
            user: userMessage,
        },
        at: now(),
    })

    try {
        const response = await ctx.llm.respond<TOutput>(req)

        // Completion-time fallback: if the provider surfaced an id but did
        // NOT fire the mid-flight callback (the synchronous / poll paths),
        // emit here so the event still precedes `stage:llm-call` on this
        // attempt.
        if (response.rawResponseId) {
            emitResponseCreated(response.rawResponseId)
        }

        // Shared validation core (same check the launch/complete path
        // runs via validateLlmOutcome's completed branch).
        const checked = checkLlmOutput(cfg, response.output)
        const validationPassed = checked.valid
        const validationError = checked.validationError

        // Emit per-attempt LLM-call event. Fires after the call returns
        // and after schema validation has run, before retry/return
        // branching. `validationError` is `undefined` when the schema
        // accepted the output, a string when it rejected. `prompts.user`
        // is the as-sent message — on attempt 2+ this includes any
        // retry-suffix appended by the prior attempt's schema-validation
        // failure path.
        ctx.emit({
            kind: "stage:llm-call",
            stageId: cfg.id,
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
            // validationError is defined here because validationPassed is
            // false.
            const validationMessage = validationError!
            const lastError: TLastError = {
                reason: "schema_validation",
                code: OUTPUT_SCHEMA_INVALID,
                message: validationMessage,
            }
            const retryable = policy.retryOn.includes("schema_validation")
            if (!retryable || attempt >= policy.maxAttempts) {
                return { kind: "exhausted", lastError }
            }
            emitRetry(ctx, cfg.id, attempt, "schema_validation")
            const nextUserMessage = applyRetrySuffix(
                prompt.user,
                validationMessage,
                errorCap
            )
            await sleep(policy.backoffMs, ctx.signal)
            return { kind: "retry", lastError, nextUserMessage }
        }

        // Token usage emission is handled by the executor at stage:end
        // time; we return the response output and attach the usage onto a
        // side channel via failure-free path. We stash token usage on a
        // per-stage well-known key recognized by the executor.
        stashTokenUsage(ctx, cfg.id, response.tokenUsage)
        return { kind: "success", output: response.output }
    } catch (err) {
        if (
            err instanceof LlmStageRetryExhaustedError &&
            err.stageId === cfg.id
        ) {
            // Re-throw our own marker; the catch below shouldn't see it.
            // Defensive.
            throw err
        }
        if (err instanceof StageAbortedError) {
            throw err
        }
        // Mid-flight abort surfaces here when the provider honored the
        // signal and threw. Recognize it before classifying as a generic
        // non-retryable failure so the executor can mark this stage
        // `skipped`, not `failed` with `LLM_NON_RETRYABLE_ERROR`.
        if (ctx.signal.aborted) {
            throw new StageAbortedError({ stageId: cfg.id })
        }
        const reason = classifyError(err)
        const message = err instanceof Error ? err.message : String(err)
        if (reason === "non_retryable") {
            return {
                kind: "exhausted",
                lastError: {
                    reason: "transient",
                    code: LLM_NON_RETRYABLE_ERROR,
                    message,
                },
            }
        }
        const lastError: TLastError = {
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
        // `quota_exhausted` is absent from every default policy, so a
        // quota 429 breaks here on attempt 1 — same control flow
        // `rate_limit` already takes.
        if (!policy.retryOn.includes(reason)) {
            return { kind: "exhausted", lastError }
        }
        if (attempt >= policy.maxAttempts) {
            return { kind: "exhausted", lastError }
        }
        emitRetry(ctx, cfg.id, attempt, reason)
        await sleep(policy.backoffMs, ctx.signal)
        return { kind: "retry", lastError, nextUserMessage: userMessage }
    }
}

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
    const errorCap = resolveErrorCap(policy)

    const cfg: TLlmStageConfig<TOutput> = {
        id: config.id,
        outputSchema: config.outputSchema,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        buildPrompt: config.buildPrompt,
        tools: config.tools,
        maxOutputTokens: config.maxOutputTokens,
        retryPolicy: policy,
    }

    const stage: TStage<TOutput> = {
        id: config.id,
        dependsOn: config.dependsOn,
        outputSchema: config.outputSchema,
        run: async (ctx) => {
            const prompt = config.buildPrompt(ctx)
            let userMessage = prompt.user
            let attempt = 0
            let lastError: TLastError | null = null

            while (attempt < policy.maxAttempts) {
                attempt += 1
                const result = await runLlmStageAttempt(
                    cfg,
                    ctx,
                    prompt,
                    policy,
                    errorCap,
                    attempt,
                    userMessage
                )
                if (result.kind === "success") {
                    return result.output
                }
                lastError = result.lastError
                if (result.kind === "exhausted") {
                    break
                }
                userMessage = result.nextUserMessage
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

    // Attach the resolved config on a non-enumerable, internal-symbol-keyed
    // carrier so `launchStage`/`completeStage` (same package) can recover it
    // via `readLlmStageConfig`. Non-enumerable + symbol-keyed keeps it off
    // every enumeration and JSON serialization of the stage object, and out
    // of the public `TStage` shape.
    Object.defineProperty(stage, LLM_STAGE_CONFIG, {
        value: cfg,
        enumerable: false,
        writable: false,
        configurable: false,
    })
    return stage
}
