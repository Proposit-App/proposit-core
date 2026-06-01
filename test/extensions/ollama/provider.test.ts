// Provider unit tests — exercise the Ollama adapter through an
// injected mock client (no network, no daemon). Assert request shape,
// response parsing, structured-output `format`, tokenUsage mapping,
// the function-tool agent loop, error classification, abort
// propagation, and the missing-package guard.

import { describe, it, expect, vi } from "vitest"
import Type from "typebox"
import { OllamaProvider } from "../../../src/extensions/ollama/provider.js"
import {
    NonRetryableLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
} from "../../../src/extensions/ollama/errors.js"
import type {
    TOllamaChatRequest,
    TOllamaChatResponse,
    TOllamaClient,
    TUndiciModule,
} from "../../../src/extensions/ollama/types.js"

const simpleSchema = Type.Object({
    answer: Type.String(),
})

function noop(): void {
    // intentional no-op default abort
}

function okResponse(args: {
    body: unknown
    promptEvalCount?: number
    evalCount?: number
    toolCalls?: TOllamaChatResponse["message"]["tool_calls"]
}): TOllamaChatResponse {
    return {
        message: {
            role: "assistant",
            content:
                args.toolCalls && args.toolCalls.length > 0
                    ? ""
                    : JSON.stringify(args.body),
            tool_calls: args.toolCalls,
        },
        prompt_eval_count: args.promptEvalCount ?? 10,
        eval_count: args.evalCount ?? 5,
    }
}

function mockClient(args: {
    onChat: (req: TOllamaChatRequest) => Promise<TOllamaChatResponse>
    onAbort?: () => void
}): TOllamaClient {
    return {
        chat: args.onChat,
        abort: args.onAbort ?? noop,
    }
}

function streamOf(
    chunks: TOllamaChatResponse[]
): AsyncIterable<TOllamaChatResponse> {
    return {
        // eslint-disable-next-line @typescript-eslint/require-await
        async *[Symbol.asyncIterator]() {
            for (const c of chunks) {
                yield c
            }
        },
    }
}

describe("OllamaProvider — request shape", () => {
    it("sends model, system+user messages, format schema, temperature 0", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })

        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "system here",
            userMessage: "user here",
            outputSchema: simpleSchema,
        })

        expect(captured).toHaveLength(1)
        const req = captured[0]
        expect(req.model).toBe("qwen3.6:latest")
        expect(req.stream).toBe(true)
        expect(req.messages).toEqual([
            { role: "system", content: "system here" },
            { role: "user", content: "user here" },
        ])
        expect(req.options?.temperature).toBe(0)
        // format is the converted JSON schema object.
        expect(req.format).toMatchObject({
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
        })
    })

    it("sends a generous default options.num_ctx (32768) so real prompts aren't silently truncated", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(captured[0].options?.num_ctx).toBe(32768)
    })

    it("honors an explicit numCtx config override on options.num_ctx", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            numCtx: 65536,
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(captured[0].options?.num_ctx).toBe(65536)
    })

    it("maps maxOutputTokens → options.num_predict (positive only; never 0)", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })

        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            maxOutputTokens: 4096,
        })
        expect(captured[0].options?.num_predict).toBe(4096)

        // A 0 (or negative) maxOutputTokens must NOT be emitted —
        // `num_predict: 0` means "generate nothing", -1/-2 are sentinels.
        captured.length = 0
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            maxOutputTokens: 0,
        })
        expect(captured[0].options?.num_predict).toBeUndefined()
    })

    it("ignores reasoningEffort (OpenAI-specific knob)", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            reasoningEffort: "high",
        })
        // No reasoning/effort field leaks into the request.
        expect(JSON.stringify(captured[0])).not.toMatch(/effort|reasoning/i)
    })
})

