// Opt-in live integration suite for the chat-completions provider.
//
// **Opt-in / never gates CI.** The describe block is skipped unless
// BOTH of these hold:
//   * `RUN_LOCAL_LLM_TESTS=1` is set, AND
//   * the local server answers a reachability probe on its `/models`
//     endpoint.
// When either is false the suite is `describe.skip`-ed with a console
// note. CI sets neither, so this file is inert there — the dev who runs
// it is the one paying for the local roundtrip.
//
// What it proves:
//   (a) `respond()` smoke — a real call round-trips a typed output.
//   (b) STRUCTURED-OUTPUT smoke: does the local model honor the
//       `response_format` JSON schema on a representative
//       ingestion-stage-shaped schema?
//   (c) ONE e2e `createScholarPipeline` run on a short fixture with
//       every stage targeted at the local model, asserting a
//       well-formed argument-ingestion response.

import { describe, it, expect, beforeAll } from "vitest"
import Type from "typebox"
import type { Static } from "typebox"
import { Value } from "typebox/value"
import { createChatCompletionsProvider } from "../../../src/extensions/chat-completions/index.js"
import type { TLlmProvider } from "../../../src/lib/llm/types.js"
import { executePipeline } from "../../../src/lib/index.js"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/scholar.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/basics-extension.js"

const BASE_URL = process.env.LOCAL_LLM_BASE_URL ?? "http://127.0.0.1:46373/v1"
const MODEL = process.env.LOCAL_LLM_MODEL ?? "local-coder"
const optInEnabled = process.env.RUN_LOCAL_LLM_TESTS === "1"

async function serverReachable(): Promise<boolean> {
    if (!optInEnabled) return false
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2000)
        // OpenAI-compatible servers expose `GET {baseUrl}/models`.
        const res = await fetch(`${BASE_URL}/models`, {
            signal: controller.signal,
        })
        clearTimeout(timer)
        return res.ok
    } catch {
        return false
    }
}

// vitest evaluates `describe` synchronously, so decide skip-vs-run with
// a top-level await on the probe before the suite body is registered.
const reachable = await serverReachable()
const describeIf = optInEnabled && reachable ? describe : describe.skip

if (optInEnabled && !reachable) {
    console.warn(
        `[chat-completions-live] RUN_LOCAL_LLM_TESTS=1 but the server at ${BASE_URL} is unreachable — skipping the live suite.`
    )
} else if (!optInEnabled) {
    console.warn(
        "[chat-completions-live] RUN_LOCAL_LLM_TESTS is not set — skipping the live suite (this is expected in CI)."
    )
}

describeIf(
    "chat-completions provider — live server (RUN_LOCAL_LLM_TESTS=1)",
    () => {
        let provider: TLlmProvider

        beforeAll(() => {
            provider = createChatCompletionsProvider({
                baseUrl: BASE_URL,
                model: MODEL,
            })
        })

        it(
            "(a) respond() smoke — round-trips a typed structured output",
            { timeout: 120_000 },
            async () => {
                const schema = Type.Object({
                    capital: Type.String(),
                })
                const result = await provider.respond<Static<typeof schema>>({
                    model: MODEL,
                    systemPrompt:
                        "You answer with strict JSON matching the schema. No prose.",
                    userMessage: "What is the capital of France?",
                    outputSchema: schema,
                })
                expect(Value.Check(schema, result.output)).toBe(true)
                expect(result.output.capital.toLowerCase()).toContain("paris")
                // Token usage is populated from prompt_tokens/completion_tokens.
                expect(result.tokenUsage.input).toBeGreaterThan(0)
                expect(result.tokenUsage.output).toBeGreaterThan(0)
                expect(result.rawResponseId).toBeUndefined()
            }
        )

        it(
            "(b) structured-output gate — the model honors `response_format` on a segmentation-shaped schema",
            // A large reasoning model can take minutes per structured-
            // extraction call; the gate is CORRECTNESS not latency, so the
            // timeout matches the e2e tier (600s).
            { timeout: 600_000 },
            async () => {
                // Mirrors a segmentation stage's output shape: an array of
                // records with a nested span object + a Union enum field
                // and an Optional field — exercises the converter's object,
                // array, union-enum, and optional handling against the
                // model.
                const schema = Type.Object({
                    segments: Type.Array(
                        Type.Object({
                            segmentId: Type.String(),
                            text: Type.String(),
                            kind: Type.Union([
                                Type.Literal("claim"),
                                Type.Literal("other"),
                            ]),
                            note: Type.Optional(Type.String()),
                            span: Type.Object({
                                start: Type.Integer(),
                                end: Type.Integer(),
                            }),
                        })
                    ),
                })
                const result = await provider.respond<Static<typeof schema>>({
                    model: MODEL,
                    systemPrompt:
                        "Split the input into segments. Return strict JSON matching the schema. " +
                        "Each segment: a stable segmentId (s1, s2, ...), the verbatim text, " +
                        'a "kind" of either "claim" or "other", and a span {start,end} of ' +
                        "character offsets. No prose outside the JSON.",
                    userMessage:
                        "The sky is blue. Grass is green. Therefore colors exist.",
                    outputSchema: schema,
                })
                expect(
                    Value.Check(schema, result.output),
                    `model output failed the source TypeBox schema — the \`response_format\` schema may not have been honored. Output: ${JSON.stringify(
                        result.output
                    )}`
                ).toBe(true)
                expect(Array.isArray(result.output)).toBe(false)
                expect(result.output.segments.length).toBeGreaterThan(0)
                for (const seg of result.output.segments) {
                    expect(["claim", "other"]).toContain(seg.kind)
                }
            }
        )

        it(
            "(c) e2e — createScholarPipeline runs end-to-end on the local model",
            { timeout: 600_000 },
            async () => {
                const pipeline = createScholarPipeline(basicsExtension, {
                    llm: { defaults: { model: MODEL } },
                })
                const text =
                    "All humans are mortal. Socrates is a human. Therefore, Socrates is mortal."
                const result = await executePipeline(
                    pipeline,
                    { text },
                    { llm: provider }
                )
                // The pipeline produces SOME well-formed response object.
                // We don't assert the local model matches gpt-5.x quality —
                // only that the local backend drives the full DAG to a
                // structurally valid response (argument present OR a
                // finalize null-path with failureText). Either is a
                // legitimate well-formed outcome.
                expect(result.output).not.toBeNull()
                const out = result.output as Record<string, unknown>
                expect(out).toHaveProperty("argument")
                if (result.failures.length > 0) {
                    console.warn(
                        `[chat-completions-live] e2e completed with ${result.failures.length.toString()} stage failure(s): ${result.failures
                            .map((f) => `${f.stage}:${f.code}`)
                            .join(", ")}`
                    )
                }
            }
        )
    }
)
