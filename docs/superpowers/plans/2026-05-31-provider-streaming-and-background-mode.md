# Provider Streaming + OpenAI Background Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both concrete `TLlmProvider`s stream from the model (Ollama always, OpenAI by default) and give the OpenAI provider an opt-in submit-then-poll background mode — eliminating the held-connection timeout class — without changing `respond()`'s external contract or touching `src/lib/`.

**Architecture:** All changes are provider-local inside `src/extensions/{ollama,openai}/`. The Ollama provider switches its single `chat()` call to `stream: true` and synthesizes one response from the accumulated chunks. The OpenAI provider factors its HTTP step into a single `fetchResponseEnvelope()` that returns a `TOpenAiResponsesEnvelope` via one of three modes (blocking / SSE-streaming / background submit-then-poll); the existing envelope-processing logic in the agent loop is reused verbatim. `respond()` keeps its return shape, `tokenUsage`, error taxonomy, and `AbortSignal` → `skipped` behavior.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), TypeBox, Vitest. `ollama` + `undici` are optional peers (Ollama side); OpenAI side uses raw `fetch`.

---

## File Structure

**Ollama (Level 1a):**
- Modify `src/extensions/ollama/types.ts` — widen `TOllamaChatRequest.stream` to `boolean`; add `done?` to `TOllamaChatResponse`; make `TOllamaClient.chat()` return the response-or-async-iterable union; add `stream?` to `TOllamaProviderConfig`.
- Modify `src/extensions/ollama/provider.ts` — add `collectStream()` helper + `isAsyncIterable()` guard; wire `stream` into the request; read the `stream` config knob.
- Modify `test/extensions/ollama/provider.test.ts` — streaming-path unit tests.
- Modify `test/extensions/ollama/provider-live.test.ts` — opt-in live streaming case.

**OpenAI (Levels 1b + 1c):**
- Modify `src/extensions/openai/types.ts` — add `stream?` / `background?` / `store?` to `TOpenAiResponsesRequestBody`.
- Modify `src/extensions/openai/provider.ts` — add `stream` / `backgroundMode` / `backgroundPollIntervalMs` options; refactor the HTTP step into `fetchResponseEnvelope()`; add SSE parsing (`readSseEnvelope`, `parseSseEvent`) and background helpers (`runBackground`, `getResponseById`, `cancelBackground`, `abortableDelay`); add the `backgroundMode` + `tools` guard.
- Modify `test/extensions/openai/provider.test.ts` — streaming + background unit tests + contract regression.

**Docs:**
- Modify `proposit-core/CLAUDE.md`, `docs/release-notes/upcoming.md`, `docs/changelogs/upcoming.md`, `docs/api-reference.md`.

---

## Task 1: Ollama type changes for streaming

**Files:**
- Modify: `src/extensions/ollama/types.ts`

- [ ] **Step 1: Widen the request `stream` field and add the streamed-chunk fields**

In `src/extensions/ollama/types.ts`, change `TOllamaChatResponse` to add an optional `done` flag (streamed chunks carry it; the final chunk is `done: true`):

```ts
export type TOllamaChatResponse = {
    message: TOllamaChatMessage
    done?: boolean
    prompt_eval_count?: number
    eval_count?: number
}
```

Change `TOllamaChatRequest.stream` from `false` to `boolean`:

```ts
export type TOllamaChatRequest = {
    model: string
    messages: TOllamaChatMessage[]
    format?: string | object
    tools?: TOllamaToolWire[]
    stream?: boolean
    options?: {
        temperature?: number
        num_predict?: number
        num_ctx?: number
    }
}
```

Change `TOllamaClient.chat()` to return the response-or-async-iterable union (the SDK resolves to an `AbortableAsyncIterator` when `stream: true`):

```ts
export type TOllamaClient = {
    chat(
        request: TOllamaChatRequest
    ): Promise<TOllamaChatResponse | AsyncIterable<TOllamaChatResponse>>
    abort(): void
}
```

- [ ] **Step 2: Add the `stream` knob to the provider config**

Add to `TOllamaProviderConfig` (just after `numCtx`):

```ts
    /**
     * Stream the `chat()` generation and accumulate the chunks inside
     * the provider, returning a single synthesized response. Defaults
     * to **`true`** — streaming is the primary fix for the hardcoded
     * ~300s non-streaming Ollama timeout (ollama/ollama#5081): headers
     * and the first chunk arrive immediately and undici's `bodyTimeout`
     * resets per chunk, so a long local thinking-model generation is no
     * longer aborted mid-flight. Set `false` to restore the legacy
     * single one-shot (`stream: false`) request.
     */
    stream?: boolean
```

- [ ] **Step 3: Defer typecheck to Task 2 (no separate commit)**

Do **not** run a standalone typecheck or commit here. Widening `chat()` to the union return means `runChatLoop`'s assignment to `TOllamaChatResponse` only compiles once Task 2 adds the `isAsyncIterable` narrowing. Task 1 and Task 2 land in a **single commit** (Task 2 Step 10 stages `types.ts` + `provider.ts` + the test together), so there is no intentionally-red commit boundary. (The existing timeout-test fakes that declare `chat(): Promise<TOllamaChatResponse>` remain assignable to the wider interface return — no break there.)

