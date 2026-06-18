// Provider unit tests — exercise the chat-completions adapter through an
// injected `fetch` mock (no network, no server). Assert request shape,
// response parsing, structured-output `response_format`, tokenUsage
// mapping, error classification, the tools fail-fast, and abort
// propagation.

import { describe, it, expect, vi } from "vitest"
import Type from "typebox"
import { createChatCompletionsProvider } from "../../../src/extensions/chat-completions/provider.js"
import {
    NonRetryableLlmError,
    RateLimitLlmError,
    SchemaValidationLlmError,
    TransientLlmError,
} from "../../../src/extensions/chat-completions/errors.js"
import type { TChatCompletionsFetch } from "../../../src/extensions/chat-completions/types.js"

const simpleSchema = Type.Object({ answer: Type.String() })

type TFetchMock = ReturnType<typeof vi.fn>
function asFetch(mock: TFetchMock): TChatCompletionsFetch {
    return mock as unknown as TChatCompletionsFetch
}

function okResponse(
    body: unknown,
    usage?: { prompt?: number; completion?: number }
): Response {
    // Wire-format JSON literal — snake_case mirrors the chat-completions
    // payload.
    const json = {
        id: "chatcmpl-test",
        choices: [
            {
                message: { role: "assistant", content: JSON.stringify(body) },
                finish_reason: "stop",
            },
        ],
        usage: {
            prompt_tokens: usage?.prompt ?? 10,
            completion_tokens: usage?.completion ?? 5,
        },
    }
    return new Response(JSON.stringify(json), {
        status: 200,
        headers: { "Content-Type": "application/json" },
    })
}

function errResponse(status: number, message = "boom"): Response {
    return new Response(JSON.stringify({ error: { message } }), {
        status,
        headers: { "Content-Type": "application/json" },
    })
}

