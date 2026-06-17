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

/**
 * Thrown by {@link retrieveResponse} (and the background poll loop) when
 * a stored response is not found (HTTP 404). This typically means the
 * ~10-minute retention window has elapsed. Callers should clear the
 * stored id, settle the associated stage as failed, and surface a retry
 * prompt.
 *
 * Extends {@link NonRetryableLlmError} so it inherits the fail-fast
 * disposition: a 404 is deterministic — re-fetching the same aged-out id
 * will 404 again — so the framework must not burn a retry. Inheriting the
 * base (which carries **no** `retryReason` tag) means `llmStage`
 * classifies it as `non_retryable`, exactly as the prior generic
 * `NonRetryableLlmError` did when a 404 surfaced mid-poll — so this is a
 * strictly more specific, behavior-preserving subclass. Callers that
 * `instanceof NonRetryableLlmError` still match; callers wanting the
 * aged-out signal specifically can `instanceof ResponseNotFoundError`.
 */
export class ResponseNotFoundError extends NonRetryableLlmError {
    public readonly responseId: string

    constructor(args: { responseId: string }) {
        super({
            message: `OpenAI response "${args.responseId}" was not found (404). The ~10-minute retention window may have elapsed.`,
            status: 404,
        })
        this.name = "ResponseNotFoundError"
        this.responseId = args.responseId
    }
}

/**
 * Route an HTTP status family (plus an optional structured provider
 * error code) into the framework-recognized error class. See the
 * status→class mapping at the head of the OpenAI provider for the
 * rationale behind each branch.
 */
export function classifyHttpError(
    status: number,
    message: string,
    providerErrorCode?: string
): Error {
    if (status >= 500) {
        return new TransientLlmError({ message, status })
    }
    if (status === 429) {
        // 429 splits on the body's structured error code: persistent
        // budget exhaustion (`insufficient_quota`) is fail-fast, every
        // other (and every unparseable) 429 stays the transient
        // throttle. The safe default is always "transient + retryable"
        // — never a false quota trip.
        if (providerErrorCode === "insufficient_quota") {
            return new QuotaExhaustedLlmError({ message, status })
        }
        return new RateLimitLlmError({ message, status })
    }
    // 400 vs 422 split:
    //
    // OpenAI returns 400 for malformed requests — typically a
    // converter bug, an unsupported parameter, or a request shape
    // the API doesn't accept. Retrying a 400 just burns the second
    // attempt; classify as non-retryable so the framework surfaces
    // the error immediately.
    //
    // OpenAI returns 422 when the model's structured-output reply
    // failed server-side strict-mode validation. A re-roll can
    // sometimes succeed, so we route 422 through the
    // schema-validation class (which carries `retryReason:
    // "transient"` as the V1 retry workaround until the framework
    // grows a dedicated `schema_validation` retry tag).
    if (status === 400) {
        return new NonRetryableLlmError({ message, status })
    }
    if (status === 422) {
        return new SchemaValidationLlmError({ message, status })
    }
    return new NonRetryableLlmError({ message, status })
}

// -- incomplete-reason → user-facing message ----------------------------
//
// Per-reason error messages for the `status: "incomplete"` branch.
// The message is the dev's first read when a stage fails — keep it
// actionable, name the cap reason verbatim, and (for the truncation
// case specifically) point at the override knob that fixes it.

export function formatIncompleteMessage(reason: string): string {
    if (reason === "max_output_tokens") {
        return `OpenAI Responses API returned status: "incomplete" (reason: max_output_tokens). The model's output exceeded the per-call \`max_output_tokens\` cap (either an explicit value on the request or the model's default). Pass a larger \`maxOutputTokens\` to TLlmRequest, or set the stage-level \`maxOutputTokens\` on the llmStage factory (e.g., the \`createScholarPipeline({ llm: { overrides: { ... } } })\` surface).`
    }
    if (reason === "content_filter") {
        return `OpenAI Responses API returned status: "incomplete" (reason: content_filter). OpenAI's content policy refused to complete this output; the input or generated content was flagged. Retrying will not succeed — review the input text or the stage's prompt and re-request.`
    }
    return `OpenAI Responses API returned status: "incomplete" (reason: ${reason}). The model stopped before completing the response. See OpenAI Responses API documentation for the complete \`incomplete_details.reason\` enumeration.`
}
