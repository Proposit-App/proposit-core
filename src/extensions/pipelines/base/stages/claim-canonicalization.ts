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
// This is a strong-reasoning stage: `gpt-5.5` with
// `reasoningEffort: 'medium'`.

import Type, { type TSchema } from "typebox"
import {
    MentionToClaimEntrySchema,
    STAGE_IDS,
    type TAxiomIndicatorDetectionOutput,
    type TClaimMentionExtractionOutput,
    type TCitationSourceDetectionOutput,
    type TClaimCanonicalizationOutput,
} from "./schemas.js"
import { llmStage } from "../../../../lib/pipelines/stage-helpers.js"
import { optional } from "../../../../lib/pipelines/types.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"
import type {
    TIngestionExtension,
    TIngestionInput,
    TLlmStageOptionsOverride,
} from "../types.js"

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

2. \`mentionToClaim\` — an array of \`{ "mentionId": "...", "claimMiniId": "..." }\` entries, one per input mention. Every input mentionId must appear in exactly one entry; the mapping is total. (We surface this as a list rather than a map because the response schema does not allow arbitrary string keys.)

## Claim types

- \`"normal"\` — a primary proposition the argument argues for or from.
- \`"citation"\` — a claim whose content is "the cited source asserts X". Use this type when one of the citation sources covers the same span(s) as the mention. Populate \`url\` (the URL if present), \`title\` (a short human-readable label), and \`citationTypeGuess\` (your best guess at the source's IEEE reference type, chosen from the allowed values in your output schema — e.g. "JournalArticle", "NewspaperArticle", "Book", "Website", "GovernmentPublication", … — or "unknown" when no IEEE type fits or you cannot tell).
- \`"axiomatic"\` — a claim invoked as self-evident truth. Use this type when an axiom indicator (e.g. "by definition") covers or precedes the mention. Populate \`axiom\` with the gist of the self-evident proposition.

When a mention is the antecedent of "according to X, P", split it into two claims: a citation-typed claim for the source itself + a normal-typed claim for the proposition. The two are connected via a relation in a later stage, not here.

## Style

- Claim titles + bodies are written in third-person, present-tense, active voice.
- State the proposition itself — never prepend an author-attributive reporting frame such as "The author claims that…", "The author argues…", "The writer believes…", or "According to the author…". Write *what is asserted*, not *that someone asserts it*: emit "Rain wets the ground," not "The author claims that rain wets the ground." This applies to the \`title\`, \`body\`, and \`axiom\` prose for the argument's own (normal / axiomatic) claims.
- Titles are short (≤ 50 characters); bodies fill in the detail.
- For citation claims, the title summarizes what the source asserts (e.g. "NASA reports temperature rise"); the URL goes in \`url\`. This source attribution is intentional and is NOT removed by the rule above — that rule targets only author-attribution of the argument's own claims, never the cited-source framing of a citation claim.
- For axiomatic claims, the \`axiom\` field captures the self-evident proposition as a bare declarative statement (e.g. "A bachelor is an unmarried man by definition.").

Output ONLY the schema-shaped object. No prose.`

/**
 * Build the per-extension canonicalization output schema: an object of
 * `canonicalClaims` (each carrying the canonicalizer fields merged with
 * the extension's claim fields) + `mentionToClaim`. Exported so a
 * cheaper pipeline whose single combined LLM call emits canonical
 * claims can request the identical extension-shaped output, keeping the
 * canonicalization slot's schema uniform across pipelines.
 */
export function buildResponseSchema(extension: TIngestionExtension): TSchema {
    return Type.Object(
        {
            canonicalClaims: Type.Array(
                buildClaimRecordSchema(extension.claimSchema)
            ),
            // List-shape (not Record/map) for OpenAI strict-mode
            // compatibility — see `MentionToClaimEntrySchema` docstring
            // in `./schemas.ts` for the OpenAI 400 chain that motivated
            // the shape change.
            mentionToClaim: Type.Array(MentionToClaimEntrySchema),
        },
        { additionalProperties: false }
    )
}

/**
 * Inject the canonicalizer-owned fields (miniId / mentionIds /
 * suggestedSymbol) into the extension's claim shape (a `Type.Object` or
 * a `Type.Union` of objects). Exported alongside `buildResponseSchema`
 * for reuse by alternate ingestion pipelines.
 */
export function buildClaimRecordSchema(claimSchema: TSchema): TSchema {
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

/** Internal default knobs for the claim-canonicalization stage. */
export const CLAIM_CANONICALIZATION_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: CLAIM_CANONICALIZATION_MODEL,
    reasoningEffort: CLAIM_CANONICALIZATION_REASONING,
}

/**
 * Builds the `claim-canonicalization` stage for the supplied
 * extension. The stage's `outputSchema` carries the extension's
 * per-claim fields, so the LLM's structured-output schema matches the
 * extension's claim shape (e.g. for `basics`: a discriminated union
 * over `type`).
 *
 * `options` overrides the stage's internal defaults
 * (`CLAIM_CANONICALIZATION_STAGE_DEFAULTS`). Threaded through by
 * `createScholarPipeline` per its `TIngestionLlmOptions` surface.
 */
export function createClaimCanonicalizationStage(
    extension: TIngestionExtension,
    options?: TLlmStageOptionsOverride
): TStage<TClaimCanonicalizationOutput> {
    return llmStage<TClaimCanonicalizationOutput>({
        id: STAGE_IDS.claimCanonicalization,
        dependsOn: [
            STAGE_IDS.claimMentionExtraction,
            optional(STAGE_IDS.citationSourceDetection),
            optional(STAGE_IDS.axiomIndicatorDetection),
        ],
        outputSchema: buildResponseSchema(extension),
        model: options?.model ?? CLAIM_CANONICALIZATION_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort:
            options?.reasoningEffort ?? CLAIM_CANONICALIZATION_REASONING,
        retry: options?.retry,
        buildPrompt,
    })
}
