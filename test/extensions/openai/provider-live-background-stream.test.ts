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
//      background+stream call with a longer-output prompt, capture the
//      id, then ABORT the local stream a few seconds later — MID-
//      generation, while `in_progress` (how a real server crash drops a
//      connection), NOT at `response.created` while still `queued`.
//      Assert the response was `in_progress` at abort (genuine mid-
//      generation drop), then `retrieveResponse`-poll it to `completed`
//      with usable output — the recovery path the server resync uses.
//      (A redundant `reconnectStream` assertion is kept as a secondary
//      check.)
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
import type { TResponseStatus } from "../../../src/extensions/openai/index.js"

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

// Tiny schema + prompt to keep token spend minimal (tests 1–3).
const Schema = Type.Object({ answer: Type.String() })
type TAnswer = Static<typeof Schema>

const SYSTEM_PROMPT =
    "You answer with strict JSON matching the schema. No prose."
const USER_MESSAGE = "Reply with the single word: ok"

// Longer-output schema + prompt for the disconnect-survival test (#4):
// generation must run long enough (>5s) that we can abort MID-generation
// (while `in_progress`), not at `response.created` while still `queued`.
const EssaySchema = Type.Object({ essay: Type.String() })
type TEssay = Static<typeof EssaySchema>

const ESSAY_SYSTEM_PROMPT =
    "You answer with strict JSON matching the schema. No prose outside the JSON."
const ESSAY_USER_MESSAGE =
    "Write an approximately 300-word essay on the history of formal logic, " +
    "from Aristotle's syllogistic through Frege and Russell to modern " +
    "propositional and predicate calculus. Put the whole essay in the `essay` field."

// Terminal background statuses (generation finished server-side).
const TERMINAL_STATUSES: ReadonlySet<TResponseStatus> = new Set([
    "completed",
    "failed",
    "incomplete",
    "cancelled",
])

// Poll `retrieveResponse` until the stored response reaches a terminal
// status or the cap elapses. This is the recovery path the server resync
// uses: once a background response is `in_progress`, it finishes
// server-side on its own and plain GET polling observes the completion.
async function pollUntilTerminal(
    id: string,
    args: { capMs: number; intervalMs: number }
): Promise<TResponseStatus> {
    const deadline = Date.now() + args.capMs
    for (;;) {
        const retrieved = await retrieveResponse(id, { apiKey })
        if (TERMINAL_STATUSES.has(retrieved.status)) {
            return retrieved.status
        }
        if (Date.now() >= deadline) {
            return retrieved.status
        }
        await new Promise((resolve) => setTimeout(resolve, args.intervalMs))
    }
}

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
            "(4) DISCONNECT-SURVIVAL — a MID-GENERATION drop still reaches completed server-side; retrieveResponse-poll recovers it",
            { timeout: 90_000 },
            async () => {
                const controller = new AbortController()
                const provider = createOpenAiResponsesProvider({
                    apiKey,
                    backgroundStreamMode: true,
                })

                // Use a longer-output prompt so generation runs well past
                // the `response.created` event — we want to abort while the
                // response is `in_progress` (mid-generation), which is how a
                // real server crash drops a connection. Aborting AT
                // `response.created` (still `queued`, before any generation)
                // is a degenerate timing that can park the response in
                // `queued` — see the zombie-edge note in the recovery step.
                let capturedId: string | undefined
                const respondPromise = provider.respond<TEssay>({
                    model: MODEL,
                    systemPrompt: ESSAY_SYSTEM_PROMPT,
                    userMessage: ESSAY_USER_MESSAGE,
                    outputSchema: EssaySchema,
                    signal: controller.signal,
                    onResponseCreated: (id) => {
                        // Capture the id at `response.created`, but DON'T
                        // abort yet — schedule the abort a few seconds out,
                        // by which point the response is `in_progress`.
                        capturedId = id
                        setTimeout(() => controller.abort(), 4_000)
                    },
                })

                // The aborted local call rejects (AbortError) — swallow it;
                // the point is what happens server-side.
                await respondPromise.catch(() => undefined)

                expect(capturedId).toBeDefined()
                const id = capturedId!

                // Prove the drop was genuinely MID-GENERATION: immediately
                // after the abort, the stored response must NOT already be
                // `completed` (otherwise a too-fast reply would make the
                // test vacuous). With a ~300-word essay it should be
                // `in_progress`; assert that specifically, but tolerate any
                // non-`completed` status so the test isn't flaky on timing.
                const atAbort = await retrieveResponse(id, { apiKey })
                expect(atAbort.status).not.toBe("completed")
                expect(atAbort.status).toBe("in_progress")

                // Recovery: a mid-generation background response completes
                // server-side on its own once `in_progress`. Plain
                // `retrieveResponse` GET polling drives recovery — this is
                // exactly what the server resync will do — so it is the
                // primary recovery assertion here.
                //
                // Zombie edge (deliberately NOT exercised here): if the
                // drop lands while the response is still `queued` (before
                // `in_progress`) — a narrow, unlikely window — the response
                // can be parked in `queued`. The SERVER resync handles that
                // case (bounded wait → re-run); the core test targets the
                // realistic mid-generation crash.
                const finalStatus = await pollUntilTerminal(id, {
                    capMs: 60_000,
                    intervalMs: 2_000,
                })
                expect(finalStatus).toBe("completed")

                const recovered = await retrieveResponse(id, { apiKey })
                expect(recovered.status).toBe("completed")
                expect(recovered.rawResponseId).toBe(id)
                expect((recovered.output ?? "").length).toBeGreaterThan(0)

                // `reconnectStream` is an equally-valid recovery path (and
                // the one that actively drives a still-`queued` response):
                // a redundant reconnect on the now-completed response also
                // returns the terminal result.
                const reconnected = await reconnectStream(id, { apiKey })
                expect(reconnected.status).toBe("completed")
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
