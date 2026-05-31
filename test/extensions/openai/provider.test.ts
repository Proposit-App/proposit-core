// Provider unit tests — exercise the OpenAI Responses-API adapter
// through an injected `fetch` mock. The tests assert request shape,
// response parsing, the tool-call agent loop, error classification,
// and abort propagation. No real network calls.

import { describe, it, expect, vi } from "vitest"
import Type from "typebox"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/provider.js"
import {
    NonRetryableLlmError,
    QuotaExhaustedLlmError,
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
        // (per the Responses-API conversation-history contract — slice
        // 1B.1 reviewer fold P1 #1).
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
        // Slice 1B.1 reviewer fold P1 #1 (multi-call assertion).
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
        // the framework surfaces immediately. Slice 1B.1 reviewer
        // fold P2 #1.
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
    // RateLimitLlmError path. CR 2026-05-27.

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
