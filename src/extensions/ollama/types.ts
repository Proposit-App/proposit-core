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
 * is exempt from the in-repo camelCase property-naming rule. The SDK's
 * `Config` accepts an optional `fetch` override (used by the
 * per-provider raised-timeout dispatcher — see `./timeout-fetch.ts`).
 */
/* eslint-disable @typescript-eslint/naming-convention */
export type TOllamaModule = {
    Ollama: new (config: {
        host: string
        fetch?: typeof fetch
    }) => TOllamaClient
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Structural slice of the `undici` module the timeout-fetch helper uses.
 * Modeled (not imported) so the optional `undici` peer stays out of the
 * type graph — same pattern as {@link TOllamaModule} for the `ollama`
 * peer. The undici `Agent` constructor accepts millisecond timeout
 * options; we raise `headersTimeout` + `bodyTimeout` (and `connectTimeout`)
 * so a long local thinking-model generation isn't aborted at undici's
 * 300s default. `Agent` is undici's exported class-constructor name (an
 * external symbol), exempt from the camelCase rule.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export type TUndiciAgentOptions = {
    headersTimeout?: number
    bodyTimeout?: number
    connectTimeout?: number
}
export type TUndiciDispatcher = object
export type TUndiciModule = {
    Agent: new (options: TUndiciAgentOptions) => TUndiciDispatcher
    /**
     * undici's own `fetch`. The raised-timeout `Agent` MUST be passed as
     * a `dispatcher` to *this* fetch — the one from the same undici
     * module the `Agent` was constructed from. Node's bundled-undici
     * global `fetch` rejects a foreign-undici `Agent` dispatcher with
     * `UND_ERR_INVALID_ARG`, so the base fetch and the dispatcher must
     * come from the same undici instance. See `./timeout-fetch.ts`.
     */
    fetch: typeof fetch
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
     * Injectable `ollama`-module importer. Test seam — defaults to
     * `import("ollama")`. Lets tests assert the SDK client is constructed
     * with the per-provider timeout-fetch without touching the real
     * package. Ignored when `client` is provided.
     *
     * @internal
     */
    importOllama?: () => Promise<TOllamaModule>
    /**
     * Injectable `undici`-module importer. Test seam — defaults to
     * `import("undici")`. See {@link requestTimeoutMs}.
     *
     * @internal
     */
    importUndici?: () => Promise<TUndiciModule>
    /**
     * Per-request HTTP timeout in milliseconds, applied via a
     * **per-provider** undici `Agent` (raised `headersTimeout` +
     * `bodyTimeout`) passed as the `ollama` SDK client's `fetch`
     * dispatcher. Defaults to **1_200_000 (20 min)** — local thinking
     * models legitimately take many minutes per structured-extraction
     * stage, and undici's 300s default aborts them mid-generation with a
     * `UND_ERR_HEADERS_TIMEOUT` `fetch failed`.
     *
     * **No global state is mutated** — the raised timeout is scoped to
     * this provider's client only (never `setGlobalDispatcher`). Requires
     * the optional `undici` peer; if it is not installed the provider
     * falls back to the SDK's default fetch (300s) and relies on
     * `classifyOllamaError` retrying the resulting timeout as transient.
     *
     * Set `0` to disable the custom dispatcher entirely (use the SDK
     * default). A finite positive value is recommended.
     */
    requestTimeoutMs?: number
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
