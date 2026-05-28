// Stable `TProcessingFailure.code` string constants for LLM-stage
// failures.
//
// These live in the SDK-free `src/lib/pipelines/` layer (no `openai`
// import) so consumers — notably `proposit-server`'s global AI-budget
// breaker — can import the wire-format code without pulling in the
// OpenAI extension. `TProcessingFailure.code` is a bare `string`, so
// matching against these exported constants (rather than re-typing the
// literal) is the load-bearing contract between core and its
// consumers.
//
// `classifyError` (./stage-helpers.ts) maps the `retryReason` tag on a
// thrown provider error to one of these codes; the executor copies the
// code onto the `TProcessingFailure` it reports.

/**
 * Persistent provider budget exhaustion (OpenAI `insufficient_quota`,
 * surfaced as an HTTP 429 whose body carries that code). Distinct from
 * the transient `LLM_RATE_LIMITED` throttle: quota exhaustion is
 * fail-fast (non-retryable) and is the signal a global AI-budget
 * breaker trips on.
 */
export const LLM_QUOTA_EXHAUSTED = "LLM_QUOTA_EXHAUSTED" as const

/** Transient provider throttling (HTTP 429, non-quota). Retryable. */
export const LLM_RATE_LIMITED = "LLM_RATE_LIMITED" as const

/** Transient provider failure (5xx, network). Retryable by default. */
export const LLM_TRANSIENT_ERROR = "LLM_TRANSIENT_ERROR" as const

/** Unrecoverable provider failure (e.g. 400/401/403). Not retryable. */
export const LLM_NON_RETRYABLE_ERROR = "LLM_NON_RETRYABLE_ERROR" as const

/** Retry loop exited without captured error context (defensive). */
export const LLM_UNKNOWN_ERROR = "LLM_UNKNOWN_ERROR" as const

/** Stage output failed local TypeBox `outputSchema` validation. */
export const OUTPUT_SCHEMA_INVALID = "OUTPUT_SCHEMA_INVALID" as const
