// Provider unit tests — exercise the OpenAI Responses-API adapter
// through an injected `fetch` mock. The tests assert request shape,
// response parsing, the tool-call agent loop, error classification,
// and abort propagation. No real network calls.

import { describe, it, expect, vi } from "vitest"
import Type from "typebox"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/provider.js"
import {
    retrieveResponse,
    reconnectStream,
    cancelResponse,
    submitBackgroundResponse,
} from "../../../src/extensions/openai/openai-retrieval.js"
import {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
    RateLimitLlmError,
    ResponseNotFoundError,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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
            stream: false,
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

        // Second call should carry the original function_call AND
        // its matching function_call_output in input, in that order
        // (per the Responses-API conversation-history contract).
        const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
        const secondBody = JSON.parse(secondInit.body as string) as {
            input: Record<string, unknown>[]
        }
        const fnCallIdx = secondBody.input.findIndex(
            (m) => m.type === "function_call"
        )
        const fnOutputIdx = secondBody.input.findIndex(
            (m) => m.type === "function_call_output"
        )
        expect(fnCallIdx).toBeGreaterThanOrEqual(0)
        expect(fnOutputIdx).toBeGreaterThanOrEqual(0)
        // function_call appears before function_call_output.
        expect(fnCallIdx).toBeLessThan(fnOutputIdx)
        // Both items pair on the same call_id.
        const fnCall = secondBody.input[fnCallIdx]
        const toolResult = secondBody.input[fnOutputIdx]
        expect(fnCall.call_id).toBe("call_1")
        expect(fnCall.name).toBe("echo")
        // The function_call's arguments are echoed verbatim as the
        // wire-format JSON string the model emitted.
        expect(fnCall.arguments).toBe(JSON.stringify({ value: "hi" }))
        expect(toolResult.call_id).toBe("call_1")
    })

    it("re-emits ALL function_call items + outputs in order for a multi-tool-call response", async () => {
        // Per the Responses-API contract, when the model emits N
        // function_call items in one response, the next request must
        // include all N original function_call items paired with
        // their N function_call_output companions — same order.
        const handler = vi
            .fn()
            .mockResolvedValueOnce({ tag: "first" })
            .mockResolvedValueOnce({ tag: "second" })

        // First fetch: response with two function_call items.
        const twoCallResponse = (): Response => {
            // Wire-format JSON for the multi-call response — snake_case
            // mirrors the OpenAI Responses API payload.
            const json = {
                id: "resp_multi",
                output: [
                    {
                        type: "function_call",
                        call_id: "call_a",
                        name: "echo",
                        arguments: JSON.stringify({ value: "alpha" }),
                    },
                    {
                        type: "function_call",
                        call_id: "call_b",
                        name: "echo",
                        arguments: JSON.stringify({ value: "beta" }),
                    },
                ],
                usage: { input_tokens: 3, output_tokens: 4 },
            }
            return new Response(JSON.stringify(json), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        }
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValueOnce(twoCallResponse())
            .mockResolvedValueOnce(
                buildSuccessResponse({ body: { answer: "done" } })
            )

        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            stream: false,
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
                    description: "Echoes.",
                    parameters: Type.Object({ value: Type.String() }),
                    handler,
                },
            ],
        })

        expect(response.output).toEqual({ answer: "done" })
        expect(handler).toHaveBeenCalledTimes(2)
        // Handlers fire in the order the model emitted the calls.
        expect(handler.mock.calls[0]).toEqual([{ value: "alpha" }])
        expect(handler.mock.calls[1]).toEqual([{ value: "beta" }])

        // Second fetch body carries all four input items in the
        // [call_a, output_a, call_b, output_b] order.
        const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit]
        const secondBody = JSON.parse(secondInit.body as string) as {
            input: Record<string, unknown>[]
        }
        const toolItems = secondBody.input.filter(
            (m) =>
                m.type === "function_call" || m.type === "function_call_output"
        )
        expect(toolItems).toHaveLength(4)
        expect(toolItems[0]).toMatchObject({
            type: "function_call",
            call_id: "call_a",
            name: "echo",
        })
        expect(toolItems[1]).toMatchObject({
            type: "function_call_output",
            call_id: "call_a",
        })
        expect(toolItems[2]).toMatchObject({
            type: "function_call",
            call_id: "call_b",
            name: "echo",
        })
        expect(toolItems[3]).toMatchObject({
            type: "function_call_output",
            call_id: "call_b",
        })
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
            stream: false,
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
            stream: false,
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

    it("throws NonRetryableLlmError on 400 (converter-bug 400s shouldn't burn a retry)", async () => {
        // 400 from OpenAI typically signals a malformed request or
        // unsupported parameter — a code bug on our side, not
        // something a re-roll fixes. Classify as non-retryable so
        // the framework surfaces immediately.
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(buildErrorResponse(400, "bad request"))
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

    it("throws SchemaValidationLlmError on 422 (model output failed strict-mode; re-roll may succeed)", async () => {
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

describe("createOpenAiResponsesProvider — 429 quota vs rate-limit classification", () => {
    // OpenAI returns BOTH transient throttling and persistent budget
    // exhaustion as HTTP 429; they differ only in the response body's
    // structured `error.code` / `error.type`. The provider parses the
    // body and routes `insufficient_quota` to QuotaExhaustedLlmError,
    // leaving every other (and every unparseable) 429 on the transient
    // RateLimitLlmError path.

    function buildRawResponse(status: number, rawBody: string): Response {
        return new Response(rawBody, {
            status,
            headers: { "Content-Type": "application/json" },
        })
    }

    it("throws QuotaExhaustedLlmError on a 429 whose body code is insufficient_quota", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildRawResponse(
                429,
                JSON.stringify({
                    error: {
                        type: "insufficient_quota",
                        code: "insufficient_quota",
                        message: "You exceeded your current quota",
                    },
                })
            )
        )
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
        ).rejects.toBeInstanceOf(QuotaExhaustedLlmError)
    })

    it("throws RateLimitLlmError on a 429 whose body code is rate_limit_exceeded (transient, unchanged)", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildRawResponse(
                429,
                JSON.stringify({
                    error: {
                        type: "requests",
                        code: "rate_limit_exceeded",
                        message: "Rate limit reached",
                    },
                })
            )
        )
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

    it("falls back to RateLimitLlmError on a 429 with an unparseable (non-JSON) body — never a false quota trip", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildRawResponse(429, "<html>429 Too Many Requests</html>")
            )
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

    it('falls back to RateLimitLlmError on a 429 with {"error":{}} (no code/type discriminator)', async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildRawResponse(429, JSON.stringify({ error: {} }))
            )
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
})

describe("createOpenAiResponsesProvider — incomplete-response detection", () => {
    // **Regression for the v1.3.0 segmentation truncation.** When
    // the Responses API hits the `max_output_tokens` cap (either an
    // explicit cap or the model's default), it returns 200 OK with
    // `status: "incomplete"` + `incomplete_details: { reason:
    // "max_output_tokens" }` and a *partial* `output_text` that's
    // valid JSON only up to the cut-off point. Pre-fix the provider
    // ran the partial string through `safeParseJson`, which surfaced
    // a `SyntaxError: Unterminated string in JSON at position N`
    // wrapped as a `SchemaValidationLlmError`. The framework retried
    // (schema_validation reason is retried by default) and hit the
    // same wall on attempt 2. Now the provider detects the
    // incomplete state and throws `TransientLlmError` with a tagged
    // message naming the cap reason — the message is the load-bearing
    // diagnostic for the dev reading server logs.
    function buildIncompleteResponse(args: {
        partialBody: string
        reason: string
        usage?: { inputTokens?: number; outputTokens?: number }
    }): Response {
        const usage = args.usage ?? { inputTokens: 100, outputTokens: 5 }
        // Wire-format JSON literal — `status` + `incomplete_details`
        // are the Responses-API fields that flag a truncated reply.
        const json = {
            id: "resp_incomplete",
            status: "incomplete",
            incomplete_details: { reason: args.reason },
            output: [
                {
                    type: "message",
                    role: "assistant",
                    content: [
                        {
                            type: "output_text",
                            text: args.partialBody,
                        },
                    ],
                },
            ],
            usage: {
                input_tokens: usage.inputTokens ?? 0,
                output_tokens: usage.outputTokens ?? 0,
            },
        }
        return new Response(JSON.stringify(json), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        })
    }

    it("throws TransientLlmError when the response is incomplete (max_output_tokens cap hit)", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildIncompleteResponse({
                // The partial body is what triggered the original
                // bug — an "Unterminated string in JSON at position
                // N" parse error in `safeParseJson`. We assert the
                // fix surfaces the *cap* as the error reason, not
                // the parse failure.
                partialBody: '{"segments":[{"segmentId":"s1","text":"It rai',
                reason: "max_output_tokens",
            })
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            stream: false,
            fetch: asFetch(fetchMock),
        })

        await expect(
            provider.respond({
                model: "gpt-5.4-mini",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toMatchObject({
            name: "TransientLlmError",
            message: expect.stringMatching(/incomplete/i) as unknown,
        })
    })

    it("includes the max_output_tokens reason + override-knob guidance in the error message", async () => {
        // Each call gets a fresh `Response` because the Response body
        // is single-use in undici; a second `.json()` on the same
        // instance throws "Body is unusable".
        const fetchMock: TFetchMock = vi.fn().mockImplementation(() =>
            Promise.resolve(
                buildIncompleteResponse({
                    partialBody: '{"answer":"par',
                    reason: "max_output_tokens",
                })
            )
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            stream: false,
            fetch: asFetch(fetchMock),
        })

        const err: unknown = await provider
            .respond({
                model: "gpt-5.4-mini",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
            .catch((e: unknown) => e)
        if (!(err instanceof Error)) {
            throw new Error("expected provider.respond to throw")
        }
        // Reason word verbatim from the envelope:
        expect(err.message).toMatch(/max_output_tokens/)
        // Actionable next-step: points at the stage-level override knob.
        expect(err.message).toMatch(/maxOutputTokens/)
    })

    it("throws NonRetryableLlmError on incomplete with reason: content_filter (no wasted retry)", async () => {
        // **Regression for the v1.3.1 P2 fold (post-validation).**
        // OpenAI's content policy refusing the output is deterministic
        // — the same prompt + the same input will refuse again. Pre-
        // fold the provider returned `TransientLlmError` for any
        // `status: "incomplete"` envelope, so the framework's default
        // retry policy burned a second API call only to hit the same
        // refusal. The classification split routes `content_filter`
        // to `NonRetryableLlmError` so the failure surfaces on the
        // first attempt with a clean message.
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildIncompleteResponse({
                partialBody: "",
                reason: "content_filter",
            })
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            stream: false,
            fetch: asFetch(fetchMock),
        })

        await expect(
            provider.respond({
                model: "gpt-5.4-mini",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
        ).rejects.toMatchObject({
            name: "NonRetryableLlmError",
        })
    })

    it("content_filter error message names the policy refusal + says retrying won't help", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildIncompleteResponse({
                partialBody: "",
                reason: "content_filter",
            })
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            stream: false,
            fetch: asFetch(fetchMock),
        })

        const err: unknown = await provider
            .respond({
                model: "gpt-5.4-mini",
                systemPrompt: "sys",
                userMessage: "usr",
                outputSchema: simpleSchema,
            })
            .catch((e: unknown) => e)
        if (!(err instanceof Error)) {
            throw new Error("expected provider.respond to throw")
        }
        expect(err.message).toMatch(/content_filter/)
        expect(err.message).toMatch(/content policy/i)
        expect(err.message).toMatch(/[Rr]etry/)
    })

    it("falls back to TransientLlmError + warns on an unrecognized incomplete reason", async () => {
        // For a reason value we don't recognize, the conservative
        // default is `TransientLlmError` (treat it as retryable, we
        // can't prove it's deterministic) plus a `console.warn` so
        // the new value lands on operators' radar.
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            buildIncompleteResponse({
                partialBody: '{"answer":"hi"',
                reason: "future_unknown_reason",
            })
        )
        const provider = createOpenAiResponsesProvider({
            apiKey: "sk-test",
            stream: false,
            fetch: asFetch(fetchMock),
        })

        // Capture console.warn via a plain function swap rather than
        // `vi.spyOn` — keeps the lint-strict types happy.
        const original = console.warn as (...args: unknown[]) => void
        const warns: string[] = []
        console.warn = ((...args: unknown[]) => {
            const first = args[0]
            warns.push(typeof first === "string" ? first : String(first))
        }) as (...args: unknown[]) => void
        try {
            await expect(
                provider.respond({
                    model: "gpt-5.4-mini",
                    systemPrompt: "sys",
                    userMessage: "usr",
                    outputSchema: simpleSchema,
                })
            ).rejects.toMatchObject({ name: "TransientLlmError" })
        } finally {
            console.warn = original
        }
        // The warn line names the unrecognized reason so operators
        // see the new value without opting into debug logging.
        expect(
            warns.some((line) => line.includes("future_unknown_reason"))
        ).toBe(true)
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

// -- SSE streaming helpers ------------------------------------------

function sseResponse(events: { type: string; response: unknown }[]): Response {
    const body = events
        .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join("")
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(body))
            controller.close()
        },
    })
    return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    })
}

