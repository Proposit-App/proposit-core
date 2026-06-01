// Opt-in live integration suite for the Ollama provider.
//
// **Opt-in / never gates CI.** The describe block is skipped unless
// BOTH of these hold:
//   * `RUN_LOCAL_LLM_TESTS=1` is set, AND
//   * the Ollama daemon answers a reachability probe on :11434.
// When either is false the suite is `describe.skip`-ed with a console
// note. CI sets neither, so this file is inert there — the dev who runs
// it is the one paying for the local roundtrip.
//
// What it proves:
//   (a) `respond()` smoke — a real chat() round-trips a typed output.
//   (b) STRUCTURED-OUTPUT smoke (the decision-2 empirical gate): does
//       `qwen3.6` honor the `format` JSON schema on a representative
//       ingestion-stage-shaped schema? If this fails, the Ollama
//       converter may need a strict fold (flag it in the hand-back).
//   (c) ONE e2e `createIngestionV2Pipeline` run on a short fixture with
//       every stage targeted at `qwen3.6:latest`, asserting a
//       well-formed `TParsedArgumentResponse`.

import { describe, it, expect, beforeAll } from "vitest"
import Type from "typebox"
import type { Static } from "typebox"
import { Value } from "typebox/value"
import { OllamaProvider } from "../../../src/extensions/ollama/index.js"
import {
    basicsExtension,
    createIngestionV2Pipeline,
    executePipeline,
} from "../../../src/lib/index.js"

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
const MODEL = process.env.LOCAL_LLM_MODEL ?? "qwen3.6:latest"
const optInEnabled = process.env.RUN_LOCAL_LLM_TESTS === "1"