describe("OllamaProvider — response handling", () => {
    it("parses message.content as JSON and returns the typed output", async () => {
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () =>
                    Promise.resolve(okResponse({ body: { answer: "42" } })),
            }),
        })
        const result = await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(result.output).toEqual({ answer: "42" })
    })

    it("maps tokenUsage: prompt_eval_count→input, eval_count→output; reasoning unset; rawResponseId undefined", async () => {
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () =>
                    Promise.resolve(
                        okResponse({
                            body: { answer: "ok" },
                            promptEvalCount: 123,
                            evalCount: 45,
                        })
                    ),
            }),
        })
        const result = await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(result.tokenUsage).toEqual({ input: 123, output: 45 })
        expect(result.tokenUsage.reasoning).toBeUndefined()
        expect(result.rawResponseId).toBeUndefined()
    })

    it("throws SchemaValidationLlmError on non-JSON content (framework schema-retry path)", async () => {
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () =>
                    Promise.resolve({
                        message: { role: "assistant", content: "not json {{{" },
                        prompt_eval_count: 1,
                        eval_count: 1,
                    }),
            }),
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })

    it("routes a thrown daemon error through classifyOllamaError (ECONNREFUSED → NonRetryable)", async () => {
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () => {
                    const e = new Error("fetch failed") as Error & {
                        code?: string
                    }
                    e.code = "ECONNREFUSED"
                    return Promise.reject(e)
                },
            }),
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })
})

describe("OllamaProvider — function-tool agent loop", () => {
    it("executes a function tool, feeds the result back, and returns the final answer", async () => {
        const handler = vi.fn().mockResolvedValue({ temp: 72 })
        let round = 0
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () => {
                    round += 1
                    if (round === 1) {
                        return Promise.resolve(
                            okResponse({
                                body: {},
                                toolCalls: [
                                    {
                                        function: {
                                            name: "getWeather",
                                            arguments: { city: "SF" },
                                        },
                                    },
                                ],
                            })
                        )
                    }
                    return Promise.resolve(
                        okResponse({ body: { answer: "72F" } })
                    )
                },
            }),
        })

        const result = await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            tools: [
                {
                    kind: "function",
                    name: "getWeather",
                    description: "get weather",
                    parameters: Type.Object({ city: Type.String() }),
                    handler,
                },
            ],
        })

        expect(handler).toHaveBeenCalledWith({ city: "SF" })
        expect(result.output).toEqual({ answer: "72F" })
    })

    it("throws ToolLoopExhaustedError when the round cap is hit", async () => {
        const provider = new OllamaProvider({
            maxToolCallRounds: 2,
            client: mockClient({
                onChat: () =>
                    Promise.resolve(
                        okResponse({
                            body: {},
                            toolCalls: [
                                {
                                    function: {
                                        name: "loop",
                                        arguments: {},
                                    },
                                },
                            ],
                        })
                    ),
            }),
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                tools: [
                    {
                        kind: "function",
                        name: "loop",
                        description: "never ends",
                        parameters: Type.Object({}),
                        handler: () => Promise.resolve({}),
                    },
                ],
            })
        ).rejects.toBeInstanceOf(ToolLoopExhaustedError)
    })

    it("throws NonRetryableLlmError for a hosted tool kind (web_search) with no local equivalent", async () => {
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () =>
                    Promise.resolve(okResponse({ body: { answer: "x" } })),
            }),
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                tools: [{ kind: "web_search" }],
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })
})