function sseResponseChunked(
    events: { type: string; response: unknown }[],
    splitAt: number
): Response {
    const full = events
        .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
        .join("")
    const enc = new TextEncoder().encode(full)
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(enc.slice(0, splitAt))
            controller.enqueue(enc.slice(splitAt))
            controller.close()
        },
    })
    return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    })
}

// -- background-mode helpers ----------------------------------------

function jsonResponse(payload: unknown, status = 200): Response {
    return new Response(JSON.stringify(payload), { status })
}

function abortLikeError(): Error {
    // Mimics what a real fetch rejects with when its signal aborts
    // mid-request, so the mock exercises the in-flight-poll cancel path.
    const e = new Error("aborted")
    e.name = "AbortError"
    return e
}

describe("OpenAI provider — background mode (Level 1c)", () => {
    it("submits background+store, polls to completed, returns parsed output", async () => {
        const calls: { url: string; method: string; body?: unknown }[] = []
        let getCount = 0
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundMode: true,
            backgroundPollIntervalMs: 1,
            fetch: (url, init) => {
                const method = init.method ?? "GET"
                calls.push({
                    url,
                    method,
                    body: init.body
                        ? JSON.parse(init.body as string)
                        : undefined,
                })
                if (method === "POST") {
                    return Promise.resolve(
                        jsonResponse({ id: "resp_bg", status: "queued" })
                    )
                }
                getCount += 1
                if (getCount === 1) {
                    return Promise.resolve(
                        jsonResponse({ id: "resp_bg", status: "in_progress" })
                    )
                }
                return Promise.resolve(
                    jsonResponse({
                        id: "resp_bg",
                        status: "completed",
                        output: [
                            {
                                type: "message",
                                content: [
                                    {
                                        type: "output_text",
                                        text: JSON.stringify({ answer: "bg" }),
                                    },
                                ],
                            },
                        ],
                        usage: { input_tokens: 5, output_tokens: 2 },
                    })
                )
            },
        })

        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(res.output).toEqual({ answer: "bg" })
        const submit = calls.find((c) => c.method === "POST")
        expect(submit?.body).toMatchObject({ background: true, store: true })
        expect(submit?.body).not.toHaveProperty("stream")
        expect(calls.filter((c) => c.method === "GET").length).toBe(2)
        expect(calls.some((c) => c.url.endsWith("/resp_bg"))).toBe(true)
    })

    it("returns immediately when submit comes back already terminal (fast-path, zero poll GETs)", async () => {
        const calls: { url: string; method: string }[] = []
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundMode: true,
            backgroundPollIntervalMs: 1,
            fetch: (url, init) => {
                const method = init.method ?? "GET"
                calls.push({ url, method })
                return Promise.resolve(
                    jsonResponse({
                        id: "resp_fp",
                        status: "completed",
                        output: [
                            {
                                type: "message",
                                content: [
                                    {
                                        type: "output_text",
                                        text: JSON.stringify({ answer: "fp" }),
                                    },
                                ],
                            },
                        ],
                        usage: { input_tokens: 1, output_tokens: 1 },
                    })
                )
            },
        })

        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(res.output).toEqual({ answer: "fp" })
        expect(calls.filter((c) => c.method === "GET").length).toBe(0)
    })

    it("rejects backgroundMode with tools as NonRetryableLlmError", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundMode: true,
            fetch: () => Promise.reject(new Error("should not be called")),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                tools: [
                    {
                        kind: "function",
                        name: "f",
                        description: "d",
                        parameters: simpleSchema,
                        handler: () => Promise.resolve("x"),
                    },
                ],
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })

    it("cancels the background response when abort lands mid-poll", async () => {
        const calls: { url: string; method: string }[] = []
        const controller = new AbortController()
        let aborted = false
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundMode: true,
            backgroundPollIntervalMs: 5,
            fetch: (url, init) => {
                const method = init.method ?? "GET"
                calls.push({ url, method })
                if (method === "POST" && url.endsWith("/cancel")) {
                    return Promise.resolve(
                        jsonResponse({ id: "resp_c", status: "cancelled" })
                    )
                }
                if (method === "POST") {
                    return Promise.resolve(
                        jsonResponse({ id: "resp_c", status: "queued" })
                    )
                }
                // First GET: abort lands while this poll is in flight, so
                // a faithful fetch rejects the in-flight request with an
                // AbortError. runBackground must catch that and still
                // issue the cancel POST before re-throwing.
                if (!aborted) {
                    aborted = true
                    controller.abort()
                    return Promise.reject(abortLikeError())
                }
                return Promise.reject(abortLikeError())
            },
        })

        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: "AbortError" })
        expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(true)
    })

    it("maps a terminal background failed status to NonRetryableLlmError", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundMode: true,
            backgroundPollIntervalMs: 1,
            fetch: (_url, init) =>
                Promise.resolve(
                    (init.method ?? "GET") === "POST"
                        ? jsonResponse({ id: "resp_bf", status: "queued" })
                        : jsonResponse({
                              id: "resp_bf",
                              status: "failed",
                              error: { code: "server_error", message: "nope" },
                          })
                ),
        })
        const err: unknown = await provider
            .respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
            .catch((e: unknown) => e)
        expect(err).toBeInstanceOf(NonRetryableLlmError)
        // The terminal `failed` envelope's `error.message` detail must
        // survive routing into the thrown error's message.
        expect(err).toMatchObject({
            message: expect.stringContaining("nope") as unknown,
        })
    })
})

