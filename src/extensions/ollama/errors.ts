// Ollama-provider error classes + the `classifyOllamaError` mapping.
//
// The framework's `llmStage` retry policy classifies provider errors
// by inspecting a `retryReason` tag on the thrown object (see
// `src/lib/pipelines/stage-helpers.ts` #classifyError) — NOT by class
// identity. The failure *codes* live in the SDK-free
// `src/lib/pipelines/failure-codes.ts`. So these Ollama classes carry
// the same `retryReason` tags as the OpenAI provider's classes and set
// their `code` from the lib constants. They deliberately do NOT import
// from `extensions/openai/` and do NOT touch `src/lib/`.
//
// Mapping for the framework's default retry policy
// (`retryOn: ["schema_validation", "transient"]`):
//
//   * `TransientLlmError` — `retryReason: "transient"`. Genuinely
//     transient local hiccups: mid-stream `ECONNRESET`/socket drop,
//     cold-model-load 5xx (model pulled but still loading into VRAM),
//     generic 5xx. Retried by the default policy.
//   * `RateLimitLlmError` — `retryReason: "rate_limit"`. A local
//     daemon rarely rate-limits, but a remote-Ollama / proxy setup can
//     return 429; mapped for contract parity. Not in the default
//     `retryOn`, so it fails fast (callers can opt in).
//   * `SchemaValidationLlmError` — tagged `transient`; the framework's
//     schema-retry path handles it. Thrown only for genuinely
//     malformed / non-parseable JSON in the model's reply — NOT for a
//     context-overflow (which is deterministic; see below).
//   * `NonRetryableLlmError` — no tag; framework surfaces it
//     immediately as `LLM_NON_RETRYABLE_ERROR`. Used for: daemon
//     unreachable (`ECONNREFUSED`), model-not-pulled (404), and
//     context-length / eval errors (deterministic — a retry re-fails).
//   * `ToolLoopExhaustedError` — surfaces from the function-tool loop
//     when the round cap is hit. Non-retryable (no tag).

import {
    LLM_NON_RETRYABLE_ERROR,
    LLM_RATE_LIMITED,
    LLM_TRANSIENT_ERROR,
} from "../../lib/pipelines/failure-codes.js"

export class TransientLlmError extends Error {
    public readonly retryReason = "transient" as const
    public readonly code = LLM_TRANSIENT_ERROR
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "TransientLlmError"
        this.status = args.status
    }
}

export class RateLimitLlmError extends Error {
    public readonly retryReason = "rate_limit" as const
    public readonly code = LLM_RATE_LIMITED
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "RateLimitLlmError"
        this.status = args.status
    }
}

/**
 * Thrown when the model's structured-output reply is genuinely
 * malformed / non-parseable JSON. Tagged `transient` so the framework's
 * default retry policy retries — a single re-roll often produces
 * conforming output.
 *
 * **Do not** route a context-length overflow here: an overflow is
 * deterministic and re-fails on the retried (still-oversized) prompt.
 * `classifyOllamaError` routes overflow to {@link NonRetryableLlmError}.
 */
export class SchemaValidationLlmError extends Error {
    public readonly retryReason = "transient" as const
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "SchemaValidationLlmError"
        this.status = args.status
    }
}

export class NonRetryableLlmError extends Error {
    public readonly code = LLM_NON_RETRYABLE_ERROR
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "NonRetryableLlmError"
        this.status = args.status
    }
}

export class ToolLoopExhaustedError extends Error {
    public readonly rounds: number

    constructor(args: { message: string; rounds: number }) {
        super(args.message)
        this.name = "ToolLoopExhaustedError"
        this.rounds = args.rounds
    }
}

// -- error-shape probes ---------------------------------------------------
//
// The `ollama` SDK throws plain `Error`s (sometimes a `ResponseError`
// carrying a `status_code`) and lets low-level `fetch` failures bubble
// up. undici wraps a connection refusal as `TypeError: fetch failed`
// with a `.cause` carrying the Node `code`. We probe both the error
// itself and one level of `.cause` for the Node-style `code` and an
// HTTP-ish `status` / `status_code`.

function nodeCodeOf(err: unknown): string | undefined {
    const direct = readCode(err)
    if (direct !== undefined) return direct
    if (typeof err === "object" && err !== null) {
        return readCode((err as { cause?: unknown }).cause)
    }
    return undefined
}