async function daemonReachable(): Promise<boolean> {
    if (!optInEnabled) return false
    try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 2000)
        const res = await fetch(`${BASE_URL}/api/tags`, {
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
const reachable = await daemonReachable()
const describeIf = optInEnabled && reachable ? describe : describe.skip

if (optInEnabled && !reachable) {
    console.warn(
        `[ollama-live] RUN_LOCAL_LLM_TESTS=1 but the daemon at ${BASE_URL} is unreachable — skipping the live suite.`
    )
} else if (!optInEnabled) {
    console.warn(
        "[ollama-live] RUN_LOCAL_LLM_TESTS is not set — skipping the live Ollama suite (this is expected in CI)."
    )
}

describeIf("OllamaProvider — live daemon (RUN_LOCAL_LLM_TESTS=1)", () => {
    let provider: OllamaProvider

    beforeAll(() => {
        provider = new OllamaProvider({ baseUrl: BASE_URL })
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
            // Token usage is populated from prompt_eval_count/eval_count.
            expect(result.tokenUsage.input).toBeGreaterThan(0)
            expect(result.tokenUsage.output).toBeGreaterThan(0)
            expect(result.rawResponseId).toBeUndefined()
        }
    )

    it(
        "(b) structured-output gate — qwen3.6 honors `format` under the model-default thinking trace",
        // qwen3.6 is a 36B reasoning model. The provider leaves thinking
        // at the model default (ON) unless `config.think` is set, so this
        // gate runs WITH the thinking trace. Disabling it measurably
        // degrades structured-output fidelity on this segmentation-shaped
        // prompt — the model drops the object wrapper and returns a bare
        // array (verified empirically) — which is why there is no safe
        // global `think: false` default and why this gate asserts the
        // object envelope, not a bare array. A single call was observed at
        // 2-5+ min on the dev machine (the bulk is the thinking trace);
        // the gate is CORRECTNESS not latency, so the timeout matches the
        // e2e tier (600s).
        { timeout: 600_000 },
        async () => {
            // Mirrors the segmentation stage's output shape: an array of
            // records with a nested span object + a Union enum field and
            // an Optional field — exercises the converter's object,
            // array, union-enum, and optional handling against the model.
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
            // The decision-2 gate: the model's output validates against
            // the source TypeBox schema (i.e. `format` was honored).
            expect(
                Value.Check(schema, result.output),
                `qwen3.6 output failed the source TypeBox schema — the \`format\` schema may not have been honored. Output: ${JSON.stringify(
                    result.output
                )}`
            ).toBe(true)
            // Under the model-default thinking trace the output is the
            // object envelope, NOT a top-level array (the failure mode
            // seen when thinking is disabled on this prompt).
            expect(Array.isArray(result.output)).toBe(false)
            expect(result.output.segments.length).toBeGreaterThan(0)
            // The Union enum was respected (no value outside the enum).
            for (const seg of result.output.segments) {
                expect(["claim", "other"]).toContain(seg.kind)
            }
        }
    )

    it(
        "(c) e2e — createIngestionV2Pipeline runs end-to-end on qwen3.6",
        { timeout: 600_000 },
        async () => {
            const pipeline = createIngestionV2Pipeline(basicsExtension, {
                llm: { defaults: { model: MODEL } },
            })
            const text =
                "All humans are mortal. Socrates is a human. Therefore, Socrates is mortal."
            const result = await executePipeline(
                pipeline,
                { text },
                { llm: provider }
            )
            // The pipeline produces SOME well-formed response object. We
            // don't assert qwen matches gpt-5.x quality — only that the
            // local backend drives the full DAG to a structurally valid
            // TParsedArgumentResponse (argument present OR a finalize
            // null-path with failureText). Either is a legitimate
            // well-formed outcome.
            expect(result.output).not.toBeNull()
            const out = result.output as Record<string, unknown>
            expect(out).toHaveProperty("argument")
            // Surface any stage failures for diagnostic context if the
            // run degraded — not a hard gate (qwen may not nail every
            // stage), but useful when reading the test output.
            if (result.failures.length > 0) {
                console.warn(
                    `[ollama-live] e2e completed with ${result.failures.length.toString()} stage failure(s): ${result.failures
                        .map((f) => `${f.stage}:${f.code}`)
                        .join(", ")}`
                )
            }
        }
    )

    it(
        "(d) streaming completes a multi-KB ingestion-sized prompt without a 300s timeout",
        // Ollama streaming (Level 1a) keeps the connection alive by
        // delivering tokens incrementally, circumventing undici's
        // default 300s body-timeout that fires on a silent connection.
        // This test drives a deliberately large prompt through the
        // existing (streaming-by-default) provider and asserts the
        // output is structurally valid — not latency, not exact tokens.
        { timeout: 600_000 },
        async () => {
            // Multi-KB ingestion-sized prompt: a several-paragraph
            // argument text large enough to stress the streaming path.
            const paragraph =
                "Philosophers have long debated the relationship between knowledge and justified belief. " +
                "Plato defined knowledge as justified true belief, yet Gettier cases challenge this account. " +
                "If a person has a justified belief that is true only by accident, do they really know? " +
                "Many epistemologists argue that an additional condition is required beyond justification and truth. " +
                "Some propose a causal theory: the believer's justification must be appropriately caused by the fact. " +
                "Others favor a safety condition: the belief could not easily have been false given the circumstances. " +
                "Still others endorse a sensitivity condition: if the proposition were false, the belief would be revised. " +
                "Reliabilists focus on whether the belief-forming process reliably yields true beliefs in general. " +
                "Virtue epistemologists locate the key property in the intellectual virtues of the knower. " +
                "Despite these proposals, no single account has achieved consensus in the philosophical community."
            const userMessage = [
                paragraph,
                paragraph,
                paragraph,
                paragraph,
                paragraph,
                paragraph,
            ].join("\n\n")

            // Schema mirrors a claim-extraction stage output — an array
            // of records with a label and a boolean confidence flag.
            const Schema = Type.Object({
                claims: Type.Array(
                    Type.Object({
                        claimId: Type.String(),
                        text: Type.String(),
                        isPrimary: Type.Boolean(),
                        kind: Type.Union([
                            Type.Literal("premise"),
                            Type.Literal("conclusion"),
                            Type.Literal("background"),
                        ]),
                    })
                ),
            })
            type TClaims = Static<typeof Schema>

            const result = await provider.respond<TClaims>({
                model: MODEL,
                systemPrompt:
                    "Extract the main claims from the philosophical text. " +
                    "Return strict JSON matching the schema. No prose outside the JSON. " +
                    "For each claim assign a stable claimId (c1, c2, ...), the verbatim or " +
                    "paraphrased claim text, whether it is a primary thesis (isPrimary), " +
                    'and a kind of "premise", "conclusion", or "background".',
                userMessage,
                outputSchema: Schema,
            })

            // Structural validity is the gate: streaming must deliver a
            // complete, schema-valid JSON object, not a truncated fragment.
            expect(
                Value.Check(Schema, result.output),
                `Streaming output failed the source TypeBox schema — the generation may have been truncated. Output: ${JSON.stringify(
                    result.output
                )}`
            ).toBe(true)
            expect(result.output.claims.length).toBeGreaterThan(0)
            // Every claim respects the Union enum.
            for (const claim of result.output.claims) {
                expect(["premise", "conclusion", "background"]).toContain(
                    claim.kind
                )
            }
        }
    )
})