describe("OllamaProvider — per-provider request timeout", () => {
    it("constructs the SDK client with a custom fetch backed by a default 20-min undici Agent", async () => {
        const capturedAgentOptions: { value?: unknown } = {}
        const capturedOllamaConfig: { value?: unknown } = {}

        const fakeUndici: TUndiciModule = {
            Agent: class {
                constructor(options: unknown) {
                    capturedAgentOptions.value = options
                }
            },
            fetch: (() =>
                Promise.resolve(new Response("{}"))) as unknown as typeof fetch,
        }
        const fakeOllamaModule = {
            Ollama: class {
                constructor(config: unknown) {
                    capturedOllamaConfig.value = config
                }
                chat(): Promise<TOllamaChatResponse> {
                    return Promise.resolve(
                        okResponse({ body: { answer: "ok" } })
                    )
                }
                abort(): void {
                    // no-op
                }
            },
        }

        const provider = new OllamaProvider({
            importUndici: () => Promise.resolve(fakeUndici),
            importOllama: () => Promise.resolve(fakeOllamaModule),
        })

        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(capturedAgentOptions.value).toMatchObject({
            headersTimeout: 1_200_000,
            bodyTimeout: 1_200_000,
        })
        // The SDK client was constructed with a custom fetch.
        expect(
            (capturedOllamaConfig.value as { fetch?: unknown }).fetch
        ).toBeTypeOf("function")
    })

    it("honors an explicit requestTimeoutMs override on the Agent", async () => {
        const capturedAgentOptions: { value?: unknown } = {}
        const fakeUndici: TUndiciModule = {
            Agent: class {
                constructor(options: unknown) {
                    capturedAgentOptions.value = options
                }
            },
            fetch: (() =>
                Promise.resolve(new Response("{}"))) as unknown as typeof fetch,
        }
        const fakeOllamaModule = {
            Ollama: class {
                constructor() {
                    // no-op
                }
                chat(): Promise<TOllamaChatResponse> {
                    return Promise.resolve(
                        okResponse({ body: { answer: "ok" } })
                    )
                }
                abort(): void {
                    // no-op
                }
            },
        }

        const provider = new OllamaProvider({
            requestTimeoutMs: 600_000,
            importUndici: () => Promise.resolve(fakeUndici),
            importOllama: () => Promise.resolve(fakeOllamaModule),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(capturedAgentOptions.value).toMatchObject({
            headersTimeout: 600_000,
            bodyTimeout: 600_000,
        })
    })

    it("constructs the SDK client without a custom fetch when requestTimeoutMs is 0", async () => {
        const capturedOllamaConfig: { value?: unknown } = {}
        const fakeUndici: TUndiciModule = {
            Agent: class {
                constructor() {
                    throw new Error(
                        "Agent must not be constructed when timeout is 0"
                    )
                }
            },
            fetch: (() => {
                throw new Error("fetch must not be used when timeout is 0")
            }) as unknown as typeof fetch,
        }
        const fakeOllamaModule = {
            Ollama: class {
                constructor(config: unknown) {
                    capturedOllamaConfig.value = config
                }
                chat(): Promise<TOllamaChatResponse> {
                    return Promise.resolve(
                        okResponse({ body: { answer: "ok" } })
                    )
                }
                abort(): void {
                    // no-op
                }
            },
        }
        const provider = new OllamaProvider({
            requestTimeoutMs: 0,
            importUndici: () => Promise.resolve(fakeUndici),
            importOllama: () => Promise.resolve(fakeOllamaModule),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(
            (capturedOllamaConfig.value as { fetch?: unknown }).fetch
        ).toBeUndefined()
    })
})

describe("OllamaProvider — streaming (Level 1a)", () => {
    it("accumulates streamed content into one parsed result and reads usage from the final chunk", async () => {
        const captured: TOllamaChatRequest[] = []
        const full = JSON.stringify({ answer: "hello world" })
        const mid = Math.floor(full.length / 2)
        const provider = new OllamaProvider({
            client: {
                chat: (req: TOllamaChatRequest) => {
                    captured.push(req)
                    return Promise.resolve(
                        streamOf([
                            {
                                message: {
                                    role: "assistant",
                                    content: full.slice(0, mid),
                                },
                                done: false,
                                // Stale intermediate counts MUST be
                                // overridden by the final chunk
                                // (last-wins, not summed). The assertion
                                // below expects 42/7, not 1041/1006.
                                prompt_eval_count: 999,
                                eval_count: 999,
                            },
                            {
                                message: {
                                    role: "assistant",
                                    content: full.slice(mid),
                                },
                                done: true,
                                prompt_eval_count: 42,
                                eval_count: 7,
                            },
                        ])
                    )
                },
                abort: noop,
            },
            stream: true,
        })

        const res = await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(res.output).toEqual({ answer: "hello world" })
        expect(res.tokenUsage).toEqual({ input: 42, output: 7 })
        expect(captured[0].stream).toBe(true)
    })

    it("falls back to the one-shot path when stream is false", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "x" } })
                    )
                },
            }),
            stream: false,
        })
        const res = await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(res.output).toEqual({ answer: "x" })
        expect(captured[0].stream).toBe(false)
    })

    it("defaults stream to true when no knob is passed", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "x" } })
                    )
                },
            }),
        })
        // Await directly — the mock returns a valid one-shot response, so
        // respond() resolves; no fire-and-forget + setTimeout race.
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(captured[0].stream).toBe(true)
    })

    it("rejects an empty (zero-chunk) stream as a schema-validation error", async () => {
        const provider = new OllamaProvider({
            client: {
                chat: () => Promise.resolve(streamOf([])),
                abort: noop,
            },
            stream: true,
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })
})

