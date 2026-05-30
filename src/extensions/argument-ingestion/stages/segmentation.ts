// `segmentation` — first stage of the v2 multi-stage ingestion
// pipeline. Splits the raw input text into segments (sentences or
// sentence-like chunks) and emits a stable `segmentId` per segment
// plus the text + character span.
//
// Why this lives in its own stage: downstream stages key their
// extractions to `segmentId`s rather than to character offsets, so
// extraction outputs survive small text edits if the segment ids are
// stable. Splitting is also a cheap-tier task; running it as its own
// stage prevents the larger downstream stages from burning tokens on
// the same job.

import {
    STAGE_IDS,
    SegmentationOutputSchema,
    type TSegmentationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"
import type {
    TIngestionInput,
    TLlmStageOptionsOverride,
} from "../shared/types.js"

export const SEGMENTATION_MODEL = "gpt-5.4-mini"

// **Output cap (v1.3.1 fix for the segmentation-truncation
// regression).** Segmentation emits an array of `{ segmentId, text,
// span }` records — each segment's `text` is copied verbatim from
// the input (per the prompt). For a 15 KB input the model
// legitimately wants 30–50 segments at ~80–150 tokens of JSON each,
// so the output budget needs to comfortably exceed 5 k tokens.
// Without an explicit cap the Responses API's default
// `max_output_tokens` for `gpt-5.4-mini` kicks in mid-string and
// the model returns `status: "incomplete"` + partial JSON; v1.3.0
// reproduced this against Singer's "Solution to World Poverty"
// (15.5 KB / ~4 k input tokens). 8192 tokens is roughly 2× the
// expected upper bound on realistic input sizes and stays well below
// any per-model context-window limit — comfortable headroom without
// burning tokens on an over-spec'd cap.
//
// Callers that ingest larger inputs can raise the cap further via
// `createIngestionV2Pipeline(extension, { llm: { overrides: {
// segmentation: { maxOutputTokens: N } } } })` — see
// `shared/types.ts`.
export const SEGMENTATION_MAX_OUTPUT_TOKENS = 8192

export const SEGMENTATION_SYSTEM_PROMPT = `You are the first stage of an argument-ingestion pipeline. Your job is to split the supplied input text into a list of segments.

Return an object with a single key \`segments\` whose value is the array of segments.

A segment is a sentence-or-thereabouts span of text — a self-contained clause that a human could read on its own. Sentence-final punctuation usually marks segment boundaries; bullet items in a list count as separate segments; multi-clause sentences split into one segment per major clause when the clauses each carry their own assertion.

Assign each segment a short stable id like "s1", "s2", ... in left-to-right order, copy the segment's text verbatim (no rewriting), and record the character "span" as an object with "start" (inclusive) and "end" (exclusive) character offsets into the input. Whitespace between segments is owned by neither segment.

Cover the input completely: every non-whitespace character must fall inside some segment's span. Do not invent text. Do not classify segments — that is a later stage's job.`

function buildSegmentationPrompt(ctx: TStageContext): {
    system: string
    user: string
} {
    const input = ctx.input as TIngestionInput
    const markedSystem = `<!-- stage-id: ${STAGE_IDS.segmentation} -->\n${SEGMENTATION_SYSTEM_PROMPT}`
    const user = `Input text:\n\n${input.text}`
    return { system: markedSystem, user }
}

/**
 * Internal default knobs for the segmentation stage. Exported so the
 * pipeline factory can compose `resolveLlmStageOptions` over them.
 */
export const SEGMENTATION_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: SEGMENTATION_MODEL,
    maxOutputTokens: SEGMENTATION_MAX_OUTPUT_TOKENS,
}

/**
 * Build the segmentation stage with optional caller overrides. The
 * pipeline factory threads `TLlmStageOptionsOverride` through this
 * factory; standalone consumers can call it with no args to get the
 * default-options stage.
 */
export function createSegmentationStage(
    options?: TLlmStageOptionsOverride
): TStage<TSegmentationOutput> {
    return llmStage<TSegmentationOutput>({
        id: STAGE_IDS.segmentation,
        dependsOn: [],
        outputSchema: SegmentationOutputSchema,
        model: options?.model ?? SEGMENTATION_MODEL,
        maxOutputTokens:
            options?.maxOutputTokens ?? SEGMENTATION_MAX_OUTPUT_TOKENS,
        reasoningEffort: options?.reasoningEffort,
        buildPrompt: buildSegmentationPrompt,
    })
}

/**
 * Backward-compatible default-options stage. Existing consumers
 * (tests, the v2 factory's pre-1.3.1 path) keep importing this and
 * see the new internal defaults — same as if they had called
 * `createSegmentationStage()` with no args.
 */
export const segmentationStage: TStage<TSegmentationOutput> =
    createSegmentationStage()