---

## Task 2: Ollama streaming accumulation (Level 1a)

**Files:**
- Modify: `src/extensions/ollama/provider.ts`
- Test: `test/extensions/ollama/provider.test.ts`

- [ ] **Step 1: Write the failing test — streamed chunks accumulate to the one-shot result**

Add a helper + describe block at the bottom of `test/extensions/ollama/provider.test.ts`. The mock `chat` returns an async generator when `req.stream` is true:

```ts
function streamOf(chunks: TOllamaChatResponse[]): AsyncIterable<TOllamaChatResponse> {
    return {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        async *[Symbol.asyncIterator]() {
            for (const c of chunks) {
                yield c
            }
        },
    }
}

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
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/extensions/ollama/provider.test.ts -t "accumulates streamed content"`
Expected: FAIL — the provider sends `stream: false` and assigns the async-iterable to `TOllamaChatResponse`, so `response.message` is `undefined` (or a typecheck error if run via `tsc`).

- [ ] **Step 3: Add the `collectStream` + `isAsyncIterable` helpers**

In `src/extensions/ollama/provider.ts`, add to the helpers section (after `safeParseJson`):

```ts
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
    let role = "assistant"
    let toolCalls: TOllamaChatToolCall[] | undefined
    let promptEvalCount = 0
    let evalCount = 0
    for await (const chunk of iterable) {
        const msg = chunk.message
        if (msg) {
            content += msg.content ?? ""
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
        if (chunk.prompt_eval_count !== undefined) {
            promptEvalCount = chunk.prompt_eval_count
        }
        if (chunk.eval_count !== undefined) {
            evalCount = chunk.eval_count
        }
    }
    return {
        message: { role, content, tool_calls: toolCalls },
        done: true,
        prompt_eval_count: promptEvalCount,
        eval_count: evalCount,
    }
}
```

Add `TOllamaChatToolCall` to the type import from `./types.js`.

- [ ] **Step 4: Read the `stream` config knob and wire it into the request**

In the `OllamaProvider` class, add a field and initialize it in the constructor:

```ts
    private readonly stream: boolean
```

```ts
        this.stream = this.config.stream ?? true
```

In `runChatLoop`, change the request construction so `stream` reflects the knob:

```ts
            const chatRequest: TOllamaChatRequest = {
                model: req.model,
                messages,
                format: convertedSchema,
                stream: this.stream,
            }
```

(`runChatLoop` needs access to `this.stream`; it is already a method on the class, so reference `this.stream` directly — do not thread it through `args`.)

- [ ] **Step 5: Narrow the `chat()` result (collect when streamed)**

In `runChatLoop`, replace the `response = await client.chat(chatRequest)` line inside the `try` with narrowing:

```ts
            let response: TOllamaChatResponse
            try {
                const raw = await client.chat(chatRequest)
                response = isAsyncIterable(raw) ? await collectStream(raw) : raw
            } catch (err) {
```

(The rest of the `catch` block — abort detection, `classifyOllamaError`, `debugLlmFailure`, re-throw — is unchanged. Keeping `collectStream` *inside* the `try` ensures a mid-stream throw is abort-classified exactly like a one-shot rejection.)

- [ ] **Step 6: Run the streaming test to verify it passes**

Run: `pnpm vitest run test/extensions/ollama/provider.test.ts -t "accumulates streamed content"`
Expected: PASS

- [ ] **Step 7: Add the `stream: false` escape-hatch test**

Add to the same describe block:

```ts
    it("falls back to the one-shot path when stream is false", async () => {
        const captured: TOllamaChatRequest[] = []
        const provider = new OllamaProvider({
            client: mockClient({
                onChat: (req) => {
                    captured.push(req)
                    return Promise.resolve(okResponse({ body: { answer: "x" } }))
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
                    return Promise.resolve(okResponse({ body: { answer: "x" } }))
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
```

Note: the existing `mockClient`/`okResponse` helpers return a plain `TOllamaChatResponse` (Promise), which the narrowing treats as the one-shot path — so existing non-streaming tests still pass with the default `stream: true` because the mock never returns an async iterable. The default-true assertion above just checks the request flag.

- [ ] **Step 8: Run the full Ollama provider suite**

Run: `pnpm vitest run test/extensions/ollama/provider.test.ts`
Expected: PASS (all existing + new tests).

- [ ] **Step 9: Typecheck + lint**

Run: `pnpm run typecheck && pnpm eslint src/extensions/ollama test/extensions/ollama --fix`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/extensions/ollama/types.ts src/extensions/ollama/provider.ts test/extensions/ollama/provider.test.ts
git commit -m "feat(ollama): stream chat() and accumulate chunks (Level 1a)

