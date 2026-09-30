// Live-LLM regression for segmentation output truncation. Without a
// `maxOutputTokens` cap, for inputs above ~10 KB the Responses API
// can emit a truncated JSON payload that fails to parse
// ("Unterminated string in JSON at position N"); a retry hits the same
// limit and the whole pipeline reports `output: null`.
//
// This test runs the real segmentation stage against Madison's
// "Federalist No. 10" (18 KB / ~4.5 k input tokens). With the stage's
// output cap it must finish without truncation, return a non-empty
// segments array, and not trigger `validationError` on the stage's
// `outputSchema`.
//
// **Why Federalist 10.** A comparable-size text (the Singer "Solution
// to World Poverty" essay, 15.5 KB) instead
// triggers OpenAI's content-policy filter: `status: "incomplete"` with
// `incomplete_details.reason: "content_filter"` rather than
// `"max_output_tokens"`. That case is deterministic and covered by the
// provider unit tests (see `provider.test.ts` "throws
// NonRetryableLlmError on incomplete with reason: content_filter").
// Federalist 10 is a political-philosophy text with no content-policy
// risk, so it exercises the max_output_tokens cap path cleanly.
//
// **Opt-in.** Gated on both `OPENAI_API_KEY` (env or
// `.env.development`) AND `RUN_LIVE_LLM_TESTS=1` — vitest skips the
// describe block otherwise. CI does not set the live-tests gate by
// default; the dev that opens this file is the one paying for the
// roundtrip.

import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import Type from "typebox"
import { executePipeline, optional } from "../../../../src/lib/index.js"
import { createOpenAiResponsesProvider } from "../../../../src/extensions/openai/index.js"
import {
    STAGE_IDS,
    segmentationStage,
} from "../../../../src/extensions/pipelines/base/stages/index.js"
import type {
    TPipeline,
    TPipelineEvent,
} from "../../../../src/lib/pipelines/index.js"
import type { TSegmentationOutput } from "../../../../src/extensions/pipelines/base/stages/schemas.js"

const FIXTURE_DIR = path.resolve(
    import.meta.dirname,
    "../fixtures-live/federalist-no-10"
)

function loadApiKey(): string | undefined {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
    const envPath = path.resolve(
        import.meta.dirname,
        "../../../../.env.development"
    )
    if (!fs.existsSync(envPath)) return undefined
    const content = fs.readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
        const match = /^OPENAI_API_KEY=(.+)$/.exec(line)
        if (match) return match[1].trim()
    }
    return undefined
}

const apiKey = loadApiKey()
const liveTestsEnabled = process.env.RUN_LIVE_LLM_TESTS === "1"
const describeIf = apiKey && liveTestsEnabled ? describe : describe.skip

// Tiny stand-in pipeline that runs *only* segmentation against the
// Federalist 10 text. Lets us pin the failure mode to the
// segmentation stage in isolation — same stage instance the real
// factory wires up, just without the eleven downstream stages
// weighing in.
const INPUT_SCHEMA = Type.Object({ text: Type.String({ minLength: 1 }) })

function buildSegmentationOnlyPipeline(): TPipeline<
    { text: string },
    TSegmentationOutput
> {
    return {
        id: "segmentation-only",
        version: "1.0.0",
        inputSchema: INPUT_SCHEMA,
        outputSchema: segmentationStage.outputSchema,
        stages: [segmentationStage],
        finalize: {
            dependsOn: [optional(STAGE_IDS.segmentation)],
            run: (ctx) =>
                ctx.get<TSegmentationOutput>(STAGE_IDS.segmentation) ?? {
                    segments: [],
                },
        },
    }
}

describeIf(
    "segmentation stage — Federalist 10 reproducer (live LLM, RUN_LIVE_LLM_TESTS=1)",
    () => {
        it(
            "completes without truncation on the 18 KB Federalist No. 10 text",
            { timeout: 300_000 },
            async () => {
                const inputPath = path.join(FIXTURE_DIR, "input.txt")
                const text = fs.readFileSync(inputPath, "utf-8")
                expect(text.length).toBeGreaterThan(15_000)

                const provider = createOpenAiResponsesProvider({
                    apiKey: apiKey!,
                })
                const events: TPipelineEvent[] = []
                const pipeline = buildSegmentationOnlyPipeline()
                const result = await executePipeline(
                    pipeline,
                    { text },
                    {
                        llm: provider,
                        onEvent: (event) => events.push(event),
                    }
                )

                // Pull every `stage:llm-call` event for diagnostic
                // surface — these carry the actual prompts + raw
                // output + per-attempt `validationError`. A
                // non-truncated response leaves `validationError`
                // undefined on all attempts.
                const llmCalls = events.filter(
                    (event) => event.kind === "stage:llm-call"
                )
                expect(llmCalls.length).toBeGreaterThanOrEqual(1)
                for (const call of llmCalls) {
                    if (call.kind !== "stage:llm-call") continue
                    expect(
                        call.validationError,
                        `stage:llm-call attempt ${call.attempt.toString()} reported validationError: ${
                            call.validationError ?? ""
                        }`
                    ).toBeUndefined()
                }

                // No failures recorded — segmentation succeeded on
                // first attempt (or first-with-retry).
                expect(result.failures).toEqual([])
                expect(result.stageOutcomes[STAGE_IDS.segmentation]).toBe(
                    "completed"
                )

                // The output should be a non-trivial list of segments
                // covering most of the input. A pre-fix run truncated
                // around character ~310, which means even at best the
                // recovered segments cover < 500 characters; this gate
                // catches that regression.
                expect(result.output).not.toBeNull()
                const out = result.output!
                expect(out.segments.length).toBeGreaterThan(10)
                const lastSpan = out.segments[out.segments.length - 1].span.end
                expect(lastSpan).toBeGreaterThan(text.length * 0.8)
            }
        )
    }
)