describe("OpenAI provider — contract parity across modes", () => {
    const completedPayload = {
        id: "resp_x",
        status: "completed",
        output: [
            {
                type: "message",
                content: [
                    {
                        type: "output_text",
                        text: JSON.stringify({ answer: "same" }),
                    },
                ],
            },
        ],
        usage: { input_tokens: 8, output_tokens: 4 },
    }

    it("returns the same output + tokenUsage for blocking, streaming, and background", async () => {
        const blocking = createOpenAiResponsesProvider({
            apiKey: "k",
            stream: false,
            fetch: () => Promise.resolve(jsonResponse(completedPayload)),
        })
        const streaming = createOpenAiResponsesProvider({
            apiKey: "k",
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.completed",
                            response: completedPayload,
                        },
                    ])
                ),
        })
        const background = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundMode: true,
            backgroundPollIntervalMs: 1,
            fetch: (_url, init) =>
                Promise.resolve(
                    (init.method ?? "GET") === "POST"
                        ? jsonResponse({ id: "resp_x", status: "queued" })
                        : jsonResponse(completedPayload)
                ),
        })

        const req = {
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        }
        const [a, b, c] = await Promise.all([
            blocking.respond(req),
            streaming.respond(req),
            background.respond(req),
        ])
        expect(a.output).toEqual({ answer: "same" })
        expect(b.output).toEqual(a.output)
        expect(c.output).toEqual(a.output)
        expect(b.tokenUsage).toEqual(a.tokenUsage)
        expect(c.tokenUsage).toEqual(a.tokenUsage)
    })
})

describe("OpenAI provider — streaming (Level 1b)", () => {
    it("reconstructs the terminal envelope from SSE and returns the parsed output", async () => {
        const captured: { url: string; init: RequestInit }[] = []
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            fetch: (url, init) => {
                captured.push({ url, init })
                return Promise.resolve(
                    sseResponse([
                        {
                            type: "response.completed",
                            response: {
                                id: "resp_1",
                                status: "completed",
                                output: [
                                    {
                                        type: "message",
                                        content: [
                                            {
                                                type: "output_text",
                                                text: JSON.stringify({
                                                    answer: "streamed",
                                                }),
                                            },
                                        ],
                                    },
                                ],
                                usage: {
                                    input_tokens: 11,
                                    output_tokens: 3,
                                },
                            },
                        },
                    ])
                )
            },
        })

        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(res.output).toEqual({ answer: "streamed" })
        expect(res.tokenUsage).toEqual({ input: 11, output: 3 })
        const sentBody = JSON.parse(captured[0].init.body as string) as {
            stream?: boolean
        }
        expect(sentBody.stream).toBe(true)
    })

    it("throws TransientLlmError when the stream ends without a terminal event", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.output_text.delta",
                            response: { delta: "partial" },
                        },
                    ])
                ),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("restores the blocking path when stream is false", async () => {
        const captured: { init: RequestInit }[] = []
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            stream: false,
            fetch: (_url, init) => {
                captured.push({ init })
                return Promise.resolve(
                    new Response(
                        JSON.stringify({
                            id: "resp_b",
                            status: "completed",
                            output: [
                                {
                                    type: "message",
                                    content: [
                                        {
                                            type: "output_text",
                                            text: JSON.stringify({
                                                answer: "blk",
                                            }),
                                        },
                                    ],
                                },
                            ],
                            usage: { input_tokens: 1, output_tokens: 1 },
                        }),
                        { status: 200 }
                    )
                )
            },
        })
        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(res.output).toEqual({ answer: "blk" })
        const sentBody = JSON.parse(captured[0].init.body as string) as {
            stream?: boolean
        }
        expect(sentBody.stream).toBeUndefined()
    })

    it("maps a terminal response.failed event to NonRetryableLlmError", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.failed",
                            response: {
                                id: "resp_f",
                                status: "failed",
                                error: {
                                    code: "server_error",
                                    message: "boom",
                                },
                            },
                        },
                    ])
                ),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })

    it("reconstructs a terminal envelope split across read() chunks", async () => {
        const completed = {
            type: "response.completed",
            response: {
                id: "resp_split",
                status: "completed",
                output: [
                    {
                        type: "message",
                        content: [
                            {
                                type: "output_text",
                                text: JSON.stringify({ answer: "split" }),
                            },
                        ],
                    },
                ],
                usage: { input_tokens: 2, output_tokens: 1 },
            },
        }
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            // split mid-frame so the buffering path is exercised
            fetch: () => Promise.resolve(sseResponseChunked([completed], 40)),
        })
        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(res.output).toEqual({ answer: "split" })
    })
})

