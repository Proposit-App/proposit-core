// `claim-mention-extraction` — extracts every textual mention of a
// claim (a proposition the author makes) from each segment. Mentions
// are NOT deduplicated at this stage; `claim-canonicalization` does
// the dedupe/merge work. Producing mentions per-segment keeps this
// stage cheap + parallelizable; the dedupe stage gets the full
// mention list as context.

import {
    STAGE_IDS,
    ClaimMentionExtractionOutputSchema,
    type TClaimMentionExtractionOutput,
    type TSegmentationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"

export const CLAIM_MENTION_EXTRACTION_MODEL = "gpt-5.4"

export const CLAIM_MENTION_EXTRACTION_SYSTEM_PROMPT = `You extract textual "claim mentions" from segments of an argument. A mention is any contiguous span of text that asserts a proposition the author is making — a sentence-or-clause-sized chunk that a reader would read as a single assertion.

Return an object with a single key \`mentions\` whose value is the array of extracted mentions. For each mention emit:
- a fresh "mentionId" (m1, m2, ...; unique across all segments)
- the "segmentId" the mention belongs to
- the verbatim "text" of the mention (copy from the input — do not rewrite)
- the character "span" (an object with "start" inclusive, "end" exclusive) relative to the SEGMENT'S TEXT (not the original input)

A single segment can produce multiple mentions when it asserts multiple things. Most segments produce one mention. Do NOT deduplicate — if the same proposition is reasserted in a later segment, emit it as a separate mention there too. Do NOT classify the mention. Do NOT include connectives, hedges, or discourse markers in the span when they are not part of the asserted proposition.

If a segment is purely a discourse marker (e.g., "Therefore," or "Moreover,"), emit no mention for it. If there are no mentions at all, return \`{ "mentions": [] }\`.`

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const segmentation = ctx.get<TSegmentationOutput>(STAGE_IDS.segmentation)
    const segments = segmentation?.segments ?? []
    const renderedSegments = segments
        .map((s) => `[${s.segmentId}] ${JSON.stringify(s.text)}`)
        .join("\n")
    const markedSystem = `<!-- stage-id: ${STAGE_IDS.claimMentionExtraction} -->\n${CLAIM_MENTION_EXTRACTION_SYSTEM_PROMPT}`
    const user = `Segments:\n\n${renderedSegments}\n\nExtract every claim mention.`
    return { system: markedSystem, user }
}

export const claimMentionExtractionStage: TStage<TClaimMentionExtractionOutput> =
    llmStage<TClaimMentionExtractionOutput>({
        id: STAGE_IDS.claimMentionExtraction,
        dependsOn: [STAGE_IDS.segmentation],
        outputSchema: ClaimMentionExtractionOutputSchema,
        model: CLAIM_MENTION_EXTRACTION_MODEL,
        buildPrompt,
    })
