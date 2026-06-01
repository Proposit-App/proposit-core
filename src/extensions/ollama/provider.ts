// Concrete `TLlmProvider` backed by a local Ollama daemon via the
// official `ollama` npm SDK.
//
// Dev/test only — production stays on OpenAI. The provider exists so a
// developer can run the entire LLM-backed stack (notably the v2
// argument-ingestion pipeline) against a self-hosted model
// (`qwen3.6:latest`) with zero API cost.
//
// Deliberate divergences from the in-repo OpenAI provider:
//   * Uses the official `ollama` SDK (an optional peer) rather than raw
//     `fetch`. A missing package surfaces as an actionable error at
//     construction time (dynamic-import-or-throw).
//   * Structured output goes through the Ollama provider's own
//     standard-JSON-schema converter (`./structured-output.ts`), not
//     the OpenAI strict-mode converter.
//   * `reasoningEffort` is ignored (no Ollama analogue);
//     `maxOutputTokens` maps to `options.num_predict` (positive values
//     only — never 0; -1/-2 are Ollama sentinels we never emit).
//   * Thinking follows the model default (qwen3: ON) unless the consumer
//     sets `TOllamaProviderConfig.think`; the `think` field is sent only
//     when configured (a pure opt-in knob). There is NO safe global
//     default: on qwen3.6 the thinking toggle's effect on structured-
//     output fidelity cuts both ways by stage (verified empirically).
//     With think ON, some stages emit their whole answer in the thinking
//     channel and return an empty `content`; with think OFF, other stages
//     (e.g. segmentation) drop the required object wrapper → a bare
//     array. Ollama's `format` does NOT hard-enforce the envelope on this
//     model. So consumers pick `think` per their stages, or run a non-
//     thinking model for the whole pipeline. When think is ON and the
//     model returns empty `content` alongside a thinking trace, the
//     provider raises a deterministic `NonRetryableLlmError` (not the
//     old retry-burning transient error).
//   * A generous per-request timeout (`requestTimeoutMs`, default 20 min)
//     is applied via a PER-PROVIDER undici `Agent` passed as the SDK
//     client's `fetch` — never `setGlobalDispatcher`; a library must not
//     mutate global state. See `./timeout-fetch.ts`.
//   * Errors are classified by `./errors.ts` #classifyOllamaError, which
//     carries the same `retryReason` tags + lib failure-codes as the
//     OpenAI provider. No `ollama → openai` dependency, no lib change.
//
// `AbortSignal` is honored by registering an abort listener that calls
// the SDK client's `abort()`; the SDK then rejects the in-flight
// `chat()` with an `AbortError`, which the provider re-throws verbatim
// so `llmStage`'s mid-flight-abort detector marks the stage `skipped`.

import type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
    TLlmTokenUsage,
    TToolSpec,
} from "../../lib/llm/types.js"
import {
    debugLlmFailure,
    debugLlmRequest,
    debugLlmResponse,
} from "../../lib/pipelines/debug-log.js"
import { typeboxToJsonSchema } from "./structured-output.js"
import { buildTimeoutFetch } from "./timeout-fetch.js"
import {
    NonRetryableLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    classifyOllamaError,
} from "./errors.js"
import type {
    TOllamaChatMessage,
    TOllamaChatRequest,
    TOllamaChatResponse,
    TOllamaChatToolCall,
    TOllamaClient,
    TOllamaModule,
    TOllamaProviderConfig,
    TOllamaToolWire,
} from "./types.js"

const STAGE_ID_MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/

const DEFAULT_BASE_URL = "http://localhost:11434"
const DEFAULT_MAX_TOOL_ROUNDS = 6
// Generous default context window. Ollama silently truncates prompts
// longer than `num_ctx` (no error — the model emits schema-valid JSON
// from a truncated prompt), and its per-model default is often ~4096,
// well under a real multi-KB ingestion prompt. See `TOllamaProviderConfig.numCtx`.
const DEFAULT_NUM_CTX = 32768
// Generous per-request timeout for local thinking models. undici's 300s
// default aborts long structured-extraction generations with
// UND_ERR_HEADERS_TIMEOUT; 20 min gives qwen3.6-with-thinking room. The
// timeout is applied via a PER-PROVIDER undici Agent (never global state)
// — see ./timeout-fetch.ts and TOllamaProviderConfig.requestTimeoutMs.
const DEFAULT_REQUEST_TIMEOUT_MS = 1_200_000