describe("OllamaProvider — abort handling", () => {
    it("calls client.abort() when the signal fires and surfaces an AbortError", async () => {
        const onAbort = vi.fn()
        const controller = new AbortController()
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () => {
                    // Simulate the signal firing during the call, then
                    // the SDK rejecting with an AbortError as it does
                    // when `abort()` is invoked mid-flight.
                    controller.abort()
                    const e = new Error("The operation was aborted")
                    e.name = "AbortError"
                    return Promise.reject(e)
                },
                onAbort,
            }),
        })

        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: "AbortError" })
        expect(onAbort).toHaveBeenCalled()
    })

    it("short-circuits with an AbortError if the signal is already aborted", async () => {
        const controller = new AbortController()
        controller.abort()
        const onChat = vi.fn()
        const provider = new OllamaProvider({
            client: mockClient({ onChat }),
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: "AbortError" })
        expect(onChat).not.toHaveBeenCalled()
    })
})

describe("OllamaProvider — thinking control", () => {
    it("sends no think field by default (leaves it to the model default — a pure opt-in knob)", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        // No safe global default: send `think` only when configured.
        expect(captured[0].think).toBeUndefined()
        expect("think" in captured[0]).toBe(false)
    })

    it("threads an explicit think:true config onto the request", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            think: true,
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(captured[0].think).toBe(true)
    })

    it("threads an explicit think:false config onto the request", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            think: false,
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(
                        okResponse({ body: { answer: "hi" } })
                    )
                },
            }),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(captured[0].think).toBe(false)
    })

    it("raises a non-transient, actionable error when content is empty but a thinking trace was produced", async () => {
        const provider = new OllamaProvider({
            think: true,
            client: mockClient({
                onChat: () =>
                    Promise.resolve({
                        message: {
                            role: "assistant",
                            content: "",
                            thinking:
                                "Let me reason about the schema. The answer object is " +
                                '`{"answer":"x"}`. Matches schema. Done.',
                        },
                        prompt_eval_count: 10,
                        eval_count: 200,
                    }),
            }),
        })
        // Not the generic transient SchemaValidationLlmError that burns a
        // guaranteed-failing retry — a deterministic, actionable failure.
        const promise = provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        await expect(promise).rejects.toBeInstanceOf(NonRetryableLlmError)
        await expect(promise).rejects.toThrow(/think/i)
    })

    it("still raises SchemaValidationLlmError when content is empty and no thinking trace was produced", async () => {
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: () =>
                    Promise.resolve({
                        message: { role: "assistant", content: "" },
                        prompt_eval_count: 1,
                        eval_count: 1,
                    }),
            }),
        })
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })

    it("accumulates the streamed thinking channel and raises a non-transient error when only thinking is produced", async () => {
        const provider = new OllamaProvider({
            think: true,
            client: {
                chat: () =>
                    Promise.resolve(
                        streamOf([
                            {
                                message: {
                                    role: "assistant",
                                    content: "",
                                    thinking: "first half ",
                                },
                                done: false,
                            },
                            {
                                message: {
                                    role: "assistant",
                                    content: "",
                                    thinking: "second half",
                                },
                                done: true,
                                prompt_eval_count: 5,
                                eval_count: 9,
                            },
                        ])
                    ),
                abort: noop,
            },
            stream: true,
        })
        // If collectStream dropped msg.thinking, the synthesized response
        // would carry no thinking and this would fall to the transient
        // SchemaValidationLlmError path instead.
        await expect(
            provider.respond({
                model: "qwen3.6:latest",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })
})
