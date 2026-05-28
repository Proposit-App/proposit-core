// Barrel for the OpenAI Responses-API provider extension.
//
// Public surface consumed by `proposit-server`, the CLI, and other
// callers: the provider constructor + caller-facing config types +
// the error classes that callers may want to `instanceof`-match for
// finer-grained observability.

export { createOpenAiResponsesProvider } from "./provider.js"
export type { TCreateOpenAiResponsesProviderOptions } from "./provider.js"
export type { TOpenAiFetch } from "./types.js"
export {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
} from "./errors.js"
export { typeboxToOpenAiSchema } from "./structured-output.js"
export type { TOpenAiJsonSchema } from "./structured-output.js"