export class OllamaProvider implements TLlmProvider {
    private readonly config: TOllamaProviderConfig
    private clientPromise: Promise<TOllamaClient> | null = null
    private readonly maxToolRounds: number
    private readonly numCtx: number
    private readonly requestTimeoutMs: number
    private readonly stream: boolean
    private readonly think?: boolean

    constructor(config?: TOllamaProviderConfig) {
        this.config = config ?? {}
        this.maxToolRounds =
            this.config.maxToolCallRounds ?? DEFAULT_MAX_TOOL_ROUNDS
        this.numCtx = this.config.numCtx ?? DEFAULT_NUM_CTX
        this.requestTimeoutMs =
            this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
        this.stream = this.config.stream ?? true
        // Pure opt-in: undefined means "leave it to the model default"
        // (no `think` field on the wire). No safe global default exists —
        // see TOllamaProviderConfig.think.
        this.think = this.config.think
    }

    async respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>> {
        // Already-aborted short-circuit — don't even construct the
        // client or call the daemon.
        if (req.signal?.aborted) {
            throw abortError()
        }

        const client = await this.getClient()
        const convertedSchema = typeboxToJsonSchema(req.outputSchema)
        const tools = req.tools ? translateTools(req.tools) : undefined

        const stageIdMatch = STAGE_ID_MARKER.exec(req.systemPrompt)
        const debugStageId = stageIdMatch ? stageIdMatch[1] : null

        // Wire the AbortSignal to the SDK client's abort(). The SDK
        // rejects the in-flight chat() with an AbortError when this
        // fires.
        const onAbort = (): void => {
            client.abort()
        }
        req.signal?.addEventListener("abort", onAbort, { once: true })

        try {
            return await this.runChatLoop<T>({
                client,
                req,
                convertedSchema,
                tools,
                debugStageId,
            })
        } finally {
            req.signal?.removeEventListener("abort", onAbort)
        }
    }

    private async runChatLoop<T>(args: {
        client: TOllamaClient
        req: TLlmRequest<T>
        convertedSchema: Record<string, unknown>
        tools: TOllamaToolWire[] | undefined
        debugStageId: string | null
    }): Promise<TLlmResponse<T>> {
        const { client, req, convertedSchema, tools, debugStageId } = args

        // Running message array. Tool-call rounds append the model's
        // tool_calls echo + the tool result before re-calling.
        const messages: TOllamaChatMessage[] = [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userMessage },
        ]

        let lastUsage: TLlmTokenUsage = { input: 0, output: 0 }

