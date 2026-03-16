import type { TSchema } from "typebox"

export type TLlmCompletionRequest = {
    systemPrompt: string
    userMessage: string
    responseSchema: TSchema
}

export type TLlmProviderOptions = {
    apiKey: string
    model?: string
}

export type TLlmProvider<TResponse = Record<string, unknown>> = {
    complete(request: TLlmCompletionRequest): Promise<TResponse>
}