// -- C-1: backgroundStreamMode tests ------------------------------------

describe("OpenAI provider — backgroundStreamMode (background + live SSE)", () => {
    const completedSsePayload = {
        id: "resp_bs1",
        status: "completed",
        output: [
            {
                type: "message",
                content: [
                    {
                        type: "output_text",
                        text: JSON.stringify({ answer: "bgstream" }),
                    },
                ],
            },
        ],
        usage: { input_tokens: 6, output_tokens: 3 },
    }

    it("submits with background:true, stream:true, store:true and reads SSE to completion", async () => {
        const captured: { body: unknown }[] = []
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: (_url, init) => {
                if (init.method === "POST") {
                    captured.push({
                        body: JSON.parse(init.body as string),
                    })
                    return Promise.resolve(
                        sseResponse([
                            {
                                type: "response.completed",
                                response: completedSsePayload,
                            },
                        ])
                    )
                }
                return Promise.reject(new Error("unexpected GET"))
            },
        })

        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(res.output).toEqual({ answer: "bgstream" })
        expect(res.rawResponseId).toBe("resp_bs1")
        expect(res.tokenUsage).toEqual({ input: 6, output: 3 })
        expect(captured).toHaveLength(1)
        expect(captured[0].body).toMatchObject({
            background: true,
            stream: true,
            store: true,
        })
    })

    it("throws TransientLlmError on connection drop (no terminal SSE event), leaving the response retrievable server-side", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.output_text.delta",
                            response: { delta: "partial" },
                        },
                    ])
                ),
        })

        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("rejects backgroundStreamMode with tools as NonRetryableLlmError", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: () => Promise.reject(new Error("should not be called")),
        })
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                tools: [
                    {
                        kind: "function",
                        name: "f",
                        description: "d",
                        parameters: simpleSchema,
                        handler: () => Promise.resolve("x"),
                    },
                ],
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })

    it("backgroundStreamMode takes priority over backgroundMode when both are set", async () => {
        const captured: { body: unknown }[] = []
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            backgroundMode: true,
            fetch: (_url, init) => {
                if (init.method === "POST") {
                    captured.push({ body: JSON.parse(init.body as string) })
                    return Promise.resolve(
                        sseResponse([
                            {
                                type: "response.completed",
                                response: completedSsePayload,
                            },
                        ])
                    )
                }
                return Promise.reject(new Error("unexpected GET in poll path"))
            },
        })

        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        // Only one POST (the stream submit), no GET polls — confirms
        // the backgroundStream branch ran, not the poll-only branch.
        expect(captured).toHaveLength(1)
        expect(captured[0].body).toMatchObject({
            background: true,
            stream: true,
        })
    })

    it("returns rawResponseId from the terminal SSE envelope", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.completed",
                            response: {
                                ...completedSsePayload,
                                id: "resp_id_check",
                            },
                        },
                    ])
                ),
        })

        const res = await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(res.rawResponseId).toBe("resp_id_check")
    })

    it("fires onResponseCreated with the id MID-FLIGHT — before respond() resolves", async () => {
        // A faithful background-stream: the first SSE event is
        // `response.created` (carrying the id), then the stream PAUSES
        // (mimicking a long in-flight generation) before the terminal
        // event arrives. We assert the id callback fired with the id
        // while respond() is still pending — i.e. the id is available
        // mid-flight, the load-bearing guarantee for crash recovery.

        // A gate the test releases to deliver the terminal event.
        let releaseTerminal: () => void = () => undefined
        const terminalGate = new Promise<void>((resolve) => {
            releaseTerminal = resolve
        })

        const createdEvent = `event: response.created\ndata: ${JSON.stringify({
            type: "response.created",
            response: { id: "resp_midflight", status: "in_progress" },
        })}\n\n`
        const terminalEvent = `event: response.completed\ndata: ${JSON.stringify(
            {
                type: "response.completed",
                response: {
                    id: "resp_midflight",
                    status: "completed",
                    output: [
                        {
                            type: "message",
                            content: [
                                {
                                    type: "output_text",
                                    text: JSON.stringify({ answer: "late" }),
                                },
                            ],
                        },
                    ],
                    usage: { input_tokens: 1, output_tokens: 1 },
                },
            }
        )}\n\n`

        const pausingStream = new ReadableStream<Uint8Array>({
            async start(controller) {
                // Deliver the created event immediately.
                controller.enqueue(new TextEncoder().encode(createdEvent))
                // Pause until the test releases the gate, then deliver
                // the terminal event and close.
                await terminalGate
                controller.enqueue(new TextEncoder().encode(terminalEvent))
                controller.close()
            },
        })

        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: () =>
                Promise.resolve(
                    new Response(pausingStream, {
                        status: 200,
                        headers: { "Content-Type": "text/event-stream" },
                    })
                ),
        })

        const observedIds: string[] = []
        let resolvedBeforeCallback = false
        const respondPromise = provider
            .respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                onResponseCreated: (id) => {
                    // If respond() had already resolved, the callback is
                    // not mid-flight — flag the failure condition.
                    if (resolvedBeforeCallback) {
                        throw new Error(
                            "onResponseCreated fired after respond() resolved"
                        )
                    }
                    observedIds.push(id)
                },
            })
            .then((r) => {
                resolvedBeforeCallback = true
                return r
            })

        // Give the stream-start microtasks a chance to run and deliver
        // the created event WITHOUT releasing the terminal gate.
        await new Promise((resolve) => setTimeout(resolve, 10))

        // The id must already be observable while respond() is pending.
        expect(observedIds).toEqual(["resp_midflight"])
        expect(resolvedBeforeCallback).toBe(false)

        // Now release the terminal event and let respond() finish.
        releaseTerminal()
        const res = await respondPromise
        expect(res.output).toEqual({ answer: "late" })
        expect(res.rawResponseId).toBe("resp_midflight")
        // The callback fired exactly once.
        expect(observedIds).toEqual(["resp_midflight"])
    })

    it("fires onResponseCreated at most once even across multiple created-like events", async () => {
        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.created",
                            response: {
                                id: "resp_once",
                                status: "in_progress",
                            },
                        },
                        {
                            type: "response.created",
                            response: {
                                id: "resp_once_dup",
                                status: "in_progress",
                            },
                        },
                        {
                            type: "response.completed",
                            response: {
                                ...completedSsePayload,
                                id: "resp_once",
                            },
                        },
                    ])
                ),
        })

        const observedIds: string[] = []
        await provider.respond({
            model: "gpt-5.4",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            onResponseCreated: (id) => observedIds.push(id),
        })

        // Only the FIRST created event surfaces an id; later ones ignored.
        expect(observedIds).toEqual(["resp_once"])
    })
})

