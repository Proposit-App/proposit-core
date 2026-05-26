// `claim-type-classification` — refines or confirms the canonicalizer's
// per-claim `type` field. The canonicalizer already drafted a type
// based on whether a citation or axiom indicator covered the claim;
// this stage is a second pass that catches mis-classifications (e.g.
// a claim the canonicalizer marked "normal" that actually belongs to
// "citation" because the source's content equals the claim's content).

import {
    STAGE_IDS,
    ClaimTypeClassificationOutputSchema,
    type TAxiomIndicatorDetectionOutput,
    type TCitationSourceDetectionOutput,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import { optional } from "../../../lib/pipelines/types.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"

export const CLAIM_TYPE_CLASSIFICATION_MODEL = "gpt-5.4"

export const CLAIM_TYPE_CLASSIFICATION_SYSTEM_PROMPT = `You confirm or revise the type of each canonical claim in an argument-ingestion pipeline.

For each canonical claim you receive (id, the canonicalizer's draft \`type\`, and the claim's body/title/url/axiom fields), emit:
- the canonical \`type\`: one of "normal", "citation", "axiomatic"
- a \`sourceString\` — populate when type is "citation" with the source label (or url) the claim is built on; null otherwise

Use the supplied detected citation sources + axiom indicators as evidence. Override the canonicalizer's draft only when the evidence clearly contradicts it. The default is to confirm the draft. Be conservative — a wrong override here cascades into wrong support edges downstream.

Output a map keyed by canonical claim miniId; every input claim must appear in the output exactly once.

## Type rules

- \`"normal"\` — primary reasoning content; the default.
- \`"citation"\` — content is "the cited source says/shows X" AND a citation source covers the claim. The claim's title/body summarizes what the source asserts; the URL (when present) names the source.
- \`"axiomatic"\` — content is invoked as self-evidently true AND an axiom indicator (e.g. "by definition") covers or precedes the claim.`

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const canon = ctx.get<TClaimCanonicalizationOutput>(
        STAGE_IDS.claimCanonicalization
    )
    const citationEnvelope = ctx.get<TCitationSourceDetectionOutput>(
        STAGE_IDS.citationSourceDetection
    )
    const citations = citationEnvelope?.sources ?? []
    const axiomEnvelope = ctx.get<TAxiomIndicatorDetectionOutput>(
        STAGE_IDS.axiomIndicatorDetection
    )
    const axioms = axiomEnvelope?.axioms ?? []

    const claimLines = (canon?.canonicalClaims ?? [])
        .map(
            (c) =>
                `  [${c.miniId}] type=${c.type} suggestedSymbol=${c.suggestedSymbol} fields=${JSON.stringify(
                    {
                        ...c,
                        miniId: undefined,
                        mentionIds: undefined,
                        suggestedSymbol: undefined,
                        type: undefined,
                    }
                )}`
        )
        .join("\n")
    const citationLines =
        citations.length > 0
            ? citations
                  .map(
                      (c) =>
                          `  [${c.sourceId} @ ${c.segmentIds.join(",")}] ${JSON.stringify(c.sourceString)}${c.url ? ` (url: ${c.url})` : ""}`
                  )
                  .join("\n")
            : "  (none)"
    const axiomLines =
        axioms.length > 0
            ? axioms
                  .map(
                      (a) =>
                          `  [${a.axiomId} @ ${a.segmentIds.join(",")}] ${JSON.stringify(a.indicator)}`
                  )
                  .join("\n")
            : "  (none)"

    const markedSystem = `<!-- stage-id: ${STAGE_IDS.claimTypeClassification} -->\n${CLAIM_TYPE_CLASSIFICATION_SYSTEM_PROMPT}`
    const user = `Canonical claims (with the canonicalizer's draft type):\n${claimLines}\n\nDetected citation sources:\n${citationLines}\n\nDetected axiom indicators:\n${axiomLines}\n\nEmit the per-claim type map.`
    return { system: markedSystem, user }
}

export const claimTypeClassificationStage: TStage<TClaimTypeClassificationOutput> =
    llmStage<TClaimTypeClassificationOutput>({
        id: STAGE_IDS.claimTypeClassification,
        dependsOn: [
            STAGE_IDS.claimCanonicalization,
            optional(STAGE_IDS.citationSourceDetection),
            optional(STAGE_IDS.axiomIndicatorDetection),
        ],
        outputSchema: ClaimTypeClassificationOutputSchema,
        model: CLAIM_TYPE_CLASSIFICATION_MODEL,
        buildPrompt,
    })