describe("createChatCompletionsProvider — request shape", () => {
    it("POSTs to {baseUrl}/chat/completions with bearer auth and the default base", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(okResponse({ answer: "hi" }))
        const provider = createChatCompletionsProvider({
            fetch: asFetch(fetchMock),
        })
        await provider.respond({
            model: "local-coder",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("http://127.0.0.1:46373/v1/chat/completions")
        expect(init.method).toBe("POST")
        const headers = init.headers as Record<string, string>
        expect(headers.Authorization).toMatch(/^Bearer /)
        expect(headers["Content-Type"]).toBe("application/json")
    })

    it("honors a custom baseUrl + apiKey", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(okResponse({ answer: "hi" }))
        const provider = createChatCompletionsProvider({
            baseUrl: "http://localhost:9999/v1",
            apiKey: "sk-x",
            fetch: asFetch(fetchMock),
        })
        await provider.respond({
            model: "local-coder",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe("http://localhost:9999/v1/chat/completions")
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        // The request model is what's sent (model comes from the request,
        // not the provider config).
        expect(body.model).toBe("local-coder")
        expect((init.headers as Record<string, string>).Authorization).toBe(
            "Bearer sk-x"
        )
    })

    it("encodes messages (system+user) and a response_format json_schema (lax converter output)", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(okResponse({ answer: "ok" }))
        const provider = createChatCompletionsProvider({
            fetch: asFetch(fetchMock),
        })
        await provider.respond({
            model: "local-coder",
            systemPrompt: "sys",
            userMessage: "usr",
            outputSchema: simpleSchema,
        })
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        const msgs = body.messages as { role: string }[]
        expect(msgs.map((m) => m.role)).toEqual(["system", "user"])
        const rf = body.response_format as {
            type: string
            json_schema: { schema: Record<string, unknown> }
        }
        expect(rf.type).toBe("json_schema")
        expect(rf.json_schema.schema).toMatchObject({
            type: "object",
            required: ["answer"],
        })
        // Lax converter: NO additionalProperties:false fold.
        expect(rf.json_schema.schema).not.toHaveProperty("additionalProperties")
    })

    it("maps maxOutputTokens → max_tokens (positive only; 0 omitted)", async () => {
        // A fresh Response per call — a Response body is a one-shot
        // stream, so the two respond() calls below cannot share one.
        const fetchMock: TFetchMock = vi
            .fn()
            .mockImplementation(() => Promise.resolve(okResponse({ answer: "ok" })))
        const provider = createChatCompletionsProvider({
            fetch: asFetch(fetchMock),
        })
        await provider.respond({
            model: "local-coder",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            maxOutputTokens: 4096,
        })
        expect(
            (JSON.parse(
                (fetchMock.mock.calls[0] as [string, RequestInit])[1]
                    .body as string
            ) as Record<string, unknown>).max_tokens
        ).toBe(4096)

        fetchMock.mockClear()
        await provider.respond({
            model: "local-coder",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            maxOutputTokens: 0,
        })
        expect(
            (JSON.parse(
                (fetchMock.mock.calls[0] as [string, RequestInit])[1]
                    .body as string
            ) as Record<string, unknown>).max_tokens
        ).toBeUndefined()
    })

    it("ignores reasoningEffort (no chat-completions analogue)", async () => {
        const fetchMock: TFetchMock = vi
            .fn()
            .mockResolvedValue(okResponse({ answer: "ok" }))
        const provider = createChatCompletionsProvider({
            fetch: asFetch(fetchMock),
        })
        await provider.respond({
            model: "local-coder",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
            reasoningEffort: "high",
        })
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(init.body as string).not.toMatch(/effort|reasoning/i)
    })
})

describe("createChatCompletionsProvider — response handling", () => {
    it("parses choices[0].message.content as JSON and returns the typed output", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(
                vi.fn().mockResolvedValue(okResponse({ answer: "42" }))
            ),
        })
        const result = await provider.respond({
            model: "local-coder",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(result.output).toEqual({ answer: "42" })
    })

    it("maps tokenUsage prompt_tokens→input, completion_tokens→output; rawResponseId undefined", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(
                vi
                    .fn()
                    .mockResolvedValue(
                        okResponse(
                            { answer: "ok" },
                            { prompt: 123, completion: 45 }
                        )
                    )
            ),
        })
        const result = await provider.respond({
            model: "local-coder",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(result.tokenUsage).toEqual({ input: 123, output: 45 })
        expect(result.rawResponseId).toBeUndefined()
    })

    it("throws SchemaValidationLlmError on non-JSON content", async () => {
        const bad = new Response(
            JSON.stringify({
                choices: [{ message: { content: "not json {{{" } }],
                usage: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        )
        const provider = createChatCompletionsProvider({
            fetch: asFetch(vi.fn().mockResolvedValue(bad)),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })

    it("throws SchemaValidationLlmError when no assistant content is present", async () => {
        const empty = new Response(
            JSON.stringify({
                choices: [{ message: { content: "" } }],
                usage: {},
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        )
        const provider = createChatCompletionsProvider({
            fetch: asFetch(vi.fn().mockResolvedValue(empty)),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(SchemaValidationLlmError)
    })
})

describe("createChatCompletionsProvider — error classification", () => {
    it("500 → TransientLlmError", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(vi.fn().mockResolvedValue(errResponse(500))),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })
    it("429 → RateLimitLlmError", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(vi.fn().mockResolvedValue(errResponse(429))),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(RateLimitLlmError)
    })
    it("400 → NonRetryableLlmError", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(vi.fn().mockResolvedValue(errResponse(400))),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })
    it("a thrown fetch failure → TransientLlmError", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(
                vi.fn().mockRejectedValue(new TypeError("fetch failed"))
            ),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(TransientLlmError)
    })
})

describe("createChatCompletionsProvider — tools + abort", () => {
    it("fails fast with NonRetryableLlmError when a request carries tools (structured-output only)", async () => {
        const provider = createChatCompletionsProvider({
            fetch: asFetch(
                vi.fn().mockResolvedValue(okResponse({ answer: "x" }))
            ),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                tools: [{ kind: "web_search" }],
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })

    it("short-circuits with an AbortError if the signal is already aborted", async () => {
        const controller = new AbortController()
        controller.abort()
        const fetchMock = vi.fn()
        const provider = createChatCompletionsProvider({
            fetch: asFetch(fetchMock),
        })
        await expect(
            provider.respond({
                model: "local-coder",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
                signal: controller.signal,
            })
        ).rejects.toMatchObject({ name: "AbortError" })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})
