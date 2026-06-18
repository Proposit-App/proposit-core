// Extension-internal wire-format + config types for an OpenAI-compatible
// `/v1/chat/completions` endpoint (a local llama-server, the HF router,
// or any OpenAI-compatible chat backend). Field names on the request /
// response shapes are *wire* names (snake_case); the in-repo brain-style
// camelCase rule does not apply to external wire formats.
/* eslint-disable @typescript-eslint/naming-convention */

import type { TChatCompletionsJsonSchema } from "./structured-output.js"

// Default local llama-server chat endpoint + model alias. The base URL
// already includes the `/v1` prefix; the provider appends
// `/chat/completions`. The apiKey is a throwaway — a local server
// ignores `Authorization`, but the OpenAI wire shape expects a bearer
// token, so we always send one.
export const DEFAULT_BASE_URL = "http://127.0.0.1:46373/v1"
export const DEFAULT_MODEL = "local-coder"
export const DEFAULT_API_KEY = "local-llm-no-key"
// Generous per-request timeout. Local generations on a large reasoning
// model legitimately take minutes per structured-output stage; enforced
// via `AbortSignal.timeout` with no extra HTTP-stack dependency.
export const DEFAULT_REQUEST_TIMEOUT_MS = 1_200_000

export type TChatCompletionsFetch = (
    url: string,
    init: RequestInit
) => Promise<Response>

export type TChatCompletionsMessage = {
    role: "system" | "user" | "assistant"
    content: string
}

export type TChatCompletionsResponseFormat = {
    type: "json_schema"
    json_schema: {
        name: string
        schema: TChatCompletionsJsonSchema
    }
}

export type TChatCompletionsRequestBody = {
    model: string
    messages: TChatCompletionsMessage[]
    response_format: TChatCompletionsResponseFormat
    temperature?: number
    max_tokens?: number
}

export type TChatCompletionsChoice = {
    message?: { role?: string; content?: string }
    finish_reason?: string
}

export type TChatCompletionsResponse = {
    id?: string
    choices?: TChatCompletionsChoice[]
    usage?: {
        prompt_tokens?: number
        completion_tokens?: number
    }
    error?: { message?: string; code?: string }
}
/* eslint-enable @typescript-eslint/naming-convention */

export type TChatCompletionsProviderConfig = {
    /** Endpoint base URL (including any `/v1` prefix). Defaults to `http://127.0.0.1:46373/v1`. */
    baseUrl?: string
    /** Model identifier. Defaults to `local-coder`. */
    model?: string
    /** Bearer token. Defaults to a throwaway (local servers ignore it). */
    apiKey?: string
    /**
     * Per-request HTTP timeout in milliseconds, enforced via
     * `AbortSignal.timeout`. Defaults to **1_200_000 (20 min)** — local
     * generations on a large reasoning model legitimately take minutes
     * per structured-output stage. Set `0` to disable the timeout.
     */
    requestTimeoutMs?: number
    /**
     * Injectable `fetch`. Defaults to `globalThis.fetch`. Tests inject
     * mocks; runtimes without a global `fetch` (older Node) inject a
     * polyfill.
     */
    fetch?: TChatCompletionsFetch
}
