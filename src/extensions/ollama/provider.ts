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
import {
    NonRetryableLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    classifyOllamaError,
} from "./errors.js"
import type {
    TOllamaChatMessage,
    TOllamaChatRequest,
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

export class OllamaProvider implements TLlmProvider {
    private readonly config: TOllamaProviderConfig
    private clientPromise: Promise<TOllamaClient> | null = null
    private readonly maxToolRounds: number
    private readonly numCtx: number

    constructor(config?: TOllamaProviderConfig) {
        this.config = config ?? {}
        this.maxToolRounds =
            this.config.maxToolCallRounds ?? DEFAULT_MAX_TOOL_ROUNDS
        this.numCtx = this.config.numCtx ?? DEFAULT_NUM_CTX
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
                stream: false,
            }
            if (tools) {
                chatRequest.tools = tools
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

            let response
            try {
                response = await client.chat(chatRequest)
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
        let mod: TOllamaModule
        try {
            mod = (await import("ollama")) as unknown as TOllamaModule
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
        return new mod.Ollama({ host: baseUrl })
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