// -- C-2: stage:llm-response-created event + rawResponseId on stage:llm-call ---

describe("llmStage — stage:llm-response-created event and rawResponseId propagation", () => {
    // We need executePipeline to test event emission from llmStage.
    // Import from the lib index.
    it("emits stage:llm-response-created before stage:llm-call when provider returns rawResponseId", async () => {
        // Import the pipeline framework inline for this test block.
        const { executePipeline, llmStage } =
            await import("../../../src/lib/pipelines/index.js")
        const Type = (await import("typebox")).default

        const outputSchema = Type.Object({ value: Type.Number() })
        const events: import("../../../src/lib/pipelines/types.js").TPipelineEvent[] =
            []

        // Mock LLM that returns a rawResponseId.
        const llm = {
            respond: <T>() =>
                Promise.resolve({
                    output: { value: 42 } as unknown as T,
                    tokenUsage: { input: 5, output: 5 },
                    rawResponseId: "resp_test_event",
                }),
        }

        const stage = llmStage<{ value: number }>({
            id: "ev-stage",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!-- stage-id: ev-stage --> sys",
                user: "usr",
            }),
        })

        const pipeline = {
            id: "ev-pipeline",
            version: "1.0.0",
            inputSchema: Type.Object({}),
            outputSchema,
            stages: [stage],
            finalize: {
                dependsOn: ["ev-stage"],
                run: (
                    ctx: import("../../../src/lib/pipelines/types.js").TStageContext
                ) => ctx.get<{ value: number }>("ev-stage") ?? { value: -1 },
            },
        }

        await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )

        const responseCreatedEvents = events.filter(
            (e) => e.kind === "stage:llm-response-created"
        )
        expect(responseCreatedEvents).toHaveLength(1)
        const rcEvent = responseCreatedEvents[0]
        if (rcEvent.kind !== "stage:llm-response-created") {
            throw new Error("expected stage:llm-response-created event")
        }
        expect(rcEvent.stageId).toBe("ev-stage")
        expect(rcEvent.attempt).toBe(1)
        expect(rcEvent.responseId).toBe("resp_test_event")

        // stage:llm-response-created must come BEFORE stage:llm-call.
        const rcIdx = events.indexOf(rcEvent)
        const llmCallIdx = events.findIndex(
            (e) => e.kind === "stage:llm-call" && e.stageId === "ev-stage"
        )
        expect(rcIdx).toBeGreaterThanOrEqual(0)
        expect(llmCallIdx).toBeGreaterThan(rcIdx)

        // stage:llm-call must carry rawResponseId.
        const llmCallEvent = events[llmCallIdx]
        if (llmCallEvent.kind !== "stage:llm-call") {
            throw new Error("expected stage:llm-call event")
        }
        expect(llmCallEvent.rawResponseId).toBe("resp_test_event")
    })

    it("does not emit stage:llm-response-created when provider returns no rawResponseId", async () => {
        const { executePipeline, llmStage } =
            await import("../../../src/lib/pipelines/index.js")
        const Type = (await import("typebox")).default

        const outputSchema = Type.Object({ value: Type.Number() })
        const events: import("../../../src/lib/pipelines/types.js").TPipelineEvent[] =
            []

        const llm = {
            respond: <T>() =>
                Promise.resolve({
                    output: { value: 7 } as unknown as T,
                    tokenUsage: { input: 1, output: 1 },
                    // no rawResponseId
                }),
        }

        const stage = llmStage<{ value: number }>({
            id: "no-id-stage",
            dependsOn: [],
            outputSchema,
            model: "mock",
            buildPrompt: () => ({
                system: "<!-- stage-id: no-id-stage --> sys",
                user: "usr",
            }),
        })

        const pipeline = {
            id: "no-id-pipeline",
            version: "1.0.0",
            inputSchema: Type.Object({}),
            outputSchema,
            stages: [stage],
            finalize: {
                dependsOn: ["no-id-stage"],
                run: (
                    ctx: import("../../../src/lib/pipelines/types.js").TStageContext
                ) => ctx.get<{ value: number }>("no-id-stage") ?? { value: -1 },
            },
        }

        await executePipeline(
            pipeline,
            {},
            { llm, onEvent: (e) => events.push(e) }
        )

        const responseCreatedEvents = events.filter(
            (e) => e.kind === "stage:llm-response-created"
        )
        expect(responseCreatedEvents).toHaveLength(0)

        // stage:llm-call must have no rawResponseId.
        const llmCallEvent = events.find((e) => e.kind === "stage:llm-call")
        if (llmCallEvent?.kind !== "stage:llm-call") {
            throw new Error("expected stage:llm-call event")
        }
        expect(llmCallEvent.rawResponseId).toBeUndefined()
    })

    it("emits stage:llm-response-created MID-CALL — observable before the stage's LLM call resolves (background-stream)", async () => {
        // Acceptance test for the load-bearing mid-flight guarantee:
        // wire the REAL OpenAI provider (background-stream) into
        // executePipeline with a stream that delivers `response.created`
        // then pauses before the terminal event. Assert
        // `stage:llm-response-created` (carrying the id) is observed
        // while the stage's call is still in flight — NOT only at
        // completion. This is the property that lets a crashed mid-call
        // stage be recovered from the upstream's stored response.
        const { executePipeline, llmStage } =
            await import("../../../src/lib/pipelines/index.js")
        const Type = (await import("typebox")).default

        const outputSchema = Type.Object({ answer: Type.String() })

        let releaseTerminal: () => void = () => undefined
        const terminalGate = new Promise<void>((resolve) => {
            releaseTerminal = resolve
        })

        const createdFrame = `event: response.created\ndata: ${JSON.stringify({
            type: "response.created",
            response: { id: "resp_pipeline_midcall", status: "in_progress" },
        })}\n\n`
        const terminalFrame = `event: response.completed\ndata: ${JSON.stringify(
            {
                type: "response.completed",
                response: {
                    id: "resp_pipeline_midcall",
                    status: "completed",
                    output: [
                        {
                            type: "message",
                            content: [
                                {
                                    type: "output_text",
                                    text: JSON.stringify({ answer: "done" }),
                                },
                            ],
                        },
                    ],
                    usage: { input_tokens: 2, output_tokens: 1 },
                },
            }
        )}\n\n`

        const pausingStream = new ReadableStream<Uint8Array>({
            async start(controller) {
                controller.enqueue(new TextEncoder().encode(createdFrame))
                await terminalGate
                controller.enqueue(new TextEncoder().encode(terminalFrame))
                controller.close()
            },
        })

        const provider = createOpenAiResponsesProvider({
            apiKey: "k",
            backgroundStreamMode: true,
            fetch: () =>
                Promise.resolve(
                    new Response(pausingStream, {
                        status: 200,
                        headers: { "Content-Type": "text/event-stream" },
                    })
                ),
        })

        const events: import("../../../src/lib/pipelines/types.js").TPipelineEvent[] =
            []
        const stage = llmStage<{ answer: string }>({
            id: "mc-stage",
            dependsOn: [],
            outputSchema,
            model: "gpt-5.4",
            buildPrompt: () => ({
                system: "<!-- stage-id: mc-stage --> sys",
                user: "usr",
            }),
        })
        const pipeline = {
            id: "mc-pipeline",
            version: "1.0.0",
            inputSchema: Type.Object({}),
            outputSchema,
            stages: [stage],
            finalize: {
                dependsOn: ["mc-stage"],
                run: (
                    ctx: import("../../../src/lib/pipelines/types.js").TStageContext
                ) => ctx.get<{ answer: string }>("mc-stage") ?? { answer: "" },
            },
        }

        const runPromise = executePipeline(
            pipeline,
            {},
            {
                llm: provider,
                onEvent: (e) => events.push(e),
            }
        )

        // Let the stream-start microtasks deliver `response.created`
        // WITHOUT releasing the terminal gate (the call is still
        // in flight).
        await new Promise((resolve) => setTimeout(resolve, 10))

        // The id event must already be observable mid-call.
        const midCall = events.filter(
            (e) => e.kind === "stage:llm-response-created"
        )
        expect(midCall).toHaveLength(1)
        const evt = midCall[0]
        if (evt.kind !== "stage:llm-response-created") {
            throw new Error("expected stage:llm-response-created event")
        }
        expect(evt.responseId).toBe("resp_pipeline_midcall")
        // The stage's LLM call has NOT completed yet — no stage:llm-call.
        expect(
            events.some(
                (e) => e.kind === "stage:llm-call" && e.stageId === "mc-stage"
            )
        ).toBe(false)

        // Release the terminal event and finish the run.
        releaseTerminal()
        const result = await runPromise
        expect(result.output).toEqual({ answer: "done" })

        // After completion, stage:llm-call fired exactly once and the
        // id event was NOT duplicated.
        const finalCreated = events.filter(
            (e) => e.kind === "stage:llm-response-created"
        )
        expect(finalCreated).toHaveLength(1)
        const llmCall = events.find(
            (e) => e.kind === "stage:llm-call" && e.stageId === "mc-stage"
        )
        if (llmCall?.kind !== "stage:llm-call") {
            throw new Error("expected stage:llm-call event")
        }
        expect(llmCall.rawResponseId).toBe("resp_pipeline_midcall")
        // Ordering still holds: created precedes call.
        expect(events.indexOf(evt)).toBeLessThan(events.indexOf(llmCall))
    })
})

