// chat-completions-provider error classes + the `classifyHttpError` /
// `classifyFetchError` mappings.
//
// The framework's `llmStage` retry policy classifies provider errors by
// inspecting a `retryReason` tag on the thrown object (see
// `src/lib/pipelines/llm-stage-helpers.ts#classifyError`). To play cleanly
// with that mechanism, each error class carries the appropriate tag as
// an own property. The framework derives the `TProcessingFailure.code`
// from the tag, so these classes need no `code` of their own.
//
// The class names intentionally mirror the OpenAI provider's names but
// are *distinct* classes living in this extension. Neither set is
// exported from the package root: these come only from the
// `extensions/chat-completions` subpath and the OpenAI ones only from
// the `extensions/openai` subpath, so the matching names never
// collide.
//
// Mapping for the framework's default retry policy
// (`retryOn: ["schema_validation", "transient"]`):
//
//   * `TransientLlmError` — `retryReason: "transient"`. 5xx responses +
//     low-level fetch failures (server unreachable, connection reset, a
//     request timeout). Retried under the default policy.
//   * `RateLimitLlmError` — `retryReason: "rate_limit"`. A 429 whose body
//     is NOT `insufficient_quota`. Not retried by default — callers can
//     opt into `retryOn: ["..., "rate_limit"]`.
//   * `QuotaExhaustedLlmError` — `retryReason: "quota_exhausted"`.
//     Persistent budget exhaustion (a 429 whose body code/type is
//     `insufficient_quota`). Fail-fast: the tag is absent from every
//     default `retryOn`, so the stage breaks on attempt 1.
//   * `SchemaValidationLlmError` — `retryReason: "transient"`. The
//     model's output failed schema enforcement on the server side
//     (typical 422). A single re-roll often produces conforming output.
//   * `NonRetryableLlmError` — no tag; the framework classifies it as
//     `non_retryable` and surfaces it immediately. Used for 400/401/403
//     and other unrecoverable 4xx.

import { categorizeHttpError } from "../llm-http/errors.js"

export class TransientLlmError extends Error {
    public readonly retryReason = "transient" as const
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "TransientLlmError"
        this.status = args.status
    }
}

export class RateLimitLlmError extends Error {
    public readonly retryReason = "rate_limit" as const
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "RateLimitLlmError"
        this.status = args.status
    }
}

/**
 * Persistent provider budget exhaustion — surfaced as a 429 whose body
 * carries an `insufficient_quota` code/type. Distinct from the transient
 * {@link RateLimitLlmError} throttle: the framework reads the
 * `quota_exhausted` tag, which is absent from every default `retryOn`,
 * so the stage fails fast on attempt 1.
 */
export class QuotaExhaustedLlmError extends Error {
    public readonly retryReason = "quota_exhausted" as const
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "QuotaExhaustedLlmError"
        this.status = args.status
    }
}

/**
 * Thrown when the endpoint rejects our request because the model's
 * output failed server-side JSON-Schema enforcement (typical 422).
 * Tagged `transient` so the framework's default retry policy retries — a
 * single re-roll often produces conforming output.
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
    public readonly status?: number

    constructor(args: { message: string; status?: number }) {
        super(args.message)
        this.name = "NonRetryableLlmError"
        this.status = args.status
    }
}

/**
 * Route an HTTP status family (plus an optional structured provider
 * error code) into the framework-recognized error class.
 */
export function classifyHttpError(
    status: number,
    message: string,
    providerErrorCode?: string
): Error {
    // Which status goes to which category (and why) is decided in
    // `categorizeHttpError`, shared with the OpenAI provider; this maps
    // the category to this provider's own classes.
    switch (categorizeHttpError(status, providerErrorCode)) {
        case "transient":
            return new TransientLlmError({ message, status })
        case "rate_limit":
            return new RateLimitLlmError({ message, status })
        case "quota_exhausted":
            return new QuotaExhaustedLlmError({ message, status })
        case "schema_validation":
            return new SchemaValidationLlmError({ message, status })
        case "non_retryable":
            return new NonRetryableLlmError({ message, status })
    }
}

/**
 * Map a low-level `fetch` failure (server unreachable, connection reset,
 * the request timeout firing as a non-Abort transport error) to a
 * transient error. Talking to a local OpenAI-compatible server that is
 * down or mid-generation is retryable — a retry after backoff can
 * succeed once the server is up / a slow generation completes.
 */
export function classifyFetchError(err: unknown): Error {
    const message = err instanceof Error ? err.message : String(err)
    return new TransientLlmError({
        message: `Network error calling the chat-completions endpoint: ${message}`,
    })
}
