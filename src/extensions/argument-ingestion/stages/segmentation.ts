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
import type { TIngestionInput } from "../shared/types.js"

export const SEGMENTATION_MODEL = "gpt-5.4-mini"

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

export const segmentationStage: TStage<TSegmentationOutput> =
    llmStage<TSegmentationOutput>({
        id: STAGE_IDS.segmentation,
        dependsOn: [],
        outputSchema: SegmentationOutputSchema,
        model: SEGMENTATION_MODEL,
        buildPrompt: buildSegmentationPrompt,
    })
