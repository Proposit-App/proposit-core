// HTTP failure helpers shared by the OpenAI and chat-completions
// providers.
//
// Both providers sort a non-2xx response into the same categories, but
// each throws its own error classes (callers match them with
// `instanceof`, and each provider's classes are public API on its own
// subpath). So this module only decides the category; each provider's
// `classifyHttpError` turns the category into one of its classes.

/**
 * What kind of failure an HTTP status represents. The names match the
 * error class each provider throws for it: `TransientLlmError`,
 * `RateLimitLlmError`, `QuotaExhaustedLlmError`,
 * `SchemaValidationLlmError` and `NonRetryableLlmError`.
 */
export type THttpErrorCategory =
    | "transient"
    | "rate_limit"
    | "quota_exhausted"
    | "schema_validation"
    | "non_retryable"

/**
 * Sort an HTTP error status, plus the structured error code or type
 * from the response body when there is one, into a failure category.
 *
 *   * 500 and above: a server fault, retryable (`transient`).
 *   * 429: `quota_exhausted` when the body's code is
 *     `insufficient_quota` (the account's budget is spent, so retrying
 *     cannot help); every other 429, including one whose body could not
 *     be read, is the temporary throttle `rate_limit`. Defaulting to the
 *     throttle means a 429 is never mistaken for an exhausted quota.
 *   * 400: a malformed request — a converter bug, an unsupported
 *     parameter, or a request shape the endpoint does not accept.
 *     Retrying sends the same request again, so it is `non_retryable`.
 *   * 422: the model's structured-output reply failed the endpoint's
 *     own schema validation. Asking again can produce a conforming
 *     reply, so it is `schema_validation`.
 *   * Every other status (401, 403, the remaining 4xx) is
 *     `non_retryable`.
 */
export function categorizeHttpError(
    status: number,
    providerErrorCode?: string
): THttpErrorCategory {
    if (status >= 500) {
        return "transient"
    }
    if (status === 429) {
        return providerErrorCode === "insufficient_quota"
            ? "quota_exhausted"
            : "rate_limit"
    }
    if (status === 400) {
        return "non_retryable"
    }
    if (status === 422) {
        return "schema_validation"
    }
    return "non_retryable"
}

/**
 * True when `err` is an abort — a thrown value whose `name` is
 * `"AbortError"`. A timeout from `AbortSignal.timeout` is named
 * `"TimeoutError"` and so does not count.
 */
export function isAbortError(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "AbortError"
    )
}
