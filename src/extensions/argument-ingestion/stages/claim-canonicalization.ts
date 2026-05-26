// `claim-canonicalization` — merges the raw mentions into a single
// canonical claim set. Each canonical claim carries:
//   - a miniId (c1, c2, ...) allocated by the stage
//   - the mentionIds it absorbed
//   - a `suggestedSymbol` — the canonicalizer's snake_case-shaped
//     proposal (validated downstream by variable-assignment)
//   - the extension's per-claim fields (e.g. for `basics`: a
//     discriminated union over `type` with title/body/url/axiom)
//
// `mentionToClaim` maps every mention id back to its assigned
// canonical claim's miniId — useful for downstream stages (and
// finalize) that want to trace evidence back to the text.
//
// Per spec §6.4 this is a strong-reasoning stage: `gpt-5.5` with
// `reasoningEffort: 'medium'`.

import Type, { type TSchema } from "typebox"
import {
    STAGE_IDS,
    type TAxiomIndicatorDetectionOutput,
    type TClaimMentionExtractionOutput,
    type TCitationSourceDetectionOutput,
    type TClaimCanonicalizationOutput,
} from "./schemas.js"
import { llmStage } from "../../../lib/pipelines/stage-helpers.js"
import { optional } from "../../../lib/pipelines/types.js"
import type { TStage, TStageContext } from "../../../lib/pipelines/types.js"
import type { TIngestionExtension, TIngestionInput } from "../shared/types.js"

export const CLAIM_CANONICALIZATION_MODEL = "gpt-5.5"
export const CLAIM_CANONICALIZATION_REASONING:
    | "minimal"
    | "low"
    | "medium"
    | "high" = "medium"

export const CLAIM_CANONICALIZATION_SYSTEM_PROMPT = `You merge raw claim mentions into a single canonical set of claims for an argument-ingestion pipeline.

You are given:
- the raw input text (for full context)
- the segmented breakdown of the text
- the list of every claim mention extracted from those segments
- optionally, the detected citation sources + axiom indicators

Your output has two parts:

1. \`canonicalClaims\` — an array of canonical claims, one entry per distinct proposition the author makes. Two mentions that assert the same proposition (even when phrased differently across the text) merge into a single canonical claim. Each canonical claim carries:
   - \`miniId\` — assign in canonicalization order: c1, c2, c3, ...
   - \`mentionIds\` — list of the mention ids that resolved to this claim
   - \`type\` — one of "normal", "citation", or "axiomatic" (see below)
   - \`suggestedSymbol\` — a short PascalCase-or-snake_case identifier summarizing the claim (e.g. "Rain_Wets_Ground", "NASA_Temp_Rise", "Socrates_Mortal"). Use letters, digits, and underscores only; start with a letter or underscore; keep under 32 characters; aim for under 20. AVOID single letters and generic names like "Claim1".
   - the extension fields described in your output schema (title, body, url, axiom — whichever apply to the claim's \`type\`)

2. \`mentionToClaim\` — a map from every mentionId in your input to its assigned canonical claim's miniId. Every mention id must appear exactly once. The mapping is total; do not drop mentions.

## Claim types

- \`"normal"\` — a primary proposition the argument argues for or from.
- \`"citation"\` — a claim whose content is "the cited source asserts X". Use this type when one of the citation sources covers the same span(s) as the mention. Populate \`url\` (the URL if present) and \`title\` (a short human-readable label).
- \`"axiomatic"\` — a claim invoked as self-evident truth. Use this type when an axiom indicator (e.g. "by definition") covers or precedes the mention. Populate \`axiom\` with the gist of the self-evident proposition.

When a mention is the antecedent of "according to X, P", split it into two claims: a citation-typed claim for the source itself + a normal-typed claim for the proposition. The two are connected via a relation in a later stage, not here.

## Style

- Claim titles + bodies are written in third-person, present-tense, active voice.
- Titles are short (≤ 50 characters); bodies fill in the detail.
- For citation claims, the title summarizes what the source asserts (e.g. "NASA reports temperature rise"); the URL goes in \`url\`.
- For axiomatic claims, the \`axiom\` field captures the self-evident proposition (e.g. "A bachelor is an unmarried man by definition.").

Output ONLY the schema-shaped object. No prose.`

