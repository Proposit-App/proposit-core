// `relation-extraction` — strong-reasoning stage that identifies the
// supporting relationships between canonical claims. MVP relation
// types: support, joint-support, derivation-support.
//
// Per spec §6.4 this stage uses gpt-5.5 with reasoning_effort=high —
// it's the most subtle judgement call in the pipeline. The output is
// a graph; the conclusion + the support graph drive the
// formula-compilation stage that comes next.

import {
    STAGE_IDS,
    RelationExtractionOutputSchema,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"
import type { TLlmStageOptionsOverride } from "../shared/types.js"

export const RELATION_EXTRACTION_MODEL = "gpt-5.5"
export const RELATION_EXTRACTION_REASONING:
    | "minimal"
    | "low"
    | "medium"
    | "high" = "high"

export const RELATION_EXTRACTION_SYSTEM_PROMPT = `You identify support relationships between canonical claims in an argument.

Given the canonical claim set, the per-claim type map, and the original segments, emit one entry per supporting relationship. Return an object with a single key \`relations\` whose value is the array. There are three relation kinds:

- \`"support"\` — a single claim S supports another claim T. Use this for ordinary "P, therefore Q" support edges where the supporting evidence is a single normal-typed proposition.
- \`"joint-support"\` — multiple claims S1, S2, ... jointly support T. Use this when the author commits to a syllogistic step that requires ALL of the sources to hold (e.g. major premise + minor premise → conclusion).
- \`"derivation-support"\` — a citation-typed or axiomatic-typed claim S supports a normal-typed claim T. Use this exclusively for relations whose source is "citation" or "axiomatic". The shape is otherwise identical to \`"support"\`.

For each relation emit:
- a fresh \`relationId\` (r1, r2, ...)
- the \`type\`
- \`sources\` — an array of supporting claim miniIds (length 1 for support and derivation-support; length ≥ 2 for joint-support)
- \`target\` — the supported claim's miniId
- \`evidence.segmentIds\` — the segments that ground the relation (often a single segment containing a "therefore", "so", "because")
- \`evidence.quote\` — a short verbatim quote from the input that justifies the relation

## Conservatism rules

- Do not invent relations. If the author doesn't actually argue from S to T, don't emit a relation between them.
- Do not double-count. If two claims share an axiomatic backing, that's one derivation-support relation per claim, not a joint-support pair.
- The conclusion of the argument is identified in a separate stage; do NOT emit a special "conclusion" relation here. Just emit the support edges you see; the conclusion stage selects from your output.
- Avoid attack/rebuttal relations entirely in this MVP — the pipeline does not yet handle them.

If there are no relations to emit, return \`{ "relations": [] }\`.`

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const canon = ctx.get<TClaimCanonicalizationOutput>(
        STAGE_IDS.claimCanonicalization
    )
    const typeEnvelope = ctx.get<TClaimTypeClassificationOutput>(
        STAGE_IDS.claimTypeClassification
    )
    const typeByMiniId = new Map<string, TClaimTypeClassificationEntry>()
    for (const entry of typeEnvelope?.classifications ?? []) {
        typeByMiniId.set(entry.miniId, entry)
    }
    const segmentEnvelope = ctx.get<TSegmentationOutput>(STAGE_IDS.segmentation)
    const segments = segmentEnvelope?.segments ?? []

    const claimLines = (canon?.canonicalClaims ?? [])
        .map((c) => {
            const refinedType = typeByMiniId.get(c.miniId)?.type ?? c.type
            return `  [${c.miniId}] type=${refinedType} symbol=${c.suggestedSymbol} fields=${JSON.stringify(
                {
                    ...c,
                    miniId: undefined,
                    mentionIds: undefined,
                    suggestedSymbol: undefined,
                    type: undefined,
                }
            )}`
        })
        .join("\n")
    const segmentLines = segments
        .map((s) => `  [${s.segmentId}] ${JSON.stringify(s.text)}`)
        .join("\n")

    const markedSystem = `<!-- stage-id: ${STAGE_IDS.relationExtraction} -->\n${RELATION_EXTRACTION_SYSTEM_PROMPT}`
    const user = `Canonical claims (with refined types):\n${claimLines}\n\nSegments:\n${segmentLines}\n\nEmit every support relationship as a relations array.`
    return { system: markedSystem, user }
}

/** Internal default knobs for the relation-extraction stage. */
export const RELATION_EXTRACTION_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: RELATION_EXTRACTION_MODEL,
    reasoningEffort: RELATION_EXTRACTION_REASONING,
}

/** Build the relation-extraction stage with optional caller overrides. */
export function createRelationExtractionStage(
    options?: TLlmStageOptionsOverride
): TStage<TRelationExtractionOutput> {
    return llmStage<TRelationExtractionOutput>({
        id: STAGE_IDS.relationExtraction,
        dependsOn: [
            STAGE_IDS.claimCanonicalization,
            STAGE_IDS.claimTypeClassification,
            STAGE_IDS.segmentation,
        ],
        outputSchema: RelationExtractionOutputSchema,
        model: options?.model ?? RELATION_EXTRACTION_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort:
            options?.reasoningEffort ?? RELATION_EXTRACTION_REASONING,
        buildPrompt,
    })
}

/** Backward-compatible default-options stage. */
export const relationExtractionStage: TStage<TRelationExtractionOutput> =
    createRelationExtractionStage()