function readCode(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) return undefined
    const code = (value as { code?: unknown }).code
    return typeof code === "string" ? code : undefined
}

function statusOf(err: unknown): number | undefined {
    if (typeof err !== "object" || err === null) return undefined
    // `status_code` is the `ollama` SDK's ResponseError wire field — an
    // external snake_case name, exempt from the camelCase rule.
    /* eslint-disable @typescript-eslint/naming-convention */
    const e = err as { status?: unknown; status_code?: unknown }
    if (typeof e.status === "number") return e.status
    if (typeof e.status_code === "number") return e.status_code
    /* eslint-enable @typescript-eslint/naming-convention */
    return undefined
}

function messageOf(err: unknown): string {
    if (err instanceof Error) return err.message
    if (typeof err === "string") return err
    return String(err)
}

const CONTEXT_OVERFLOW_PATTERN =
    /context (?:length|window)|maximum context|exceeds the (?:maximum )?context|too (?:many|long).*token|num_ctx/i

const MODEL_NOT_FOUND_PATTERN =
    /model .* not found|not found, try pulling|no such model|pull(?:ing)? it/i

/**
 * Map an error surfaced by the `ollama` SDK (or an underlying `fetch`
 * failure) to one of the framework-recognized provider error classes.
 *
 * The mapping is deliberately exhaustive on the cases the reviewer
 * called out so they can't silently regress:
 *
 *   - `ECONNREFUSED`            → NonRetryable (daemon down; a retry
 *                                 won't bring it up within backoff).
 *   - model-not-pulled (404)    → NonRetryable (`ollama pull` hint).
 *   - context-overflow/eval err → NonRetryable (deterministic; never
 *                                 SchemaValidationLlmError).
 *   - `ECONNRESET` / socket drop→ Transient.
 *   - cold-load / generic 5xx   → Transient.
 *   - 429                       → RateLimit (remote/proxy setups).
 *   - anything else             → NonRetryable (safe fail-fast default).
 */
export function classifyOllamaError(err: unknown): Error {
    const code = nodeCodeOf(err)
    const status = statusOf(err)
    const message = messageOf(err)

    // Daemon unreachable — a connection refusal is the canonical
    // "`ollama serve` isn't running on :11434" failure. A retry within
    // the framework's short backoff won't bring it back up.
    if (code === "ECONNREFUSED") {
        return new NonRetryableLlmError({
            message: `Cannot reach the Ollama daemon (${code}). Is \`ollama serve\` running on :11434? Original error: ${message}`,
        })
    }

    // Mid-stream socket drop / transient connection loss — retryable.
    if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") {
        return new TransientLlmError({
            message: `Transient connection error talking to the Ollama daemon (${code}): ${message}`,
        })
    }

    // Model not pulled — Ollama returns a 404 whose body says the model
    // was not found. Deterministic until the user pulls it.
    if (status === 404 || MODEL_NOT_FOUND_PATTERN.test(message)) {
        return new NonRetryableLlmError({
            message: `Ollama model not found. Run \`ollama pull <model>\` to download it first. Original error: ${message}`,
            status,
        })
    }

    // Context-length overflow / model-eval error — DETERMINISTIC. Must
    // be NonRetryable: routing this to SchemaValidationLlmError (tagged
    // `transient`) would burn a guaranteed-failing second attempt on
    // the same oversized prompt.
    if (CONTEXT_OVERFLOW_PATTERN.test(message)) {
        return new NonRetryableLlmError({
            message: `Ollama request exceeded the model's context window (deterministic — retrying the same prompt will re-fail). Shorten the input or raise \`num_ctx\`. Original error: ${message}`,
            status,
        })
    }

    if (status === 429) {
        return new RateLimitLlmError({
            message: `Ollama returned 429 (rate-limited; typical of a remote/proxied daemon): ${message}`,
            status,
        })
    }

    // Cold-model-load (model pulled but still loading into VRAM) and
    // any other 5xx are transient — a retry after backoff can succeed
    // once the model is resident.
    if (status !== undefined && status >= 500) {
        return new TransientLlmError({
            message: `Ollama returned ${status.toString()} (possibly a cold model load into VRAM): ${message}`,
            status,
        })
    }

    // Safe default: fail fast rather than retry an unrecognized error.
    return new NonRetryableLlmError({
        message: `Unclassified Ollama error: ${message}`,
        status,
    })
}
