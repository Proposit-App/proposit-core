// Barrel for the Ollama provider extension.
//
// Public surface consumed via the `@proposit/proposit-core/extensions/ollama`
// subpath export: the provider constructor + its config type + the
// standard-JSON-schema converter + the error classes (which callers may
// `instanceof`-match for finer-grained observability).
//
// NOTE: the error class names (`NonRetryableLlmError`, …) intentionally
// mirror the OpenAI provider's names but are *distinct* classes living
// in this extension. They are surfaced only from this subpath (NOT the
// package root) to avoid colliding with the root-exported OpenAI error
// classes. The framework classifies by the `retryReason` tag, not class
// identity, so the duplication is intentional and harmless.

export { OllamaProvider } from "./provider.js"
export type {
    TOllamaProviderConfig,
    TOllamaClient,
    TOllamaChatRequest,
    TOllamaChatResponse,
} from "./types.js"
export { typeboxToJsonSchema } from "./structured-output.js"
export type { TOllamaJsonSchema } from "./structured-output.js"
export {
    NonRetryableLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
    classifyOllamaError,
} from "./errors.js"
