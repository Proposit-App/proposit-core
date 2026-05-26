// `axiom-indicator-detection` — detects places where the author
// invokes a self-evident truth (axiom) as the bottom-level support of
// some claim. Phrases like "by definition", "by convention",
// "as a matter of logic", "is necessarily true" mark the spots.

import {
    STAGE_IDS,
    AxiomIndicatorDetectionOutputSchema,
    type TAxiomIndicatorDetectionOutput,
    type TSegmentationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"

export const AXIOM_INDICATOR_DETECTION_MODEL = "gpt-5.4-mini"

export const AXIOM_INDICATOR_DETECTION_SYSTEM_PROMPT = `You scan the segments of an argument for axiom indicators — explicit signals that the author is invoking a self-evident truth as bottom-level support.

Recognized indicator patterns include (non-exhaustive):
- "by definition"
- "tautologically", "necessarily true"
- "by convention"
- "is true a priori"
- "as a matter of (logic | mathematics | definition)"
- "trivially"

Return an object with a single key \`axioms\` whose value is the array of detected indicators. For each detected indicator emit:
- a fresh "axiomId" (ax1, ax2, ...)
- the list of "segmentIds" the indicator occurs in (usually one; sometimes two when the indicator straddles a clause)
- the "indicator" — the verbatim trigger phrase
- the character "spans" — one span object ("start" inclusive, "end" exclusive) per occurrence, relative to the SEGMENT'S TEXT

Hedging phrases ("clearly", "obviously", "of course") are NOT axiom indicators on their own — they are stylistic emphasis. Return \`{ "axioms": [] }\` when no indicators are present.`

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const segmentation = ctx.get<TSegmentationOutput>(STAGE_IDS.segmentation)
    const segments = segmentation?.segments ?? []
    const renderedSegments = segments
        .map((s) => `[${s.segmentId}] ${JSON.stringify(s.text)}`)
        .join("\n")
    const markedSystem = `<!-- stage-id: ${STAGE_IDS.axiomIndicatorDetection} -->\n${AXIOM_INDICATOR_DETECTION_SYSTEM_PROMPT}`
    const user = `Segments:\n\n${renderedSegments}\n\nDetect every axiom indicator.`
    return { system: markedSystem, user }
}

export const axiomIndicatorDetectionStage: TStage<TAxiomIndicatorDetectionOutput> =
    llmStage<TAxiomIndicatorDetectionOutput>({
        id: STAGE_IDS.axiomIndicatorDetection,
        dependsOn: [STAGE_IDS.segmentation],
        outputSchema: AxiomIndicatorDetectionOutputSchema,
        model: AXIOM_INDICATOR_DETECTION_MODEL,
        buildPrompt,
    })
