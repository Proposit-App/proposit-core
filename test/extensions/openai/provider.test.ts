// Provider unit tests — exercise the OpenAI Responses-API adapter
// through an injected `fetch` mock. The tests assert request shape,
// response parsing, the tool-call agent loop, error classification,
// and abort propagation. No real network calls.

import { describe, it, expect, vi } from "vitest"
import Type from "typebox"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/provider.js"
import {
    NonRetryableLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    ToolLoopExhaustedError,
    TransientLlmError,
} from "../../../src/extensions/openai/errors.js"
import type { TOpenAiFetch } from "../../../src/extensions/openai/types.js"

// -- fixtures ------------------------------------------------------

const simpleSchema = Type.Object({
    answer: Type.String(),
})

type TFetchMock = ReturnType<typeof vi.fn>

function asFetch(mock: TFetchMock): TOpenAiFetch {
    return mock as unknown as TOpenAiFetch
}

function buildSuccessResponse(args: {
    body: unknown
    id?: string
    usage?: {
        inputTokens?: number
        outputTokens?: number
        reasoningTokens?: number
    }
}): Response {
    const id = args.id ?? "resp_test_1"
    const usage = args.usage ?? { inputTokens: 10, outputTokens: 5 }
    // Wire-format JSON literal — snake_case field names mirror the
    // OpenAI Responses API payload.
    const json = {
        id,
        output: [
            {
                type: "message",
                role: "assistant",
                content: [
                    {
                        type: "output_text",
                        text: JSON.stringify(args.body),
                    },
                ],
            },
        ],
        usage: {
            input_tokens: usage.inputTokens ?? 0,
            output_tokens: usage.outputTokens ?? 0,
            output_tokens_details:
                usage.reasoningTokens !== undefined
                    ? { reasoning_tokens: usage.reasoningTokens }
                    : undefined,
        },
    }
    return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

function buildToolCallResponse(args: {
    callId: string
    toolName: string
    callArguments: unknown
    id?: string
}): Response {
    // Wire-format JSON literal — snake_case field names mirror the
    // OpenAI Responses API payload.
    const json = {
        id: args.id ?? "resp_tool_1",
        output: [
            {
                type: "function_call",
                call_id: args.callId,
                name: args.toolName,
                arguments: JSON.stringify(args.callArguments),
            },
        ],
        usage: { input_tokens: 5, output_tokens: 2 },
    }
    return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

function buildErrorResponse(status: number, message = "boom"): Response {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { "Content-Type": "application/json" },
    })
}

// -- tests ---------------------------------------------------------

describe("createOpenAiResponsesProvider — request shape", () => {
    it("issues a POST to the Responses API endpoint with bearer auth", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildSuccessResponse({ body: { answer: "hi" } }))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "system",
            userMessage: "hello",
            outputSchema: simpleSchema,
        })

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("https://api.openai.com/v1/responses")
        expect(init.method).toBe("POST")
        const headers = init.headers as Record<string, string>
        expect(headers.Authorization).toBe("Bearer sk-test")
        expect(headers["Content-Type"]).toBe("application/json")
    })

    it("encodes the request body using Responses-API field names (input + text.format with strict)", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildSuccessResponse({ body: { answer: "ok" } }))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
        })

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        expect(body.model).toBe("gpt-5.4")
        expect(Array.isArray(body.input)).toBe(true)
        const input = body.input as { role: string }[]
        expect(input.map((m) => m.role)).toEqual(["system", "user"])
        // Per the live Responses API: structured output lives under
        // `text.format`, not the chat-completions-era
        // `response_format`. `name`, `schema`, and `strict` are
        // siblings of `type` (not nested under a `json_schema` slot).
        const textField = body.text as { format: Record<string, unknown> }
        expect(textField.format.type).toBe("json_schema")
        expect(textField.format.strict).toBe(true)
        expect(typeof textField.format.name).toBe("string")
        expect(textField.format.schema).toMatchObject({ type: "object" })
        expect(body).not.toHaveProperty("response_format")
        // No max_output_tokens unless caller supplied it.
        expect(body).not.toHaveProperty("max_output_tokens")
    })

    it("propagates maxOutputTokens to max_output_tokens when supplied", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildSuccessResponse({ body: { answer: "ok" } }))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
            maxOutputTokens: 1024,
        })

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        expect(body.max_output_tokens).toBe(1024)
    })

    it("propagates reasoningEffort under the reasoning.effort field when supplied", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildSuccessResponse({ body: { answer: "ok" } }))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
            reasoningEffort: "high",
        })

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        expect(body.reasoning).toEqual({ effort: "high" })
    })

    it("translates each TToolSpec kind into the Responses-API tool shape", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildSuccessResponse({ body: { answer: "ok" } }))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
            tools: [
                { kind: "web_search" },
                { kind: "file_search", vectorStoreId: "vs_abc" },
                {
                    kind: "mcp",
                    serverUrl: "https://example.test/mcp",
                    toolName: "lookup",
                },
                {
                    kind: "function",
                    name: "echo",
                    description: "Echoes the input.",
                    parameters: Type.Object({ value: Type.String() }),
                    handler: (args) => Promise.resolve(args),
                },
            ],
        })

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        const tools = body.tools as Record<string, unknown>[]
        expect(tools).toHaveLength(4)
        expect(tools[0]).toEqual({ type: "web_search" })
        // Wire-format snake_case keys for OpenAI Responses-API tool entries.
        expect(tools[1]).toMatchObject({
            type: "file_search",
            vector_store_ids: ["vs_abc"],
        })
        expect(tools[2]).toMatchObject({
            type: "mcp",
            server_url: "https://example.test/mcp",
        })
        expect(tools[3]).toMatchObject({
            type: "function",
            name: "echo",
            description: "Echoes the input.",
        })
        // Function parameter schema converted via the structured-output converter.
        const fn = tools[3] as { parameters: Record<string, unknown> }
        expect(fn.parameters).toMatchObject({
            type: "object",
            additionalProperties: false,
        })
    })

    it("honors an overridden baseUrl", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildSuccessResponse({ body: { answer: "ok" } }))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            baseUrl: "https://proxy.test/v1/responses",
            fetch: asFetch(fetchMock),
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
        })

        const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("https://proxy.test/v1/responses")
    })
})