// -- C-3: retrieveResponse + ResponseNotFoundError ----------------------

describe("retrieveResponse", () => {
    it("returns status, output, tokenUsage, and rawResponseId for a completed response", async () => {
        const completedEnvelope = {
            id: "resp_ret1",
            status: "completed",
            output: [
                {
                    type: "message",
                    content: [
                        {
                            type: "output_text",
                            text: "hello world",
                        },
                    ],
                },
            ],
            usage: { input_tokens: 4, output_tokens: 2 },
        }
        const res = await retrieveResponse("resp_ret1", {
            apiKey: "k",
            fetch: () => Promise.resolve(jsonResponse(completedEnvelope)),
        })

        expect(res.status).toBe("completed")
        expect(res.output).toBe("hello world")
        expect(res.tokenUsage).toEqual({ input: 4, output: 2 })
        expect(res.rawResponseId).toBe("resp_ret1")
    })

    it("returns status in_progress with no output or tokenUsage for a non-terminal response", async () => {
        const inProgressEnvelope = {
            id: "resp_ret2",
            status: "in_progress",
        }
        const res = await retrieveResponse("resp_ret2", {
            apiKey: "k",
            fetch: () => Promise.resolve(jsonResponse(inProgressEnvelope)),
        })

        expect(res.status).toBe("in_progress")
        expect(res.output).toBeUndefined()
        expect(res.tokenUsage).toBeUndefined()
        expect(res.rawResponseId).toBe("resp_ret2")
    })

    it("issues a GET request to the correct URL with bearer auth", async () => {
        const captured: { url: string; init: RequestInit }[] = []
        await retrieveResponse("resp_url_test", {
            apiKey: "sk-test",
            fetch: (url, init) => {
                captured.push({ url, init })
                return Promise.resolve(
                    jsonResponse({
                        id: "resp_url_test",
                        status: "queued",
                    })
                )
            },
        })

        expect(captured).toHaveLength(1)
        expect(captured[0].url).toBe(
            "https://api.openai.com/v1/responses/resp_url_test"
        )
        expect(captured[0].init.method).toBe("GET")
        const headers = captured[0].init.headers as Record<string, string>
        expect(headers.Authorization).toBe("Bearer sk-test")
    })

    it("throws ResponseNotFoundError on a 404 (retention window elapsed)", async () => {
        await expect(
            retrieveResponse("resp_gone", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(new Response("Not Found", { status: 404 })),
            })
        ).rejects.toBeInstanceOf(ResponseNotFoundError)
    })

    it("ResponseNotFoundError carries the response id", async () => {
        const err = await retrieveResponse("resp_aged_out", {
            apiKey: "k",
            fetch: () =>
                Promise.resolve(new Response("Not Found", { status: 404 })),
        }).catch((e: unknown) => e)

        if (!(err instanceof ResponseNotFoundError)) {
            throw new Error("expected ResponseNotFoundError")
        }
        expect(err.responseId).toBe("resp_aged_out")
    })

    it("ResponseNotFoundError is a NonRetryableLlmError subclass with no retryReason tag (fail-fast, behavior-preserving)", async () => {
        const err = await retrieveResponse("resp_classify", {
            apiKey: "k",
            fetch: () =>
                Promise.resolve(new Response("Not Found", { status: 404 })),
        }).catch((e: unknown) => e)

        // Extends NonRetryableLlmError → callers that instanceof-match
        // the base still match; the framework reads the (absent)
        // retryReason tag and fails fast exactly as a generic
        // NonRetryableLlmError did when a 404 surfaced mid-poll.
        expect(err).toBeInstanceOf(NonRetryableLlmError)
        expect(err).toBeInstanceOf(ResponseNotFoundError)
        expect((err as { retryReason?: unknown }).retryReason).toBeUndefined()
        expect((err as { status?: number }).status).toBe(404)
    })

    it("throws TransientLlmError on a 5xx", async () => {
        await expect(
            retrieveResponse("resp_5xx", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(
                        new Response("Internal Server Error", { status: 500 })
                    ),
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("respects a custom baseUrl", async () => {
        const captured: string[] = []
        await retrieveResponse("resp_custom", {
            apiKey: "k",
            baseUrl: "https://proxy.test/v1/responses",
            fetch: (url) => {
                captured.push(url)
                return Promise.resolve(
                    jsonResponse({ id: "resp_custom", status: "completed" })
                )
            },
        })

        expect(captured[0]).toBe("https://proxy.test/v1/responses/resp_custom")
    })
})

// -- reconnectStream (resume a dropped background response to completion) ---

describe("reconnectStream", () => {
    const completedReconnectPayload = {
        id: "resp_rc",
        status: "completed",
        output: [
            {
                type: "message",
                content: [
                    {
                        type: "output_text",
                        text: "reconnected output",
                    },
                ],
            },
        ],
        usage: { input_tokens: 3, output_tokens: 2 },
    }

    it("GETs with stream=true&starting_after, consumes the SSE to completion, and returns the TRetrievedResponse shape", async () => {
        const captured: { url: string; init: RequestInit }[] = []
        const res = await reconnectStream("resp_rc", {
            apiKey: "sk-test",
            fetch: (url, init) => {
                captured.push({ url, init })
                return Promise.resolve(
                    sseResponse([
                        {
                            type: "response.completed",
                            response: completedReconnectPayload,
                        },
                    ])
                )
            },
        })

        expect(res.status).toBe("completed")
        expect(res.output).toBe("reconnected output")
        expect(res.tokenUsage).toEqual({ input: 3, output: 2 })
        expect(res.rawResponseId).toBe("resp_rc")

        // Exactly one GET with stream=true & default starting_after=0.
        expect(captured).toHaveLength(1)
        expect(captured[0].url).toBe(
            "https://api.openai.com/v1/responses/resp_rc?stream=true&starting_after=0"
        )
        expect(captured[0].init.method).toBe("GET")
        const headers = captured[0].init.headers as Record<string, string>
        expect(headers.Authorization).toBe("Bearer sk-test")
    })

    it("passes an explicit startingAfter cursor through the query string", async () => {
        const captured: string[] = []
        await reconnectStream("resp_cursor", {
            apiKey: "k",
            startingAfter: 42,
            fetch: (url) => {
                captured.push(url)
                return Promise.resolve(
                    sseResponse([
                        {
                            type: "response.completed",
                            response: {
                                ...completedReconnectPayload,
                                id: "resp_cursor",
                            },
                        },
                    ])
                )
            },
        })

        expect(captured[0]).toBe(
            "https://api.openai.com/v1/responses/resp_cursor?stream=true&starting_after=42"
        )
    })

    it("throws ResponseNotFoundError on a 404 (aged out)", async () => {
        await expect(
            reconnectStream("resp_gone", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(new Response("Not Found", { status: 404 })),
            })
        ).rejects.toBeInstanceOf(ResponseNotFoundError)
    })

    it("throws TransientLlmError on a 5xx", async () => {
        await expect(
            reconnectStream("resp_5xx", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(
                        new Response("Internal Server Error", { status: 500 })
                    ),
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("throws TransientLlmError when the stream ends with no terminal event (a second drop mid-reconnect)", async () => {
        await expect(
            reconnectStream("resp_drop", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(
                        sseResponse([
                            {
                                type: "response.output_text.delta",
                                response: { delta: "partial" },
                            },
                        ])
                    ),
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("propagates an AbortError from the underlying fetch", async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(
            reconnectStream("resp_abort", {
                apiKey: "k",
                signal: controller.signal,
                fetch: (_url, init) => {
                    if (init.signal?.aborted) {
                        const err = new Error("aborted")
                        err.name = "AbortError"
                        return Promise.reject(err)
                    }
                    return Promise.resolve(
                        sseResponse([
                            {
                                type: "response.completed",
                                response: completedReconnectPayload,
                            },
                        ])
                    )
                },
            })
        ).rejects.toThrowError(/abort/i)
    })

    it("respects a custom baseUrl", async () => {
        const captured: string[] = []
        await reconnectStream("resp_custom", {
            apiKey: "k",
            baseUrl: "https://proxy.test/v1/responses",
            fetch: (url) => {
                captured.push(url)
                return Promise.resolve(
                    sseResponse([
                        {
                            type: "response.completed",
                            response: {
                                ...completedReconnectPayload,
                                id: "resp_custom",
                            },
                        },
                    ])
                )
            },
        })

        expect(captured[0]).toBe(
            "https://proxy.test/v1/responses/resp_custom?stream=true&starting_after=0"
        )
    })

    it("drives an initially in-progress stream to a terminal completed status (the disconnect-survival contract)", async () => {
        // Mirrors the real disconnect-survival path: the reconnect
        // stream replays from `response.created` (in_progress) and
        // continues to the terminal `response.completed`. The returned
        // status must be the TERMINAL one, not the intermediate
        // in_progress — proving reconnect consumes to completion.
        const res = await reconnectStream("resp_survive", {
            apiKey: "k",
            fetch: () =>
                Promise.resolve(
                    sseResponse([
                        {
                            type: "response.created",
                            response: {
                                id: "resp_survive",
                                status: "in_progress",
                            },
                        },
                        {
                            type: "response.completed",
                            response: {
                                ...completedReconnectPayload,
                                id: "resp_survive",
                            },
                        },
                    ])
                ),
        })

        expect(res.status).toBe("completed")
        expect(res.output).toBe("reconnected output")
        expect(res.rawResponseId).toBe("resp_survive")
    })
})

// -- cancelResponse (stop an in-flight background response) -------------

describe("cancelResponse", () => {
    it("POSTs to the /cancel path with bearer auth and maps the returned status", async () => {
        const captured: { url: string; init: RequestInit }[] = []
        const res = await cancelResponse("resp_cancel", {
            apiKey: "sk-test",
            fetch: (url, init) => {
                captured.push({ url, init })
                return Promise.resolve(
                    jsonResponse({ id: "resp_cancel", status: "cancelled" })
                )
            },
        })

        expect(res.status).toBe("cancelled")
        expect(res.rawResponseId).toBe("resp_cancel")

        expect(captured).toHaveLength(1)
        expect(captured[0].url).toBe(
            "https://api.openai.com/v1/responses/resp_cancel/cancel"
        )
        expect(captured[0].init.method).toBe("POST")
        const headers = captured[0].init.headers as Record<string, string>
        expect(headers.Authorization).toBe("Bearer sk-test")
    })

    it("surfaces output + tokenUsage when cancelling an already-completed response (idempotent — returns the final Response)", async () => {
        // Cancel is idempotent: cancelling an already-terminal response
        // just returns its final state. The mapping must still surface
        // output + tokenUsage from that terminal envelope.
        const res = await cancelResponse("resp_done", {
            apiKey: "k",
            fetch: () =>
                Promise.resolve(
                    jsonResponse({
                        id: "resp_done",
                        status: "completed",
                        output: [
                            {
                                type: "message",
                                content: [
                                    {
                                        type: "output_text",
                                        text: "already finished",
                                    },
                                ],
                            },
                        ],
                        usage: { input_tokens: 4, output_tokens: 2 },
                    })
                ),
        })

        expect(res.status).toBe("completed")
        expect(res.output).toBe("already finished")
        expect(res.tokenUsage).toEqual({ input: 4, output: 2 })
        expect(res.rawResponseId).toBe("resp_done")
    })

    it("throws ResponseNotFoundError on a 404 (aged out)", async () => {
        await expect(
            cancelResponse("resp_gone", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(new Response("Not Found", { status: 404 })),
            })
        ).rejects.toBeInstanceOf(ResponseNotFoundError)
    })

    it("throws TransientLlmError on a 5xx", async () => {
        await expect(
            cancelResponse("resp_5xx", {
                apiKey: "k",
                fetch: () =>
                    Promise.resolve(
                        new Response("Internal Server Error", { status: 500 })
                    ),
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })

    it("propagates an AbortError from the underlying fetch", async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(
            cancelResponse("resp_abort", {
                apiKey: "k",
                signal: controller.signal,
                fetch: (_url, init) => {
                    if (init.signal?.aborted) {
                        const err = new Error("aborted")
                        err.name = "AbortError"
                        return Promise.reject(err)
                    }
                    return Promise.resolve(
                        jsonResponse({ id: "resp_abort", status: "cancelled" })
                    )
                },
            })
        ).rejects.toThrowError(/abort/i)
    })

    it("respects a custom baseUrl", async () => {
        const captured: string[] = []
        await cancelResponse("resp_custom", {
            apiKey: "k",
            baseUrl: "https://proxy.test/v1/responses",
            fetch: (url) => {
                captured.push(url)
                return Promise.resolve(
                    jsonResponse({ id: "resp_custom", status: "cancelled" })
                )
            },
        })

        expect(captured[0]).toBe(
            "https://proxy.test/v1/responses/resp_custom/cancel"
        )
    })
})

// -- no-tools precondition for v2 ingestion stages ----------------------

describe("v2 ingestion pipeline — no-tools precondition", () => {
    it("every v2 LLM stage issues requests with no tools (background mode is safe for all stages)", async () => {
        // Instantiate the v2 pipeline and run a minimal input through
        // a spy LLM. Captures all `req.tools` values across every LLM
        // call and asserts they are all absent/empty — confirming the
        // background-mode no-tools precondition holds for this pipeline.
        const { createIngestionV2Pipeline } =
            await import("../../../src/extensions/argument-ingestion/v2-multi-stage.js")
        const { executePipeline } =
            await import("../../../src/lib/pipelines/index.js")
        const { basicsExtension } =
            await import("../../../src/extensions/argument-ingestion/shared/basics-extension.js")

        const toolsPerCall: (readonly unknown[] | undefined)[] = []

        // Spy LLM: records req.tools, returns the minimum valid output
        // for each stage by keying off the stage-id marker.
        const stageOutputs: Record<string, unknown> = {
            segmentation: {
                segments: [
                    {
                        segmentId: "s1",
                        text: "Test claim.",
                        span: { start: 0, end: 11 },
                    },
                ],
            },
            "claim-mention-extraction": {
                mentions: [
                    {
                        mentionId: "m1",
                        segmentId: "s1",
                        text: "Test claim.",
                        claimType: null,
                    },
                ],
            },
            "citation-source-detection": { citations: [] },
            "axiom-indicator-detection": { axiomIndicators: [] },
            "claim-canonicalization": {
                claims: [
                    {
                        claimId: "c1",
                        canonicalText: "Test claim.",
                        type: "premise",
                    },
                ],
            },
            "claim-type-classification": {
                classifications: [{ claimId: "c1", type: "premise" }],
            },
            "relation-extraction": { relations: [] },
            "conclusion-selection": {
                conclusionCandidates: [
                    { claimId: "c1", confidence: 1.0, rationale: "only claim" },
                ],
            },
        }

        const MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/

        const llm = {
            respond: (req: {
                tools?: readonly unknown[]
                systemPrompt: string
                signal?: AbortSignal
            }) => {
                toolsPerCall.push(req.tools)
                const match = MARKER.exec(req.systemPrompt)
                const stageId = match ? match[1] : null
                const output = stageId ? stageOutputs[stageId] : {}
                return Promise.resolve({
                    output: output ?? {},
                    tokenUsage: { input: 1, output: 1 },
                })
            },
        }

        const pipeline = createIngestionV2Pipeline(basicsExtension)
        // We don't care about the pipeline result, just that it ran.
        await executePipeline(
            pipeline,
            { text: "Test claim." },
            { llm: llm as import("../../../src/lib/llm/types.js").TLlmProvider }
        ).catch(() => {
            // Pipeline may fail due to minimal fixture data — that's fine.
            // We only assert on toolsPerCall below.
        })

        // Every LLM call must have no tools.
        for (const tools of toolsPerCall) {
            expect(
                tools === undefined ||
                    (Array.isArray(tools) && tools.length === 0)
            ).toBe(true)
        }
        // Confirm at least some LLM calls fired (pipeline ran non-trivially).
        expect(toolsPerCall.length).toBeGreaterThan(0)
    })
})

// -- submitBackgroundResponse ----------------------------------------

function buildSubmitEnvelope(args: { id: string; status: string }): Response {
    return new Response(JSON.stringify({ id: args.id, status: args.status }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

describe("submitBackgroundResponse", () => {
    const req = {
        model: "gpt-5.4",
        systemPrompt: "sys",
        userMessage: "u",
        outputSchema: simpleSchema,
    }

    it("returns { responseId, status } at submit WITHOUT issuing a poll GET", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildSubmitEnvelope({ id: "resp_bg_1", status: "queued" })
            )
        const result = await submitBackgroundResponse(req, {
            apiKey: "k",
            fetch: asFetch(fetchMock),
        })
        expect(result).toEqual({ responseId: "resp_bg_1", status: "queued" })
        // Exactly one HTTP call (the submit POST); no poll loop.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(init.method).toBe("POST")
        const body = JSON.parse(init.body as string) as {
            background?: boolean
            store?: boolean
        }
        expect(body.background).toBe(true)
        expect(body.store).toBe(true)
    })

    it("returns the terminal status on a terminal-on-submit envelope (no throw, no poll)", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildSubmitEnvelope({ id: "resp_bg_2", status: "completed" })
            )
        const result = await submitBackgroundResponse(req, {
            apiKey: "k",
            fetch: asFetch(fetchMock),
        })
        expect(result).toEqual({
            responseId: "resp_bg_2",
            status: "completed",
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("returns a cancelled terminal status without throwing (submit-only contract)", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildSubmitEnvelope({ id: "resp_bg_3", status: "cancelled" })
            )
        const result = await submitBackgroundResponse(req, {
            apiKey: "k",
            fetch: asFetch(fetchMock),
        })
        expect(result.status).toBe("cancelled")
        expect(result.responseId).toBe("resp_bg_3")
    })

    it("throws NonRetryableLlmError for a tool-bearing request (no-tools guard)", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(
                buildSubmitEnvelope({ id: "x", status: "queued" })
            )
        await expect(
            submitBackgroundResponse(
                {
                    ...req,
                    tools: [{ kind: "web_search" }],
                },
                { apiKey: "k", fetch: asFetch(fetchMock) }
            )
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it("throws TransientLlmError when the submit envelope carries no id", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ status: "queued" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        )
        await expect(
            submitBackgroundResponse(req, {
                apiKey: "k",
                fetch: asFetch(fetchMock),
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })
})

// -- retrieveResponse surfaces incompleteReason / errorMessage -------

describe("retrieveResponse — incompleteReason / errorMessage fields", () => {
    it("surfaces incomplete_details.reason as incompleteReason", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "resp_inc",
                    status: "incomplete",
                    incomplete_details: { reason: "max_output_tokens" },
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            )
        )
        const result = await retrieveResponse("resp_inc", {
            apiKey: "k",
            fetch: asFetch(fetchMock),
        })
        expect(result.status).toBe("incomplete")
        expect(result.incompleteReason).toBe("max_output_tokens")
        expect(result.errorMessage).toBeUndefined()
    })

    it("surfaces error.message as errorMessage for a failed response", async () => {
        const fetchMock: TFetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "resp_fail",
                    status: "failed",
                    error: {
                        message: "model exploded",
                        code: "server_error",
                    },
                }),
                {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }
            )
        )
        const result = await retrieveResponse("resp_fail", {
            apiKey: "k",
            fetch: asFetch(fetchMock),
        })
        expect(result.status).toBe("failed")
        expect(result.errorMessage).toBe("model exploded")
        expect(result.incompleteReason).toBeUndefined()
    })
})
