// Opt-in live integration suite for the background-stream provider
// contract against the REAL OpenAI Responses API.
//
// **Opt-in / never gates CI.** The describe block is skipped unless
// BOTH of these hold:
//   * `RUN_LIVE_LLM_TESTS=1` is set, AND
//   * `OPENAI_API_KEY` is a non-empty string.
// (Same gate as `provider-live.test.ts` — OpenAI calls cost money, so
// the live OpenAI suites share one opt-in flag.) When either is false
// the suite is `describe.skip`-ed with a console note. CI sets neither,
// so this file is inert there.
//
// HOW TO RUN (with your own key — these calls spend tokens):
//   RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=sk-... \
//     pnpm -C proposit-core exec vitest run \
//     test/extensions/openai/provider-live-background-stream.test.ts
//
// What it proves (things the mocked tests CANNOT verify against the
// real wire protocol + real server-side background behavior):
//   1. backgroundStreamMode create → the first SSE event is
//      `response.created` carrying an `id`, and `onResponseCreated`
//      fires MID-FLIGHT (id observed before the call resolves).
//   2. The streamed call completes and returns output + `rawResponseId`.
//   3. `retrieveResponse(id)` on that id → `completed` with output +
//      tokenUsage.
//   4. DISCONNECT-SURVIVAL (the pre-publish go/no-go): start a
//      background+stream call, capture the id mid-flight, ABORT the
//      local stream, then `reconnectStream(id)` → it drives the
//      response to `completed` (NOT `cancelled`) with usable output —
//      proving generation continued server-side after the local drop
//      and that reconnect-and-stream (not passive polling) finishes it.
//   5. `retrieveResponse("resp_doesnotexist")` → throws
//      `ResponseNotFoundError` (404).

import { describe, it, expect } from "vitest"
import Type from "typebox"
import type { Static } from "typebox"
import { Value } from "typebox/value"
import {
    createOpenAiResponsesProvider,
    retrieveResponse,
    reconnectStream,
    ResponseNotFoundError,
} from "../../../src/extensions/openai/index.js"

const MODEL = process.env.OPENAI_LIVE_MODEL ?? "gpt-5.4"
const optInEnabled = process.env.RUN_LIVE_LLM_TESTS === "1"
const apiKey = process.env.OPENAI_API_KEY ?? ""

const describeIf = optInEnabled && apiKey.length > 0 ? describe : describe.skip

if (optInEnabled && apiKey.length === 0) {
    console.warn(
        "[openai-live] RUN_LIVE_LLM_TESTS=1 but OPENAI_API_KEY is not set — skipping the live background-stream suite."
    )
} else if (!optInEnabled) {
    console.warn(
        "[openai-live] RUN_LIVE_LLM_TESTS is not set — skipping the live OpenAI background-stream suite (this is expected in CI)."
    )
}

// Tiny schema + prompt to keep token spend minimal.
const Schema = Type.Object({ answer: Type.String() })
type TAnswer = Static<typeof Schema>

const SYSTEM_PROMPT =
    "You answer with strict JSON matching the schema. No prose."
const USER_MESSAGE = "Reply with the single word: ok"

