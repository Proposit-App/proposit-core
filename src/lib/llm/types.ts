// Abstract LLM provider types for the pipeline framework.
//
// The framework is provider-agnostic: stages depend only on the
// `LlmProvider` interface in this file. Concrete providers (e.g.
// the OpenAI Responses adapter shipping in slice 1B under
// `src/extensions/openai/`) live outside `src/lib/` to keep the
// library free of third-party SDK imports.
//
// `LlmRequest<T>` carries a `_typeMarker` phantom: it has no runtime
// presence; it exists solely so the type system can carry `T` from
// the structured-output schema into `LlmResponse<T>` without
// introducing a runtime-visible cast. Providers and the mock
// implementation ignore this field.

import type { TSchema } from "typebox"

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
     * Phantom field that carries the structured-output type `T` from
     * `outputSchema` into the response. Always `undefined` at runtime.
     */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _typeMarker?: T
}

export type TLlmTokenUsage = {
    input: number
    output: number
    reasoning?: number
}

export type TLlmResponse<T> = {
    output: T
    tokenUsage: TLlmTokenUsage
    rawResponseId?: string
}

export type TLlmProvider = {
    respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>>
}
