// Opt-in live integration suite for the OpenAI Responses-API provider.
//
// **Opt-in / never gates CI.** The describe block is skipped unless
// BOTH of these hold:
//   * `RUN_LIVE_LLM_TESTS=1` is set, AND
//   * `OPENAI_API_KEY` is a non-empty string.
// (OpenAI calls cost money, so this suite uses a distinct flag from
// the free local-Ollama `RUN_LOCAL_LLM_TESTS` gate.)
// When either is false the suite is `describe.skip`-ed with a console
// note. CI sets neither, so this file is inert there.
//
// What it proves:
//   (a) Foreground SSE (streaming default ON) — a real `respond()` call
//       round-trips a structured output and returns populated token usage.
//   (b) Background mode — submit-then-poll completes against the live
//       Responses API and delivers a schema-valid result.

import { describe, it, expect } from "vitest"
import Type from "typebox"
import type { Static } from "typebox"
import { Value } from "typebox/value"
import { createOpenAiResponsesProvider } from "../../../src/extensions/openai/index.js"

const MODEL = process.env.OPENAI_LIVE_MODEL ?? "gpt-5.4"
const optInEnabled = process.env.RUN_LIVE_LLM_TESTS === "1"
const apiKey = process.env.OPENAI_API_KEY ?? ""

// "Reachability" for OpenAI is simply: opted in AND key present. No
// daemon probe needed.
const describeIf = optInEnabled && apiKey.length > 0 ? describe : describe.skip

if (optInEnabled && apiKey.length === 0) {
    console.warn(
        "[openai-live] RUN_LIVE_LLM_TESTS=1 but OPENAI_API_KEY is not set — skipping the live suite."
    )
} else if (!optInEnabled) {
    console.warn(
        "[openai-live] RUN_LIVE_LLM_TESTS is not set — skipping the live OpenAI suite (this is expected in CI)."
    )
}

describeIf(
    "OpenAI Responses-API provider — live calls (RUN_LIVE_LLM_TESTS=1)",
    () => {
        // (a) Foreground SSE -----------------------------------------------

        it(
            "(a) foreground SSE — respond() round-trips a typed output with populated token usage",
            // Streaming (SSE) is the default for `createOpenAiResponsesProvider`.
            // This is the ONLY test exercising the real Responses-API SSE
            // framing against the live API: the client POSTs with
            // `stream: true`, receives the SSE stream, and accumulates
            // to the terminal `response.completed` envelope.
            { timeout: 120_000 },
            async () => {
                const provider = createOpenAiResponsesProvider({ apiKey })
                const Schema = Type.Object({
                    capital: Type.String(),
                })
                type TCapital = Static<typeof Schema>

                const result = await provider.respond<TCapital>({
                    model: MODEL,
                    systemPrompt:
                        "You answer with strict JSON matching the schema. No prose.",
                    userMessage: "What is the capital of France?",
                    outputSchema: Schema,
                })

                expect(Value.Check(Schema, result.output)).toBe(true)
                expect(result.output.capital.toLowerCase()).toContain("paris")
                // Token usage must be populated from the live response
                // (both the SSE terminal envelope and the non-streaming path
                // fill `usage.input_tokens` / `usage.output_tokens`).
                expect(result.tokenUsage.input).toBeGreaterThan(0)
                expect(result.tokenUsage.output).toBeGreaterThan(0)
                // rawResponseId is populated from the `id` field in the
                // terminal envelope.
                expect(typeof result.rawResponseId).toBe("string")
                expect((result.rawResponseId ?? "").length).toBeGreaterThan(0)
            }
        )

        // (b) Background mode ----------------------------------------------

        it(
            "(b) background mode — submit-then-poll completes and returns a schema-valid result",
            // Background mode posts with `background: true, store: true`,
            // then polls the GET /v1/responses/{id} endpoint until the
            // status reaches `completed`. This confirms the full
            // submit-then-poll cycle works end-to-end against the live API.
            { timeout: 600_000 },
            async () => {
                const backgroundProvider = createOpenAiResponsesProvider({
                    apiKey,
                    backgroundMode: true,
                })

                const Schema = Type.Object({
                    summary: Type.String(),
                    keyPoints: Type.Array(Type.String()),
                })
                type TSummary = Static<typeof Schema>

                const result = await backgroundProvider.respond<TSummary>({
                    model: MODEL,
                    systemPrompt:
                        "Summarise the argument in strict JSON matching the schema. " +
                        "Provide a one-sentence summary and up to five key points. No prose outside the JSON.",
                    userMessage:
                        "All humans are mortal. Socrates is a human. Therefore, Socrates is mortal. " +
                        "This is the classical syllogism that demonstrates deductive reasoning.",
                    outputSchema: Schema,
                })

                expect(Value.Check(Schema, result.output)).toBe(true)
                expect(result.output.summary.length).toBeGreaterThan(0)
                expect(Array.isArray(result.output.keyPoints)).toBe(true)
                expect(result.tokenUsage.input).toBeGreaterThan(0)
                expect(result.tokenUsage.output).toBeGreaterThan(0)
            }
        )
    }
)