        for (let round = 0; round < this.maxToolRounds; round += 1) {
            const chatRequest: TOllamaChatRequest = {
                model: req.model,
                messages,
                // Build `format` from the single converted object so the
                // schema can't drift from any prompt-grounding copy.
                format: convertedSchema,
                stream: this.stream,
            }
            if (tools) {
                chatRequest.tools = tools
            }
            // Thinking is a pure opt-in knob: send `think` ONLY when the
            // consumer configured it, otherwise leave it to the model
            // default. There is no safe global default — on qwen3.6 the
            // thinking toggle's effect on structured-output fidelity cuts
            // both ways by stage (see TOllamaProviderConfig.think).
            if (this.think !== undefined) {
                chatRequest.think = this.think
            }
            // `temperature: 0` for deterministic structured output;
            // `num_ctx` set generously so Ollama doesn't silently
            // truncate a real multi-KB ingestion prompt (its per-model
            // default is often ~4096). `maxOutputTokens` → num_predict,
            // positive only: 0 means "generate nothing"; -1/-2 are Ollama
            // sentinels we never emit.
            const options: NonNullable<TOllamaChatRequest["options"]> = {
                temperature: 0,
                num_ctx: this.numCtx,
            }
            if (req.maxOutputTokens !== undefined && req.maxOutputTokens > 0) {
                options.num_predict = req.maxOutputTokens
            }
            chatRequest.options = options

            debugLlmRequest({
                stageId: debugStageId,
                model: req.model,
                maxOutputTokens: req.maxOutputTokens,
                reasoningEffort: req.reasoningEffort,
                systemPromptLen: req.systemPrompt.length,
                userMessageLen: req.userMessage.length,
                systemPromptHead: req.systemPrompt,
                userMessageHead: req.userMessage,
            })

            let response: TOllamaChatResponse
            try {
                const raw = await client.chat(chatRequest)
                response = isAsyncIterable(raw) ? await collectStream(raw) : raw
            } catch (err) {
                // Mid-flight abort: the SDK rejects with an AbortError
                // when our signal listener called client.abort().
                // Re-throw verbatim so llmStage marks the stage skipped.
                if (isAbortError(err) || req.signal?.aborted) {
                    throw abortError()
                }
                const classified = classifyOllamaError(err)
                debugLlmFailure({
                    stageId: debugStageId,
                    model: req.model,
                    errorName: classified.name,
                    errorMessage: classified.message,
                    tokenUsage: lastUsage,
                })
                throw classified
            }

            lastUsage = mergeUsage(lastUsage, {
                input: response.prompt_eval_count ?? 0,
                output: response.eval_count ?? 0,
            })

            const toolCalls = response.message.tool_calls ?? []
            if (toolCalls.length > 0) {
                // Echo the assistant tool-call message, then append one
                // tool-result message per call before looping.
                messages.push({
                    role: "assistant",
                    content: response.message.content,
                    tool_calls: toolCalls,
                })
                for (const call of toolCalls) {
                    const handler = findFunctionHandler(
                        req.tools,
                        call.function.name
                    )
                    if (!handler) {
                        throw new NonRetryableLlmError({
                            message: `Ollama requested unknown function tool "${call.function.name}".`,
                        })
                    }
                    const handlerResult = await handler.handler(
                        call.function.arguments
                    )
                    messages.push({
                        role: "tool",
                        content:
                            typeof handlerResult === "string"
                                ? handlerResult
                                : JSON.stringify(handlerResult),
                    })
                }
                continue
            }

            const text = response.message.content
            if (text === undefined || text === "") {
                const thinking = response.message.thinking
                if (thinking !== undefined && thinking !== "") {
                    // The model emitted its whole answer in the thinking
                    // channel and left `content` empty — DETERMINISTIC for
                    // this prompt/model. Surfacing it as the transient
                    // SchemaValidationLlmError would burn a guaranteed-
                    // failing retry on the same request, so fail fast with
                    // actionable guidance and a thinking excerpt.
                    throw new NonRetryableLlmError({
                        message:
                            `Ollama returned an empty assistant \`content\` alongside a ${thinking.length.toString()}-char ` +
                            "thinking trace — the model emitted its answer in the thinking channel, which cannot be " +
                            "consumed as structured output. Set `think: false` on the OllamaProvider config for this " +
                            `stage (configurable via TOllamaProviderConfig.think). Thinking excerpt: ${thinking.slice(0, 200)}`,
                    })
                }
                throw new SchemaValidationLlmError({
                    message:
                        "Ollama chat response carried no assistant text content.",
                })
            }
            const parsed = safeParseJson(text)
            debugLlmResponse({
                stageId: debugStageId,
                outputTextLen: text.length,
                tokenUsage: lastUsage,
            })
            return {
                output: parsed as T,
                tokenUsage: lastUsage,
                // The Ollama chat response is not request-id-bearing;
                // `rawResponseId` is optional, so leaving it undefined is
                // contract-legal. Do not fabricate one.
                rawResponseId: undefined,
            }
        }

        throw new ToolLoopExhaustedError({
            message: `Function-tool agent loop exceeded ${this.maxToolRounds.toString()} rounds without a final response.`,
            rounds: this.maxToolRounds,
        })
    }

    /**
     * Resolve the SDK client: the injected one, or a freshly imported
     * `Ollama` instance. Memoized so the dynamic import + construction
     * runs at most once.
     */
    private getClient(): Promise<TOllamaClient> {
        if (this.config.client) {
            return Promise.resolve(this.config.client)
        }
        this.clientPromise ??= this.importAndConstructClient()
        return this.clientPromise
    }

    private async importAndConstructClient(): Promise<TOllamaClient> {
        const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL
        const importOllama =
            this.config.importOllama ??
            (() => import("ollama") as unknown as Promise<TOllamaModule>)
        let mod: TOllamaModule
        try {
            mod = await importOllama()
        } catch (err) {
            throw new Error(
                "OllamaProvider: the optional `ollama` package is not installed. " +
                    "Run `pnpm add ollama` (it is declared as an optional peerDependency) " +
                    "or pass a pre-built `client` via the provider config. " +
                    `Original import error: ${
                        err instanceof Error ? err.message : String(err)
                    }`
            )
        }
        // Per-provider raised-timeout fetch (no global mutation). Falls
        // back to the SDK default fetch when undici is unavailable or the
        // caller set requestTimeoutMs to 0.
        const timeoutFetch = await buildTimeoutFetch(
            this.requestTimeoutMs,
            this.config.importUndici
        )
        const sdkConfig: { host: string; fetch?: typeof fetch } = {
            host: baseUrl,
        }
        if (timeoutFetch) {
            sdkConfig.fetch = timeoutFetch
        }
        return new mod.Ollama(sdkConfig)
    }
}

