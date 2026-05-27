// `citation-source-detection` — detects explicit source references in
// the segmented input. Markdown links, "according to X", named
// reports/papers, bracketed citation markers, etc. The downstream
// `claim-canonicalization` stage uses this to route the right claims
// to citation-typed records with their `url` / `title` populated.

import {
    STAGE_IDS,
    CitationSourceDetectionOutputSchema,
    type TCitationSourceDetectionOutput,
    type TSegmentationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"
import type { TLlmStageOptionsOverride } from "../shared/types.js"

export const CITATION_SOURCE_DETECTION_MODEL = "gpt-5.4-mini"

export const CITATION_SOURCE_DETECTION_SYSTEM_PROMPT = `You scan the segments of an argument for explicit references to external sources of evidence.

A source reference is any of:
- a Markdown link: \`[label](url)\`
- a named source: "according to X", "as reported in Y", "the X report"
- a bracketed citation marker: \`[1]\`, \`[Smith 2024]\`
- a fully-qualified URL

Return an object with a single key \`sources\` whose value is the array of detected source references. For each detected source emit:
- a fresh "sourceId" (src1, src2, ...)
- the list of "segmentIds" the source occurs in (almost always one; multi-segment when one citation spans a clause boundary)
- a short "sourceString" — the human-readable label (e.g. "NASA climate report", "Smith 2024")
- the "url" field — the URL when one is present, otherwise null
- the character "spans" — one span object ("start" inclusive, "end" exclusive) per occurrence, relative to the SEGMENT'S TEXT

Do not detect mere mentions of people, organizations, or studies that are not invoked as supporting evidence. Quote attribution alone ("Bob said X") is not a citation unless Bob's saying is being used to support a claim. Return \`{ "sources": [] }\` when no sources are present.`

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const segmentation = ctx.get<TSegmentationOutput>(STAGE_IDS.segmentation)
    const segments = segmentation?.segments ?? []
    const renderedSegments = segments
        .map((s) => `[${s.segmentId}] ${JSON.stringify(s.text)}`)
        .join("\n")
    const markedSystem = `<!-- stage-id: ${STAGE_IDS.citationSourceDetection} -->\n${CITATION_SOURCE_DETECTION_SYSTEM_PROMPT}`
    const user = `Segments:\n\n${renderedSegments}\n\nDetect every citation/source reference.`
    return { system: markedSystem, user }
}

/** Internal default knobs for the citation-source-detection stage. */
export const CITATION_SOURCE_DETECTION_STAGE_DEFAULTS: TLlmStageOptionsOverride =
    {}

/** Build the citation-source-detection stage with optional caller overrides. */
export function createCitationSourceDetectionStage(
    options?: TLlmStageOptionsOverride
): TStage<TCitationSourceDetectionOutput> {
    return llmStage<TCitationSourceDetectionOutput>({
        id: STAGE_IDS.citationSourceDetection,
        dependsOn: [STAGE_IDS.segmentation],
        outputSchema: CitationSourceDetectionOutputSchema,
        model: CITATION_SOURCE_DETECTION_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort: options?.reasoningEffort,
        buildPrompt,
    })
}

/** Backward-compatible default-options stage. */
export const citationSourceDetectionStage: TStage<TCitationSourceDetectionOutput> =
    createCitationSourceDetectionStage()