stream:true by default; collect chunks into one synthesized response so
respond()'s contract is unchanged. Fixes the held-connection ~300s
timeout class for actively-generating calls (ollama#5081). stream:false
config restores the one-shot path; the v1.6.1 timeout backstop stays."
```

---

## Task 3: OpenAI HTTP-step refactor (no behavior change)

Factor the per-round HTTP step into a single `fetchResponseEnvelope()` returning a `TOpenAiResponsesEnvelope`, so Levels 1b/1c can slot new modes in without touching the envelope-processing logic. This task is a pure refactor — the blocking path behaves identically and all existing tests stay green.

**Files:**
- Modify: `src/extensions/openai/provider.ts`

- [ ] **Step 1: Add `fetchResponseEnvelope` (blocking-only for now)**

In `src/extensions/openai/provider.ts`, add this function in the `// -- HTTP --` section (above `callOnce`):

```ts
async function fetchResponseEnvelope(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
}): Promise<TOpenAiResponsesEnvelope> {
    const response = await callOnce({
        url: args.url,
        apiKey: args.apiKey,
        body: args.body,
        fetchImpl: args.fetchImpl,
        signal: args.signal,
    })
    return response
        .json()
        .then((j) => j as TOpenAiResponsesEnvelope)
        .catch((err: unknown) => {
            throw new TransientLlmError({
                message: `OpenAI response body was not valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        })
}
```

- [ ] **Step 2: Replace the inline call+json in `respond` with `fetchResponseEnvelope`**

In the `respond` loop, replace:

```ts
            const response = await callOnce({
                url: baseUrl,
                apiKey: options.apiKey,
                body,
                fetchImpl,
                signal: req.signal,
            })

            const envelope: TOpenAiResponsesEnvelope = await response
                .json()
                .then((j) => j as TOpenAiResponsesEnvelope)
                .catch((err: unknown) => {
                    throw new TransientLlmError({
                        message: `OpenAI response body was not valid JSON: ${
                            err instanceof Error ? err.message : String(err)
                        }`,
                    })
                })
```

with:

```ts
            const envelope = await fetchResponseEnvelope({
                url: baseUrl,
                apiKey: options.apiKey,
                body,
                fetchImpl,
                signal: req.signal,
            })
```

- [ ] **Step 3: Run the full OpenAI provider suite + typecheck**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts && pnpm run typecheck`
Expected: PASS (pure refactor — no behavior change).

- [ ] **Step 4: Commit**

```bash
git add src/extensions/openai/provider.ts
git commit -m "refactor(openai): extract fetchResponseEnvelope HTTP step

Single seam returning a TOpenAiResponsesEnvelope so streaming +
background modes can slot in without touching the agent-loop
envelope-processing logic. No behavior change."
```

---

## Task 4: OpenAI foreground SSE streaming (Level 1b)

**Files:**
- Modify: `src/extensions/openai/types.ts`
- Modify: `src/extensions/openai/provider.ts`
- Test: `test/extensions/openai/provider.test.ts`

- [ ] **Step 1: Add `stream` to the request-body type**

In `src/extensions/openai/types.ts`, extend `TOpenAiResponsesRequestBody`:

```ts
export type TOpenAiResponsesRequestBody = {
    model: string
    input: TOpenAiInputMessage[]
    text: { format: TOpenAiTextFormat }
    tools?: TOpenAiTool[]
    max_output_tokens?: number
    reasoning?: { effort: "minimal" | "low" | "medium" | "high" }
    stream?: boolean
    background?: boolean
    store?: boolean
}
```

- [ ] **Step 2: Write the failing streaming test**

