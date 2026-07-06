// Abstract LLM provider types for the pipeline framework.
//
// The framework is provider-agnostic: stages depend only on the
// `LlmProvider` interface in this file. Concrete providers (e.g.
// the OpenAI Responses adapter under `src/extensions/openai/`) live
// outside `src/lib/` to keep the
// library free of third-party SDK imports.
//
// `LlmRequest<T>` carries a `_typeMarker` phantom: it has no runtime
// presence; it exists solely so the type system can carry `T` from
// the structured-output schema into `LlmResponse<T>` without
// introducing a runtime-visible cast. Providers and the mock
// implementation ignore this field.

import Type, { type Static, type TSchema } from "typebox"

/** Opaque provider response identifier. Carried across turns so a
 * downstream request can be chained to a specific upstream response. */
export type TResponseId = string

export type TLlmModel = "gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.4-nano"

export type TReasoningEffort = "minimal" | "low" | "medium" | "high"

export type TToolSpec =
    | { kind: "web_search" }
    | { kind: "file_search"; vectorStoreId: string }
    | { kind: "mcp"; serverUrl: string; toolName?: string }
    | {
          kind: "function"
          name: string
          description: string
          parameters: TSchema
          handler: (args: unknown) => Promise<unknown>
      }

export type TLlmRequest<T> = {
    /** Free-form for forward-compat. The known set is `TLlmModel`. */
    model: string
    reasoningEffort?: TReasoningEffort
    systemPrompt: string
    userMessage: string
    outputSchema: TSchema
    tools?: readonly TToolSpec[]
    maxOutputTokens?: number
    signal?: AbortSignal
    /**
     * Optional callback fired by a provider **as soon as the upstream
     * response id is known — before the call resolves**. Lets a caller
     * persist the id mid-flight so an interrupted in-flight call can be
     * recovered from the upstream's stored copy.
     *
     * Only providers that can surface an id mid-flight invoke it (the
     * OpenAI provider in background-stream mode, from the first
     * `response.created` SSE event). Synchronous providers leave it
     * uncalled and surface the id only at completion via
     * {@link TLlmResponse.rawResponseId}. Optional + backward-compatible:
     * callers that don't set it are unaffected. Invoked at most once per
     * provider call (per attempt).
     */
    onResponseCreated?: (responseId: string) => void
    /**
     * The provider response id to chain this request against. When set,
     * the provider should continue from the specified prior response
     * rather than starting a fresh conversation. Only meaningful for
     * providers that support response chaining (e.g. the OpenAI
     * Responses API). Synchronous providers (e.g. chat-completions)
     * ignore this field — the caller folds the transcript into
     * `userMessage` instead. Optional + backward-compatible.
     */
    previousResponseId?: TResponseId
    /**
     * Phantom field that carries the structured-output type `T` from
     * `outputSchema` into the response. Always `undefined` at runtime.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _typeMarker?: T
}

export const LlmTokenUsageSchema = Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    reasoning: Type.Optional(Type.Number()),
})
export type TLlmTokenUsage = Static<typeof LlmTokenUsageSchema>

export type TLlmResponse<T> = {
    output: T
    tokenUsage: TLlmTokenUsage
    rawResponseId?: string
}

export type TLlmProvider = {
    respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>>
}

/**
 * Lifecycle status of a stored/background LLM response. `completed` /
 * `failed` / `incomplete` / `cancelled` are terminal; `queued` /
 * `in_progress` are transient.
 *
 * This is the framework-side mirror of the concrete provider's status
 * union (the OpenAI extension exports a structurally-identical
 * `TResponseStatus`). It lives here, in the SDK-free layer, so the
 * pipeline's launch/complete entry points can reference a response
 * status by its function/value type without importing the OpenAI
 * extension — keeping `src/lib/` free of third-party SDK imports.
 */
export type TResponseStatus =
    | "queued"
    | "in_progress"
    | "completed"
    | "failed"
    | "incomplete"
    | "cancelled"

/**
 * Framework-side structural mirror of a retrieved background-response
 * shape, consumed by `completeStage`. The OpenAI extension's
 * `retrieveResponse` returns a structurally-compatible object (it
 * carries every field below), so a consumer can pass its result
 * straight into `completeStage` — without `src/lib/` importing the
 * extension type. `output` is the **raw assistant text** (not a parsed
 * object); `completeStage` parses it against the stage's schema.
 */
export type TRetrievedResponse = {
    /** Current status of the stored response. */
    status: TResponseStatus
    /** Raw assistant text output, present when `status === "completed"`. */
    output?: string
    /** Token usage reported by the provider, when available. */
    tokenUsage?: TLlmTokenUsage
    /** The provider response id that was retrieved. */
    rawResponseId: string
    /**
     * The provider's `incomplete_details.reason`, present when
     * `status === "incomplete"` (e.g. `max_output_tokens`,
     * `content_filter`). Drives `completeStage`'s classification.
     */
    incompleteReason?: string
    /** The provider's error message, present when `status === "failed"`. */
    errorMessage?: string
}
