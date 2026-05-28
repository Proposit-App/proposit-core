// OpenAI-provider error classes.
//
// The framework's `llmStage` retry policy classifies provider errors
// by inspecting a `retryReason` tag on the thrown object (see
// `src/lib/pipelines/stage-helpers.ts#classifyError`). To play
// cleanly with that mechanism, each provider-side error class carries
// the appropriate tag as an own property.
//
// Mapping for the framework's default retry policy
// (`retryOn: ["schema_validation", "transient"]`):
//
//   * `TransientLlmError` — `retryReason: "transient"`. 5xx
//     responses + low-level fetch failures. Retried under the
//     default policy.
//   * `RateLimitLlmError` — `retryReason: "rate_limit"`. Transient
//     429 throttling (any 429 whose body is NOT
//     `insufficient_quota`). Not retried by default — callers can opt
//     into `retryOn: ["..., "rate_limit"]`.
//   * `QuotaExhaustedLlmError` — `retryReason: "quota_exhausted"`.
//     Persistent budget exhaustion (429 whose body code/type is
//     `insufficient_quota`). Fail-fast: `"quota_exhausted"` is absent
//     from every default `retryOn`, so the stage breaks on attempt 1
//     and surfaces the distinct `LLM_QUOTA_EXHAUSTED` code. Note the
//     fail-fast comes from the `retryOn` exclusion, NOT from
//     subclassing `NonRetryableLlmError` (which would collapse the
//     code back to `LLM_NON_RETRYABLE_ERROR`).
//   * `SchemaValidationLlmError` — no `retryReason` tag; the
//     framework's separate schema-validation retry path handles
//     this. Thrown for 400/422 responses that signal strict-mode
//     schema violations.
//   * `NonRetryableLlmError` — no tag; framework classifies as
//     `non_retryable` and surfaces it immediately as
//     `LLM_NON_RETRYABLE_ERROR`. Used for 401/403 and other
//     unrecoverable 4xx.
//   * `ToolLoopExhaustedError` — surfaces from the agent loop when
//     the round cap is hit. Non-retryable.
//
// Keeping these classes in `extensions/openai/` rather than promoting
// them into `src/lib/llm/` keeps the abstract interface clean — the
// framework consumes the `retryReason` tag, not the class identity.

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
 * Persistent provider budget exhaustion — OpenAI `insufficient_quota`,
 * surfaced as a 429 whose body carries that code/type. Distinct from
 * the transient {@link RateLimitLlmError} throttle: the framework reads
 * the `quota_exhausted` tag, which is absent from every default
 * `retryOn`, so the stage fails fast on attempt 1 and reports the
 * distinct `LLM_QUOTA_EXHAUSTED` code. Carries the same optional
 * `status` as the sibling error family for caller observability.
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
 * Thrown when the OpenAI Responses API rejects our request because
 * the model's output failed strict-mode JSON-Schema enforcement on
 * the OpenAI side (typical 400/422 errors). Tagged `transient` so
 * the framework's default retry policy retries — a single re-roll
 * often produces conforming output. (The framework's separate
 * `OUTPUT_SCHEMA_INVALID` path catches output that passes the
 * provider but fails our local TypeBox check; this class is the
 * provider-side analogue.)
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

export class ToolLoopExhaustedError extends Error {
    public readonly rounds: number

    constructor(args: { message: string; rounds: number }) {
        super(args.message)
        this.name = "ToolLoopExhaustedError"
        this.rounds = args.rounds
    }
}