In `test/extensions/openai/provider.test.ts`, add a helper that builds an SSE `Response` and a describe block. (Match the existing test file's import of `createOpenAiResponsesProvider`, `TransientLlmError`, `Type`, and its `simpleSchema`/mock-fetch conventions — mirror them.)

```ts
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
                                            text: JSON.stringify({ answer: "blk" }),
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
})
```

Also add this import to the test file's imports (it is used here and in Task 5):

```ts
import { NonRetryableLlmError } from "../../../src/extensions/openai/errors.js"
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts -t "Level 1b"`
Expected: FAIL — `stream` option not recognized; SSE body run through blocking `.json()` → parse error / wrong shape.

- [ ] **Step 4: Add the SSE parser helpers**

In `src/extensions/openai/provider.ts`, add to the `// -- response parsing --` section:

```ts
const SSE_TERMINAL_EVENTS = new Set([
    "response.completed",
    "response.incomplete",
    "response.failed",
])

/**
 * Parse one SSE event block. Returns the embedded full `response`
 * envelope when the event is a terminal Responses-API event
 * (`response.completed` / `.incomplete` / `.failed`); otherwise
 * `undefined`. The terminal events carry a `type` field inside the
 * data JSON, so we key off that and ignore the `event:` line.
 */
function parseSseEvent(raw: string): TOpenAiResponsesEnvelope | undefined {
    let eventType: string | undefined
    const dataLines: string[] = []
    for (const line of raw.split("\n")) {
        if (line.startsWith(":")) continue // SSE comment line — ignore.
        if (line.startsWith("event:")) {
            eventType = line.slice(6).trim()
        } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).replace(/^ /, ""))
        }
    }
    if (dataLines.length === 0) return undefined
    let parsed: { type?: string; response?: TOpenAiResponsesEnvelope }
    try {
        parsed = JSON.parse(dataLines.join("\n")) as {
            type?: string
            response?: TOpenAiResponsesEnvelope
        }
    } catch {
        return undefined
    }
    // Prefer the discriminator inside the data JSON (Responses-API
    // events carry `type` there); fall back to the SSE `event:` line so
    // the parser is robust if the API ever sends the type only there.
    // (No `[DONE]` sentinel handling — that is a Chat-Completions frame
    // the Responses API does not emit.)
    const type = parsed.type ?? eventType
    if (type && SSE_TERMINAL_EVENTS.has(type) && parsed.response) {
        return parsed.response
    }
    return undefined
}

/**
 * Read an SSE `text/event-stream` body and return the envelope carried
 * by the terminal event. A stream that ends with no terminal event
 * (connection drop) throws `TransientLlmError` so the framework retries.
 * `AbortError` from the underlying reader propagates verbatim so
 * `llmStage` marks the stage `skipped`.
 */
async function readSseEnvelope(
    response: Response
): Promise<TOpenAiResponsesEnvelope> {
    const body = response.body
    if (!body) {
        throw new TransientLlmError({
            message: "OpenAI streaming response carried no body.",
        })
    }
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    let terminal: TOpenAiResponsesEnvelope | undefined
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let sep = buffer.indexOf("\n\n")
            while (sep !== -1) {
                const rawEvent = buffer.slice(0, sep)
                buffer = buffer.slice(sep + 2)
                const env = parseSseEvent(rawEvent)
                if (env) terminal = env
                sep = buffer.indexOf("\n\n")
            }
        }
    } catch (err) {
        if (isAbortError(err)) {
            throw err
        }
        throw new TransientLlmError({
            message: `OpenAI streaming read failed: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
    if (!terminal) {
        throw new TransientLlmError({
            message:
                "OpenAI streaming ended without a terminal response event (connection drop?).",
        })
    }
    return terminal
}
```

- [ ] **Step 5: Add the `stream` option and route it in `fetchResponseEnvelope`**

Add to `TCreateOpenAiResponsesProviderOptions`:

```ts
    /**
     * Stream the foreground response over SSE and accumulate to the
     * terminal envelope inside the provider. Defaults to **`true`** —
     * gives connection-drop resilience and parity with the Ollama
     * provider. No data-retention implications (unlike `backgroundMode`).
     * Set `false` to restore the blocking `response.json()` path.
     */
    stream?: boolean
```

Read it in the factory:

```ts
    const useStream = options.stream ?? true