function buildResponseSchema(extension: TIngestionExtension): TSchema {
    return Type.Object(
        {
            canonicalClaims: Type.Array(
                buildClaimRecordSchema(extension.claimSchema)
            ),
            mentionToClaim: Type.Record(Type.String(), Type.String()),
        },
        { additionalProperties: false }
    )
}

function buildClaimRecordSchema(claimSchema: TSchema): TSchema {
    // claimSchema is the extension's claim shape — often a
    // discriminated union over `type`. We need to inject the
    // canonicalizer-owned fields (miniId / mentionIds / suggestedSymbol)
    // into each branch.
    const canonicalFields = {
        miniId: Type.String({
            description: "Sequential canonicalization id (c1, c2, ...).",
        }),
        mentionIds: Type.Array(Type.String(), {
            description: "Mention ids merged into this canonical claim.",
        }),
        suggestedSymbol: Type.String({
            description:
                "Snake_case / PascalCase identifier proposal for the claim's logical variable. ≤ 32 chars; letters / digits / underscores; starts with letter or underscore.",
        }),
    }
    const ext = claimSchema as Record<string, unknown>
    const anyOf = ext.anyOf as TSchema[] | undefined
    if (Array.isArray(anyOf)) {
        const branches = anyOf.map((branch) => {
            const branchProps = (branch as Record<string, unknown>)
                .properties as Record<string, TSchema> | undefined
            if (!branchProps) {
                throw new Error(
                    "claim-canonicalization: union extension branches must be object schemas."
                )
            }
            return Type.Object(
                { ...canonicalFields, ...branchProps },
                { additionalProperties: false }
            )
        })
        return Type.Union(branches)
    }
    const objProps = ext.properties as Record<string, TSchema> | undefined
    if (!objProps) {
        throw new Error(
            "claim-canonicalization: extension claimSchema must be a Type.Object or a Type.Union of Type.Objects."
        )
    }
    return Type.Object(
        { ...canonicalFields, ...objProps },
        { additionalProperties: false }
    )
}

function buildPrompt(ctx: TStageContext): { system: string; user: string } {
    const input = ctx.input as TIngestionInput
    const mentionEnvelope = ctx.get<TClaimMentionExtractionOutput>(
        STAGE_IDS.claimMentionExtraction
    )
    const mentions = mentionEnvelope?.mentions ?? []
    const citationEnvelope = ctx.get<TCitationSourceDetectionOutput>(
        STAGE_IDS.citationSourceDetection
    )
    const citations = citationEnvelope?.sources ?? []
    const axiomEnvelope = ctx.get<TAxiomIndicatorDetectionOutput>(
        STAGE_IDS.axiomIndicatorDetection
    )
    const axioms = axiomEnvelope?.axioms ?? []

    const mentionLines = mentions
        .map(
            (m) =>
                `  [${m.mentionId} @ ${m.segmentId}] ${JSON.stringify(m.text)}`
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

    const markedSystem = `<!-- stage-id: ${STAGE_IDS.claimCanonicalization} -->\n${CLAIM_CANONICALIZATION_SYSTEM_PROMPT}`
    const user = `Input text:\n\n${input.text}\n\nClaim mentions:\n${mentionLines}\n\nDetected citation sources:\n${citationLines}\n\nDetected axiom indicators:\n${axiomLines}\n\nProduce the canonicalClaims + mentionToClaim object.`
    return { system: markedSystem, user }
}

/**
 * Builds the `claim-canonicalization` stage for the supplied
 * extension. The stage's `outputSchema` carries the extension's
 * per-claim fields, so the LLM's structured-output schema matches the
 * extension's claim shape (e.g. for `basics`: a discriminated union
 * over `type`).
 */
export function createClaimCanonicalizationStage(
    extension: TIngestionExtension
): TStage<TClaimCanonicalizationOutput> {
    return llmStage<TClaimCanonicalizationOutput>({
        id: STAGE_IDS.claimCanonicalization,
        dependsOn: [
            STAGE_IDS.claimMentionExtraction,
            optional(STAGE_IDS.citationSourceDetection),
            optional(STAGE_IDS.axiomIndicatorDetection),
        ],
        outputSchema: buildResponseSchema(extension),
        model: CLAIM_CANONICALIZATION_MODEL,
        reasoningEffort: CLAIM_CANONICALIZATION_REASONING,
        buildPrompt,
    })
}