describe("createOpenAiResponsesProvider — response parsing", () => {
    it("returns the parsed structured output + token usage + rawResponseId", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildSuccessResponse({
                body: { answer: "forty-two" },
                id: "resp_abc",
                usage: {
                    inputTokens: 100,
                    outputTokens: 25,
                    reasoningTokens: 7,
                },
            })
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        const response = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
        })

        expect(response.output).toEqual({ answer: "forty-two" })
        expect(response.tokenUsage).toEqual({
            input: 100,
            output: 25,
            reasoning: 7,
        })
        expect(response.rawResponseId).toBe("resp_abc")
    })

    it("omits reasoning from tokenUsage when the API doesn't report it", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildSuccessResponse({
                body: { answer: "x" },
                usage: { inputTokens: 1, outputTokens: 1 },
            })
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        const response = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
        })

        expect(response.tokenUsage.reasoning).toBeUndefined()
    })
})

describe("createOpenAiResponsesProvider — tool-call agent loop", () => {
    it("executes a function tool handler and re-calls with the tool result", async () => {
        const handler = vi.fn().mockResolvedValue({ result: "echoed" })
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                buildToolCallResponse({
                    callId: "call_1",
                    toolName: "echo",
                    callArguments: { value: "hi" },
                })
            )
            .mockResolvedValueOnce(
                buildSuccessResponse({ body: { answer: "final" } })
            )

        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        const response = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
            tools: [
                {
                    kind: "function",
                    name: "echo",
                    description: "Echoes the input.",
                    parameters: Type.Object({ value: Type.String() }),
                    handler,
                },
            ],
        })

        expect(response.output).toEqual({ answer: "final" })
        expect(handler).toHaveBeenCalledTimes(1)
        expect(handler).toHaveBeenCalledWith({ value: "hi" })
        expect(fetchMock).toHaveBeenCalledTimes(2)

        // Second call should carry the tool result in input.
        const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
        const secondBody = JSON.parse(secondInit.body as string) as {
            input: Record<string, unknown>[]
        }
        const toolResult = secondBody.input.find(
            (m) => m.type === "function_call_output"
        )
        expect(toolResult).toBeDefined()
        // `call_id` is the wire-format key from the OpenAI spec.
        const toolResultRecord = toolResult!
        expect(toolResultRecord.call_id).toBe("call_1")
    })

    it("throws ToolLoopExhaustedError when the model loops past the configured maxToolCallRounds", async () => {
        const handler = vi.fn().mockResolvedValue({ ok: true })
        const fetchMock: TFetchMock = vi.fn().mockImplementation(() =>
            Promise.resolve(
                buildToolCallResponse({
                    callId: `call_${fetchMock.mock.calls.length}`,
                    toolName: "echo",
                    callArguments: { value: "loop" },
                })
            )
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
            maxToolCallRounds: 3,
        })

        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
                tools: [
                    {
                        kind: "function",
                        name: "echo",
                        description: "Echoes.",
                        parameters: Type.Object({ value: Type.String() }),
                        handler,
                    },
                ],
            })
        ).rejects.toBeInstanceOf(ToolLoopExhaustedError)
    })

    it("does not enter the loop for built-in tools (web_search) when the model returns final output", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildSuccessResponse({ body: { answer: "fresh" } })
            )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        const response = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
            tools: [{ kind: "web_search" }],
        })

        expect(response.output).toEqual({ answer: "fresh" })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})

describe("createOpenAiResponsesProvider — error classification", () => {
    it("throws TransientLlmError on 500", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(500, "internal"))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("throws RateLimitLlmError on 429", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(429, "too many"))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(RateLimitLlmError)
    })

    it("throws SchemaValidationLlmError on 400", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(400, "bad schema"))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })

    it("throws SchemaValidationLlmError on 422", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(422, "unprocessable"))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })

    it("throws NonRetryableLlmError on 401", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(401, "unauthorized"))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })

    it("throws NonRetryableLlmError on 403", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(403, "forbidden"))
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })
})

describe("createOpenAiResponsesProvider — abort propagation", () => {
    it("passes the abort signal through to fetch", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockImplementation((_url: string, init: RequestInit) => {
                if (init.signal?.aborted) {
                    const err = new Error("aborted")
                    err.name = "AbortError"
                    return Promise.reject(err)
                }
                return Promise.resolve(
                    buildSuccessResponse({ body: { answer: "ok" } })
                )
            })
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            fetch: asFetch(fetchMock),
        })

        const controller = new AbortController()
        controller.abort()
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
                signal: controller.signal,
            })
        ).rejects.toThrowError(/abort/i)
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(init.signal).toBe(controller.signal)
    })
})