```

Extend `fetchResponseEnvelope` to take a `stream` flag and branch:

```ts
async function fetchResponseEnvelope(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
    stream: boolean
}): Promise<TOpenAiResponsesEnvelope> {
    if (args.stream) {
        const response = await callOnce({
            url: args.url,
            apiKey: args.apiKey,
            body: { ...args.body, stream: true },
            fetchImpl: args.fetchImpl,
            signal: args.signal,
        })
        return readSseEnvelope(response)
    }
    const response = await callOnce({
        url: args.url,
        apiKey: args.apiKey,
        body: args.body,
        fetchImpl: args.fetchImpl,
        signal: args.signal,
    })
    return response
        .json()
        .then((j) => j as TOpenAiResponsesEnvelope)
        .catch((err: unknown) => {
            throw new TransientLlmError({
                message: `OpenAI response body was not valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        })
}
```

Pass `stream: useStream` at the call site in `respond`:

```ts
            const envelope = await fetchResponseEnvelope({
                url: baseUrl,
                apiKey: options.apiKey,
                body,
                fetchImpl,
                signal: req.signal,
                stream: useStream,
            })
```

- [ ] **Step 5b: Add the shared `status === "failed"` branch to the envelope-processing loop**

The Responses API returns a 200 envelope with `status: "failed"` (and an `error: { code?, message? }`) for a terminal server-side failure — reachable via SSE (`response.failed`) and background polling. The existing loop has no `failed` branch, so such an envelope falls through to the generic `"no assistant text content"` `TransientLlmError`, mis-classifying a hard failure as retryable and discarding `envelope.error`. Add an explicit branch in `respond`'s loop **immediately before** the `if (envelope.status === "incomplete")` block (so all three modes — blocking, streaming, background — share it):

```ts
            if (envelope.status === "failed") {
                const err = envelope.error
                const message = `OpenAI Responses API returned status: "failed"${
                    err?.code ? ` (code: ${err.code})` : ""
                }: ${err?.message ?? "no error detail provided"}`
                debugLlmFailure({
                    stageId: debugStageId,
                    model: req.model,
                    errorName: "NonRetryableLlmError",
                    errorMessage: message,
                    status: envelope.status,
                    tokenUsage: lastUsage,
                })
                // A terminal `failed` envelope is a definitive failure of
                // *this* response — surface immediately rather than burn a
                // retry. The `error.message` is preserved for the caller.
                throw new NonRetryableLlmError({ message })
            }
```

(`NonRetryableLlmError` is already imported in `provider.ts`. `envelope.error` is already typed as `{ message?: string; code?: string }` in `types.ts`.)

- [ ] **Step 6: Run the streaming tests to verify they pass**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts -t "Level 1b"`
Expected: PASS

- [ ] **Step 7: Run the full OpenAI suite + typecheck + lint**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts && pnpm run typecheck && pnpm eslint src/extensions/openai test/extensions/openai --fix`
Expected: PASS / clean. (Existing blocking tests still pass — they return a JSON `Response`; with `stream: true` default they would now hit the SSE path, so those existing tests must pass `stream: false` OR return an SSE body. **Action:** update existing blocking-path tests to construct the provider with `stream: false`, since they assert the blocking shape. Do this as part of this step and note it in the commit.)

- [ ] **Step 8: Commit**

```bash
git add src/extensions/openai/types.ts src/extensions/openai/provider.ts test/extensions/openai/provider.test.ts
git commit -m "feat(openai): foreground SSE streaming, default on (Level 1b)

Reconstruct the terminal envelope from the SSE stream and feed it to the
existing envelope-processing path. stream:false restores the blocking
path. Connection-drop mid-stream -> TransientLlmError."
```

---

## Task 5: OpenAI background mode (Level 1c)

**Files:**
- Modify: `src/extensions/openai/provider.ts`
- Test: `test/extensions/openai/provider.test.ts`

- [ ] **Step 1: Write the failing background tests**

Add to `test/extensions/openai/provider.test.ts` (the `NonRetryableLlmError` import was already added in Task 4 — do not duplicate it). Add a local `abortLikeError` helper for the faithful mid-poll-abort mock:

```ts
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
        expect(calls.filter((c) => c.method === "GET").length).toBe(2)
        expect(calls.some((c) => c.url.endsWith("/resp_bg"))).toBe(true)
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
        await expect(
            provider.respond({
                model: "gpt-5.4",
                systemPrompt: "s",
                userMessage: "u",
                outputSchema: simpleSchema,
            })
        ).rejects.toBeInstanceOf(NonRetryableLlmError)
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts -t "Level 1c"`
Expected: FAIL — `backgroundMode` option unrecognized; no submit-then-poll path.

- [ ] **Step 3: Add the background helpers**

In `src/extensions/openai/provider.ts`, add an `abortError` helper (mirroring the Ollama provider) and the background functions in the `// -- HTTP --` section:

```ts
function abortError(): Error {
    const e = new Error("The OpenAI background request was aborted.")
    e.name = "AbortError"
    return e
}

// Resolves (never rejects) on abort by design: the poll loop owns the
// abort→cancel→throw decision at exactly two checkpoints (top-of-loop and
// the in-flight-GET catch), so this helper just needs to wake the loop
// promptly instead of waiting out the full interval. Keeping it
// non-throwing avoids a second, competing abort surface.
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve()
            return
        }
        const onAbort = (): void => {
            cleanup()
            resolve()
        }
        const cleanup = (): void => {
            clearTimeout(timer)
            signal?.removeEventListener("abort", onAbort)
        }
        const timer = setTimeout(() => {
            cleanup()
            resolve()
        }, ms)
        signal?.addEventListener("abort", onAbort, { once: true })
    })
}

async function getResponseById(args: {
    url: string
    id: string
    apiKey: string
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
}): Promise<TOpenAiResponsesEnvelope> {
    let response: Response
    try {
        response = await args.fetchImpl(`${args.url}/${args.id}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${args.apiKey}` },
            signal: args.signal,
        })
    } catch (err) {
        if (isAbortError(err)) throw err
        throw new TransientLlmError({
            message: `Network error polling OpenAI background response: ${
                err instanceof Error ? err.message : String(err)
            }`,
        })
    }
    if (!response.ok) {
        const errorBody = await response.text().catch(() => "")
        throw classifyHttpError(
            response.status,
            `OpenAI poll ${response.status.toString()}: ${
                errorBody || response.statusText
            }`
        )
    }
    return response
        .json()
        .then((j) => j as TOpenAiResponsesEnvelope)
        .catch((err: unknown) => {
            throw new TransientLlmError({
                message: `OpenAI poll body was not valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        })
}

async function cancelBackground(args: {
    url: string
    id: string
    apiKey: string
    fetchImpl: TOpenAiFetch
}): Promise<void> {
    // Best-effort + idempotent — swallow errors; the abort is surfaced
    // regardless of whether cancel succeeds.
    try {
        await args.fetchImpl(`${args.url}/${args.id}/cancel`, {
            method: "POST",
            headers: { Authorization: `Bearer ${args.apiKey}` },
        })
    } catch {
        // ignore
    }
}

async function runBackground(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
    pollIntervalMs: number
}): Promise<TOpenAiResponsesEnvelope> {
    if (args.signal?.aborted) throw abortError()
    const submit = await callOnce({
        url: args.url,
        apiKey: args.apiKey,
        body: { ...args.body, background: true, store: true },
        fetchImpl: args.fetchImpl,
        signal: args.signal,
    })
    const submitEnvelope = await submit
        .json()
        .then((j) => j as TOpenAiResponsesEnvelope)
        .catch((err: unknown) => {
            throw new TransientLlmError({
                message: `OpenAI background submit body was not valid JSON: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            })
        })
    const id = submitEnvelope.id
    if (!id) {
        throw new TransientLlmError({
            message: "OpenAI background submit returned no response id.",
        })
    }
    // Fast-path: a small/cached request can come back already terminal on
    // submit — return it directly rather than issuing a redundant poll GET
    // (and avoid a `store`-expiry window between submit and first poll).
    if (isTerminalBackgroundStatus(submitEnvelope.status)) {
        if (submitEnvelope.status === "cancelled") throw abortError()
        return submitEnvelope
    }
    for (;;) {
        if (args.signal?.aborted) {
            await cancelBackground({
                url: args.url,
                id,
                apiKey: args.apiKey,
                fetchImpl: args.fetchImpl,
            })
            throw abortError()
        }
        let env: TOpenAiResponsesEnvelope
        try {
            env = await getResponseById({
                url: args.url,
                id,
                apiKey: args.apiKey,
                fetchImpl: args.fetchImpl,
                signal: args.signal,
            })
        } catch (err) {
            // Abort landing DURING an in-flight poll GET surfaces as an
            // AbortError from getResponseById (real fetch rejects the
            // in-flight request). The top-of-loop check alone would miss
            // it, so cancel here before re-throwing — this is what makes
            // the "AbortSignal → cancel POST" guarantee hold mid-poll.
            if (isAbortError(err)) {
                await cancelBackground({
                    url: args.url,
                    id,
                    apiKey: args.apiKey,
                    fetchImpl: args.fetchImpl,
                })
                throw abortError()
            }
            throw err
        }
        const status = env.status
        if (
            status === "completed" ||
            status === "failed" ||
            status === "incomplete"
        ) {
            return env
        }
        if (status === "cancelled") {
            throw abortError()
        }
        await abortableDelay(args.pollIntervalMs, args.signal)
    }
}

function isTerminalBackgroundStatus(status: string | undefined): boolean {
    return (
        status === "completed" ||
        status === "failed" ||
        status === "incomplete" ||
        status === "cancelled"
    )
}
```

(`classifyHttpError` already exists and accepts an optional `providerErrorCode`; calling it with two args is valid.)

- [ ] **Step 4: Add the options and the tools guard + routing**

Add to `TCreateOpenAiResponsesProviderOptions`:

```ts
    /**
     * Run long reasoning calls in OpenAI **background mode**
     * (submit-then-poll) so the result does not depend on a
     * continuously-held connection. Defaults to **`false`**.
     *
     * Background mode requires `store: true`, which retains the
     * response server-side (~10 min, for polling) and is **NOT
     * ZDR-compatible**. Enable only where that data-retention posture
     * is acceptable. V1 supports the **no-tools path only**: a request
     * that sets `backgroundMode` and carries `tools` throws
     * `NonRetryableLlmError`.
     */
    backgroundMode?: boolean
    /**
     * Poll interval (ms) for the background submit-then-poll loop.
     * Defaults to 2000. Ignored unless `backgroundMode` is `true`.
     */
    backgroundPollIntervalMs?: number
```

In the factory, read them:

```ts
    const useBackground = options.backgroundMode ?? false
    const backgroundPollIntervalMs = options.backgroundPollIntervalMs ?? 2000
```

At the **top of `respond`** (before the `input` array is built), add the tools guard:

```ts
        if (useBackground && req.tools && req.tools.length > 0) {
            throw new NonRetryableLlmError({
                message:
                    "OpenAI background mode does not support function tools in V1. Disable backgroundMode for tool-using requests, or run the tools synchronously.",
            })
        }
```

> **Deliberate scoping (do not remove):** OpenAI's API *does* support tools in background, but the function-tool agent loop under background mode means each round is its own background response — that is the documented Level-1c follow-up (spec "Out of scope"). V1 ships the no-tools path and throws explicitly rather than silently degrading. Ingestion (the only background consumer envisioned) is tool-free, so this guard never fires on the intended path.

> **`rawResponseId` note:** streaming and background now naturally populate `rawResponseId` from the (reconstructed / polled) envelope's `id`, where the blocking path also already did (`lastResponseId = envelope.id`). `rawResponseId` is an optional field, so this is contract-legal and not a regression — the Task 6 parity test therefore asserts only `output` + `tokenUsage` equality across modes, not `rawResponseId`.

Route in `fetchResponseEnvelope` by adding `background` + `pollIntervalMs` params and branching first:

```ts
async function fetchResponseEnvelope(args: {
    url: string
    apiKey: string
    body: TOpenAiResponsesRequestBody
    fetchImpl: TOpenAiFetch
    signal?: AbortSignal
    stream: boolean
    background: boolean
    pollIntervalMs: number
}): Promise<TOpenAiResponsesEnvelope> {
    if (args.background) {
        return runBackground({
            url: args.url,
            apiKey: args.apiKey,
            body: args.body,
            fetchImpl: args.fetchImpl,
            signal: args.signal,
            pollIntervalMs: args.pollIntervalMs,
        })
    }
    if (args.stream) {
        // ...unchanged streaming branch from Task 4...
    }
    // ...unchanged blocking branch from Task 4...
}
```

Update the call site in `respond`:

```ts
            const envelope = await fetchResponseEnvelope({
                url: baseUrl,
                apiKey: options.apiKey,
                body,
                fetchImpl,
                signal: req.signal,
                stream: useStream,
                background: useBackground,
                pollIntervalMs: backgroundPollIntervalMs,
            })
```

- [ ] **Step 5: Run the background tests to verify they pass**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts -t "Level 1c"`
Expected: PASS

- [ ] **Step 6: Full OpenAI suite + typecheck + lint**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts && pnpm run typecheck && pnpm eslint src/extensions/openai test/extensions/openai --fix`
Expected: PASS / clean.

- [ ] **Step 7: Commit**

```bash
git add src/extensions/openai/provider.ts test/extensions/openai/provider.test.ts
git commit -m "feat(openai): opt-in background submit-then-poll mode (Level 1c)

background:true + store:true submit, GET poll to terminal status, abort
-> cancel. Default off (store:true is not ZDR-compatible). No-tools path
only in V1; backgroundMode + tools throws NonRetryableLlmError."
```

---

## Task 6: Cross-mode contract regression test

**Files:**
- Test: `test/extensions/openai/provider.test.ts`

- [ ] **Step 1: Write a parametrized test asserting identical output across modes**

Add to `test/extensions/openai/provider.test.ts`:

```ts
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
                        { type: "response.completed", response: completedPayload },
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
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run test/extensions/openai/provider.test.ts -t "contract parity"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/extensions/openai/provider.test.ts
git commit -m "test(openai): contract parity across blocking/stream/background modes"
```

---

## Task 7: Opt-in live tests

**Files:**
- Modify: `test/extensions/ollama/provider-live.test.ts`
- Test (new or existing): an OpenAI background live case

- [ ] **Step 1: Inspect the existing live-test gating convention**

Run: `sed -n '1,40p' test/extensions/ollama/provider-live.test.ts`
Expected: shows the `RUN_LIVE_LLM_TESTS` (or equivalent) gate + `describe.skipIf`/`it.skipIf` pattern. **Match it exactly** for the new cases below.

- [ ] **Step 2: Add an Ollama streaming live case**

Append a live case (using the file's existing gate constant) that runs a real multi-KB ingestion-sized prompt through `new OllamaProvider({})` (default `stream: true`, real daemon) and asserts the structured output is structurally valid (`Value.Check` against the stage schema) — i.e. a previously-300s-failing generation completes via streaming. Assert structural validity, not exact tokens.

- [ ] **Step 3: Add OpenAI live cases — foreground streaming AND background**

Gate both on the live flag and `process.env.OPENAI_API_KEY`, in a new `test/extensions/openai/provider-live.test.ts` mirroring the Ollama live file's gating.

- **Foreground SSE (default):** `createOpenAiResponsesProvider({ apiKey })` (stream defaults on) and assert a real call returns a schema-valid result. This is the **only** test that exercises the real Responses-API SSE framing against the live API — without it the `parseSseEvent` assumption (terminal-event `type` + embedded `response` envelope) ships validated solely by a self-mirroring mock.
- **Background:** `createOpenAiResponsesProvider({ apiKey, backgroundMode: true })` and assert a real call completes via submit-then-poll with a schema-valid result.

- [ ] **Step 4: Verify the live tests are skipped by default**

Run: `pnpm vitest run test/extensions/ollama/provider-live.test.ts test/extensions/openai/provider-live.test.ts`
Expected: the live cases are SKIPPED (no daemon / no key set), suite green.

- [ ] **Step 5: Commit**

```bash
git add test/extensions/ollama/provider-live.test.ts test/extensions/openai/provider-live.test.ts
git commit -m "test(providers): opt-in live cases for ollama streaming + openai background"
```

---

## Task 8: Documentation sync

**Files:**
- Modify: `proposit-core/CLAUDE.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`
- Modify: `docs/api-reference.md` (only if provider config types are documented there)

- [ ] **Step 1: Update the CLAUDE.md provider design rules**

In the "Dev-only Ollama provider" bullet, change the `stream: false` statement to reflect streaming-by-default and the new `stream` knob. In/near the OpenAI provider description (or the pipeline-framework section that introduces the provider), note the new `stream` (default on) + `backgroundMode` (opt-in, `store:true`/ZDR caveat) + `backgroundPollIntervalMs` knobs.

- [ ] **Step 2: Check whether `docs/api-reference.md` documents the provider configs**

Run: `grep -n "TOllamaProviderConfig\|createOpenAiResponsesProvider\|TCreateOpenAiResponsesProviderOptions\|requestTimeoutMs" docs/api-reference.md`
Expected: if any hits, update those entries to add `stream` / `backgroundMode` / `backgroundPollIntervalMs`. If no hits, skip this file.

- [ ] **Step 2b: Confirm the CLI streaming-consumer impact**

The OpenAI default-flip to streaming means `src/cli/llm/index.ts` (which constructs the provider with no `stream` option) now streams by default — intended, no code change needed, but verify it is the only in-repo construction site and that the smoke test does not make live LLM calls:

Run: `grep -rn "createOpenAiResponsesProvider\|new OllamaProvider" src/ && grep -n "OPENAI_API_KEY\|parse\|ingest" scripts/smoke-test.sh`
Expected: the CLI is the sole non-test construction site; `scripts/smoke-test.sh` exercises only offline engine/CLI commands (no live LLM call). If the smoke test *does* call a live LLM path, note it — it now streams and needs a key, which it should already require. Add a one-line note to the changelog that the CLI now streams OpenAI responses by default.

- [ ] **Step 3: Write release notes + changelog entries**

Append a plain-language entry to `docs/release-notes/upcoming.md` (what changed for users: faster/robust local model runs, optional OpenAI background mode) and a developer entry to `docs/changelogs/upcoming.md` referencing the commit range from Tasks 2–7.

- [ ] **Step 4: Run the documentation-sync skill to confirm no tracked file was missed**

Invoke `skill-cefailures:documentation-sync` and reconcile against the repo's Documentation Sync list.

- [ ] **Step 5: Full verification gate**

Run: `pnpm run check`
Expected: typecheck + lint + tests + build all PASS.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/
git commit -m "docs: provider streaming + OpenAI background mode (1a/1b/1c)"
```

---

## Post-plan: versioning

After all tasks pass `pnpm run check`, offer `pnpm version minor` (1.6.1 → **1.7.0**): rename `docs/release-notes/upcoming.md` → `v1.7.0.md` and `docs/changelogs/upcoming.md` → `v1.7.0.md`, start fresh `upcoming.md` files, commit, and `git tag v1.7.0`. Then the standard consumer-side validation gate runs before any `pnpm publish` (orchestrator-dispatched per workspace CLAUDE.md).

---

## Self-review notes

- **Spec coverage:** 1a → Tasks 1–2; 1b → Tasks 3–4; 1c → Task 5; contract invariant → Task 6; testing section → Tasks 2,4,5,6,7; versioning/docs → Task 8 + Post-plan. Level 2 + resumable background+stream + tool-loop-under-background are explicitly out of scope (spec "Out of scope").
- **Type consistency:** `fetchResponseEnvelope` signature grows monotonically across Tasks 3 (`{url,apiKey,body,fetchImpl,signal}`) → 4 (`+stream`) → 5 (`+background,pollIntervalMs`); each task shows the full updated signature. `collectStream`/`isAsyncIterable` (Ollama) and `readSseEnvelope`/`parseSseEvent`/`runBackground`/`getResponseById`/`cancelBackground`/`abortableDelay`/`abortError` (OpenAI) are each defined once.
- **Known follow-up flagged for the executor:** Task 4 Step 7 requires retrofitting existing OpenAI blocking-path tests with `stream: false` (default flipped to streaming). This is called out so it is not missed.

### Dual-review fold (2026-05-31)

A Claude subagent + qwen3.6 reviewed this plan. Folded inline:

- **P1 — `status: "failed"` handling (both reviewers):** added the shared `failed` branch (Task 4 Step 5b) + streaming (Task 4) and background (Task 5) tests. Closes the spec's promised-but-unimplemented error path; a 200-with-`failed` no longer mis-classifies as transient.
- **P1 — abort mid-poll doesn't cancel (Claude P1-2/3, qwen P2):** `runBackground` now catches an in-flight-GET `AbortError` and issues `cancelBackground` before re-throwing; the Task 5 abort test rewritten to reject the in-flight GET faithfully. `abortableDelay`'s resolve-on-abort semantics documented as intentional.
- **P1 — Ollama tool_calls concat duplicates (qwen):** `collectStream` now takes the latest chunk's `tool_calls` (replace, not concat).
- **P1 — intentional red commit (Claude P1-4):** Task 1 Step 3 reframed; Task 1+2 land in one commit (no standalone failing typecheck).
- **P2 — SSE robustness:** `parseSseEvent` drops the dead `[DONE]` branch, skips comment lines, and falls back to the `event:` line. Added an OpenAI foreground-SSE **live** case (Task 7) so the framing assumption is validated against the real API, not just a self-mirroring mock.
- **P2 — background submit already terminal:** fast-path short-circuit via `isTerminalBackgroundStatus` before polling.
- **P2 — flaky default-stream test:** Ollama "defaults stream to true" test now awaits directly. Added a stale-intermediate-count fixture to lock last-wins (not summed) usage semantics.
- **P2 — CLI streaming consumer:** Task 8 Step 2b confirms the CLI is the sole construction site and the smoke test makes no live call.
- **Declined (deliberate):** the `backgroundMode`+`tools` throw is a spec-backed V1 scoping decision (annotated in Task 5); `rawResponseId` now populating on stream/background is contract-legal (optional field) and noted. Poll-interval clamping + status-literal-union (P3) skipped as YAGNI for a dev knob.
