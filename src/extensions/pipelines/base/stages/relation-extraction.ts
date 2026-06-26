// `relation-extraction` — strong-reasoning stage that identifies the
// inference relationships between canonical claims. Each relation is an
// `inference`: its `antecedents` claims, taken together, imply its
// `consequent` claim.
//
// This stage uses gpt-5.5 with reasoning_effort=high — it's the most
// subtle judgement call in the pipeline. The output is a graph; the
// conclusion + the inference graph drive the formula-compilation stage
// that comes next.

import {
    STAGE_IDS,
    RelationExtractionOutputSchema,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
} from "./schemas.js"
import { llmStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"
import type { TLlmStageOptionsOverride } from "../types.js"

export const RELATION_EXTRACTION_MODEL = "gpt-5.5"
export const RELATION_EXTRACTION_REASONING:
    | "minimal"
    | "low"
    | "medium"
    | "high" = "high"

export const RELATION_EXTRACTION_SYSTEM_PROMPT = `You identify inference relationships between canonical claims in an argument.

Given the canonical claim set, the per-claim type map, and the original segments, emit one entry per inference. Return an object with a single key \`relations\` whose value is the array.

An \`inference\` relation says: the claims in \`antecedents\`, taken together, imply the claim in \`consequent\`. Use a SINGLE antecedent for an ordinary "P, therefore Q" step; use MULTIPLE antecedents when the author commits to a step that requires ALL of them to hold together (e.g. major premise + minor premise → conclusion).

For each relation emit:
- a fresh \`relationId\` (r1, r2, ...)
- \`type\` — always \`"inference"\`
- \`antecedents\` — an array of the supporting claim miniIds (one or more) whose conjunction implies the consequent
- \`consequent\` — the implied claim's miniId
- \`evidence.segmentIds\` — the segments that ground the relation (often a single segment containing a "therefore", "so", "because")
- \`evidence.quote\` — a short verbatim quote from the input that justifies the relation

\`antecedents\` and \`consequent\` are CLAIM miniIds — NOT source citations. A citation-typed or axiomatic-typed claim may appear in \`antecedents\` (the pipeline routes it to where it belongs); do not special-case it. A citation/axiomatic claim is never a \`consequent\`.

## Conservatism rules

- Do not invent relations. If the author doesn't actually argue from the antecedents to the consequent, don't emit a relation.
- Do not double-count. If several claims share the same backing, emit one relation per consequent, not a redundant pairing.
- The conclusion of the argument is identified in a separate stage; do NOT emit a special "conclusion" relation here. Just emit the inference edges you see; the conclusion stage selects from your output.
- Avoid attack/rebuttal relations entirely for now — the pipeline does not yet handle them.

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
    const user = `Canonical claims (with refined types):\n${claimLines}\n\nSegments:\n${segmentLines}\n\nEmit every inference relationship as a relations array.`
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
        retry: options?.retry,
        buildPrompt,
    })
}

/** Backward-compatible default-options stage. */
export const relationExtractionStage: TStage<TRelationExtractionOutput> =
    createRelationExtractionStage()
