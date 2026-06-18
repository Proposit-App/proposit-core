// Barrel for the chat-completions provider extension.
//
// Public surface consumed via the
// `@proposit/proposit-core/extensions/chat-completions` subpath: the
// provider factory + its config type + the lax JSON-schema converter +
// the error classes (which callers may `instanceof`-match for finer-
// grained observability) and the status/fetch classifiers.
//
// The error class names intentionally mirror the OpenAI provider's names
// but are *distinct* classes living in this extension; they are surfaced
// only from this subpath (NOT the package root) to avoid colliding with
// the root-exported OpenAI error classes. The framework classifies by
// the `retryReason` tag, not class identity, so the duplication is
// intentional and harmless.

export { createChatCompletionsProvider } from "./provider.js"
export type { TCreateChatCompletionsProviderOptions } from "./provider.js"
export type { TChatCompletionsProviderConfig } from "./types.js"
export { typeboxToJsonSchema } from "./structured-output.js"
export type { TChatCompletionsJsonSchema } from "./structured-output.js"
export {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    TransientLlmError,
    classifyHttpError,
    classifyFetchError,
} from "./errors.js"