// -- helpers --------------------------------------------------------------

function abortError(): Error {
    const e = new Error("The Ollama request was aborted.")
    e.name = "AbortError"
    return e
}

function isAbortError(err: unknown): boolean {
    return (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: unknown }).name === "AbortError"
    )
}

function safeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown
    } catch (err) {
        throw new SchemaValidationLlmError({
            message: `Ollama returned malformed JSON in structured-output content: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
}

function isAsyncIterable(
    value: unknown
): value is AsyncIterable<TOllamaChatResponse> {
    return (
        typeof value === "object" &&
        value !== null &&
        Symbol.asyncIterator in value
    )
}

/**
 * Consume a streamed `chat()` generation and synthesize a single
 * `TOllamaChatResponse`: concatenated `message.content`, tool_calls
 * captured from any chunk that carries them, and the eval counts from
 * the final (`done: true`) chunk. The synthesized response feeds the
 * existing one-shot processing path unchanged, so `respond()`'s
 * contract is preserved.
 */
async function collectStream(
    iterable: AsyncIterable<TOllamaChatResponse>
): Promise<TOllamaChatResponse> {
    let content = ""
    let thinking = ""
    let role = "assistant"
    let toolCalls: TOllamaChatToolCall[] | undefined
    let promptEvalCount = 0
    let evalCount = 0
    for await (const chunk of iterable) {
        const msg = chunk.message
        if (msg) {
            content += msg.content ?? ""
            // Accumulate the thinking channel too, so an empty `content`
            // accompanied by a thinking trace is surfaced as a
            // deterministic failure rather than the generic "no content"
            // transient error. See runChatLoop's empty-content branch.
            thinking += msg.thinking ?? ""
            if (msg.role) role = msg.role
            // Ollama emits tool_calls complete within a single chunk
            // (not OpenAI-style per-index deltas), so take the latest
            // chunk that carries them — concatenating would DUPLICATE
            // calls. Ingestion is tool-free; only tool-using callers
            // exercise this path.
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                toolCalls = msg.tool_calls
            }
        }
        // Last-wins: the synthesized response carries the FINAL chunk's
        // single-round eval counts, NOT a cumulative sum across chunks.
        // The terminal chunk reports this round's complete terminal
        // counts, so taking the last value is the correct per-round
        // figure. `runChatLoop`'s `mergeUsage` then SUMS these per-round
        // terminal counts across tool-call rounds — summing the chunk
        // values here instead would double-count within a round.
        if (chunk.prompt_eval_count !== undefined) {
            promptEvalCount = chunk.prompt_eval_count
        }
        if (chunk.eval_count !== undefined) {
            evalCount = chunk.eval_count
        }
    }
    return {
        message: { role, content, thinking, tool_calls: toolCalls },
        done: true,
        prompt_eval_count: promptEvalCount,
        eval_count: evalCount,
    }
}

function mergeUsage(
    accumulated: TLlmTokenUsage,
    next: TLlmTokenUsage
): TLlmTokenUsage {
    return {
        input: accumulated.input + next.input,
        output: accumulated.output + next.output,
    }
}

function translateTools(tools: readonly TToolSpec[]): TOllamaToolWire[] {
    return tools.map((tool) => {
        if (tool.kind === "function") {
            return {
                type: "function",
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: typeboxToJsonSchema(tool.parameters),
                },
            }
        }
        // Hosted-tool kinds (web_search / file_search / mcp) have no
        // local Ollama equivalent. Fail fast and legibly.
        throw new NonRetryableLlmError({
            message: `Tool kind "${tool.kind}" is not supported by the Ollama provider. Only kind "function" (local handler) is supported.`,
        })
    })
}

function findFunctionHandler(
    tools: readonly TToolSpec[] | undefined,
    name: string
): Extract<TToolSpec, { kind: "function" }> | undefined {
    if (!tools) return undefined
    for (const tool of tools) {
        if (tool.kind === "function" && tool.name === name) {
            return tool
        }
    }
    return undefined
}
