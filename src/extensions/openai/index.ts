// Barrel for the OpenAI Responses-API provider extension.
//
// Public surface consumed by `proposit-server`, the CLI, and other
// callers: the provider constructor + caller-facing config types +
// the error classes that callers may want to `instanceof`-match for
// finer-grained observability + the response retrieval API for resync.

export { createOpenAiResponsesProvider, retrieveResponse } from "./provider.js"
export type {
    TCreateOpenAiResponsesProviderOptions,
    TRetrievedResponse,
    TResponseStatus,
} from "./provider.js"
export type { TOpenAiFetch } from "./types.js"
export {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    ResponseNotFoundError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
} from "./errors.js"
export { typeboxToOpenAiSchema } from "./structured-output.js"
export type { TOpenAiJsonSchema } from "./structured-output.js"