describeIf(
    "OpenAI background-stream provider — live calls (RUN_LIVE_LLM_TESTS=1)",
    () => {
        it(
            "(1) onResponseCreated fires MID-FLIGHT with an id from the first response.created SSE event",
            { timeout: 120_000 },
            async () => {
                const provider = createOpenAiResponsesProvider({
                    apiKey,
                    backgroundStreamMode: true,
                })

                let midFlightId: string | undefined
                let resolved = false

                const respondPromise = provider
                    .respond<TAnswer>({
                        model: MODEL,
                        systemPrompt: SYSTEM_PROMPT,
                        userMessage: USER_MESSAGE,
                        outputSchema: Schema,
                        onResponseCreated: (id) => {
                            // Must fire BEFORE the call resolves.
                            if (resolved) {
                                throw new Error(
                                    "onResponseCreated fired after respond() resolved"
                                )
                            }
                            midFlightId = id
                        },
                    })
                    .then((r) => {
                        resolved = true
                        return r
                    })

                // The id is delivered by the first SSE event; it must be
                // observable while respond() is still pending. Give the
                // stream a brief window to deliver `response.created`.
                const start = Date.now()
                while (
                    midFlightId === undefined &&
                    Date.now() - start < 30_000
                ) {
                    if (resolved) break
                    await new Promise((resolve) => setTimeout(resolve, 50))
                }

                expect(midFlightId).toBeDefined()
                expect((midFlightId ?? "").length).toBeGreaterThan(0)
                // The id arrived mid-flight, before completion.
                expect(resolved).toBe(false)

                const result = await respondPromise
                expect(result.rawResponseId).toBe(midFlightId)
            }
        )

        it(
            "(2) streamed call completes and returns output + rawResponseId",
            { timeout: 120_000 },
            async () => {
                const provider = createOpenAiResponsesProvider({
                    apiKey,
                    backgroundStreamMode: true,
                })

                const result = await provider.respond<TAnswer>({
                    model: MODEL,
                    systemPrompt: SYSTEM_PROMPT,
                    userMessage: USER_MESSAGE,
                    outputSchema: Schema,
                })

                expect(Value.Check(Schema, result.output)).toBe(true)
                expect(result.output.answer.length).toBeGreaterThan(0)
                expect(result.tokenUsage.input).toBeGreaterThan(0)
                expect(result.tokenUsage.output).toBeGreaterThan(0)
                expect(typeof result.rawResponseId).toBe("string")
                expect((result.rawResponseId ?? "").length).toBeGreaterThan(0)
            }
        )

        it(
            "(3) retrieveResponse(id) on a completed call returns completed + output + tokenUsage",
            { timeout: 120_000 },
            async () => {
                const provider = createOpenAiResponsesProvider({
                    apiKey,
                    backgroundStreamMode: true,
                })

                const result = await provider.respond<TAnswer>({
                    model: MODEL,
                    systemPrompt: SYSTEM_PROMPT,
                    userMessage: USER_MESSAGE,
                    outputSchema: Schema,
                })
                const id = result.rawResponseId
                expect(typeof id).toBe("string")

                const retrieved = await retrieveResponse(id!, { apiKey })
                expect(retrieved.status).toBe("completed")
                expect(retrieved.rawResponseId).toBe(id)
                expect(typeof retrieved.output).toBe("string")
                expect((retrieved.output ?? "").length).toBeGreaterThan(0)
                expect(retrieved.tokenUsage).toBeDefined()
                expect(retrieved.tokenUsage?.input ?? 0).toBeGreaterThan(0)
            }
        )

        it(
            "(4) DISCONNECT-SURVIVAL — abort the local stream mid-flight; the response still reaches completed server-side",
            { timeout: 600_000 },
            async () => {
                const controller = new AbortController()
                const provider = createOpenAiResponsesProvider({
                    apiKey,
                    backgroundStreamMode: true,
                })

                let capturedId: string | undefined
                const respondPromise = provider.respond<TAnswer>({
                    model: MODEL,
                    systemPrompt: SYSTEM_PROMPT,
                    userMessage: USER_MESSAGE,
                    outputSchema: Schema,
                    signal: controller.signal,
                    onResponseCreated: (id) => {
                        capturedId = id
                        // The instant we have the id, abandon the local
                        // stream — simulating a client drop / server crash
                        // mid-generation.
                        controller.abort()
                    },
                })

                // The aborted local call rejects (AbortError) — swallow it;
                // the point is what happens server-side.
                await respondPromise.catch(() => undefined)

                expect(capturedId).toBeDefined()
                const id = capturedId!

                // RECONNECT-AND-STREAM drives the dropped response to
                // completion. A passive `retrieveResponse` GET only reads
                // the current state and leaves a background response sitting
                // in `queued` / `in_progress` (the earlier live run proved
                // this stalled for 120s); reconnecting with `stream=true`
                // resumes consumption so the response reaches a terminal
                // status. It must be `completed` — NOT `cancelled` — proving
                // generation continued server-side after the local drop.
                const reconnected = await reconnectStream(id, { apiKey })

                expect(reconnected.status).toBe("completed")
                expect(reconnected.rawResponseId).toBe(id)
                expect((reconnected.output ?? "").length).toBeGreaterThan(0)
            }
        )

        it(
            "(5) retrieveResponse on a non-existent id throws ResponseNotFoundError (404)",
            { timeout: 60_000 },
            async () => {
                await expect(
                    retrieveResponse("resp_doesnotexist", { apiKey })
                ).rejects.toBeInstanceOf(ResponseNotFoundError)
            }
        )
    }
)
