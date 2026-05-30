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
        expect(req.stream).toBe(false)
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
