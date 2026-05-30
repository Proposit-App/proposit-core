// Extension-internal types for the Ollama provider.
//
// Property names on the SDK request/response shapes are *wire* names
// dictated by the Ollama HTTP API (snake_case); the in-repo brain-style
// camelCase rule does not apply to external wire formats.

import type { TOllamaJsonSchema } from "./structured-output.js"

/**
 * The minimal subset of the `ollama` SDK's `chat()` response we read.
 * We model only the fields the provider touches so a mock client (and
 * a real `ChatResponse`) both satisfy it without importing the SDK type
 * (which would force the optional peer into the type graph).
 */
/* eslint-disable @typescript-eslint/naming-convention */
export type TOllamaChatToolCall = {
    function: {
        name: string
        arguments: Record<string, unknown>
    }
}

export type TOllamaChatMessage = {
    role: string
    content: string
    tool_calls?: TOllamaChatToolCall[]
}

export type TOllamaChatResponse = {
    message: TOllamaChatMessage
    prompt_eval_count?: number
    eval_count?: number
}

/** Tool spec in the `ollama` SDK's `chat({ tools })` wire shape. */
export type TOllamaToolWire = {
    type: "function"
    function: {
        name: string
        description: string
        parameters: TOllamaJsonSchema
    }
}

/** The `chat()` request body subset the provider builds. */
export type TOllamaChatRequest = {
    model: string
    messages: TOllamaChatMessage[]
    format?: string | object
    tools?: TOllamaToolWire[]
    stream?: false
    options?: {
        temperature?: number
        num_predict?: number
        num_ctx?: number
    }
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * The slice of the `ollama` SDK client surface the provider depends on:
 * a single `chat()` method and an `abort()` to honor `AbortSignal`.
 * Modeling it as a structural type (rather than importing `Ollama`)
 * keeps the optional peer out of the type graph and gives tests a clean
 * injection seam.
 */
export type TOllamaClient = {
    chat(request: TOllamaChatRequest): Promise<TOllamaChatResponse>
    abort(): void
}

/**
 * The shape of the dynamically-imported `ollama` module. `Ollama` is
 * the SDK's exported class-constructor name (an external symbol), so it
 * is exempt from the in-repo camelCase property-naming rule.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export type TOllamaModule = {
    Ollama: new (config: { host: string }) => TOllamaClient
}
/* eslint-enable @typescript-eslint/naming-convention */

export type TOllamaProviderConfig = {
    /** Daemon base URL. Defaults to `http://localhost:11434`. */
    baseUrl?: string
    /**
     * Pre-built SDK client. Primarily a test seam (inject a mock). When
     * omitted, the provider dynamically imports the `ollama` package and
     * constructs an `Ollama({ host: baseUrl })`; a missing package
     * surfaces as an actionable error at construction time.
     */
    client?: TOllamaClient
    /**
     * Context-window size sent as Ollama's `options.num_ctx`. Defaults
     * to a generous **32768**.
     *
     * **Why this is set, and set generously.** Ollama's per-model
     * default `num_ctx` is small (often ~4096) and Ollama **silently
     * truncates** any prompt longer than `num_ctx` — no error is raised;
     * the model dutifully emits schema-valid JSON from a truncated
     * prompt, which then passes the framework's `Value.Check` and yields
     * a quietly-wrong parse. A real v2 ingestion prompt (segmenting a
     * multi-KB argument) easily exceeds 4096 tokens, so without a
     * generous default the stated goal — running the *whole* pipeline
     * locally on real text — would silently misbehave. Raise this
     * further for very large inputs; lower it only if VRAM-constrained
     * and inputs are known to be small.
     */
    numCtx?: number
    /**
     * Cap on function-tool agent-loop round-trips before throwing
     * `ToolLoopExhaustedError`. Defaults to 6, mirroring the OpenAI
     * provider. No ingestion stage uses tools, so this is secondary.
     */
    maxToolCallRounds?: number
}
