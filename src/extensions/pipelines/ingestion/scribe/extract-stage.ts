// scribe stage 1 — `extract`: one cheap LLM call that produces the
// canonical claim set (the same per-extension canonicalization shape
// scholar's `claim-canonicalization` stage emits) plus the mentions that
// locate each claim in the input, collapsing scholar's segmentation,
// claim-mention, citation-source, axiom-indicator, canonicalization, and
// type-classification stages.
//
// Because a stage writes exactly one output slot, `extract` is paired
// with three deterministic adapter stages that republish its parts under
// the canonicalization, classification, and mention slots scholar's
// deterministic backend + `finalizeResponseV2` read.

import { llmStage } from "../../../../lib/pipelines/stage-helpers.js"
import { deterministicStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"
import {
    STAGE_IDS,
    buildResponseSchema,
    ClaimMentionExtractionOutputSchema,
    ClaimTypeClassificationOutputSchema,
    type TClaimCanonicalizationOutput,
    type TClaimMentionExtractionOutput,
    type TClaimTypeClassificationOutput,
} from "../../base/stages/index.js"
import type {
    TIngestionExtension,
    TIngestionInput,
    TLlmStageOptionsOverride,
} from "../../base/types.js"
import {
    buildExtractOutputSchema,
    type TScribeExtractOutput,
} from "./schemas.js"

export const EXTRACT_MODEL = "gpt-5.4-mini"

/** Internal default knobs for scribe's `extract` stage. */
export const EXTRACT_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: EXTRACT_MODEL,
}

export const EXTRACT_SYSTEM_PROMPT = `You read a raw argument and emit its canonical claim set in one pass.

For each distinct proposition the author makes, emit one canonical claim. Two phrasings of the same proposition merge into a single claim.

Also emit \`mentions\` — where in the input each claim is stated. One entry per place a claim is made:
- \`mentionId\` — "<claim miniId>-m" for the first mention of a claim, then "-m2", "-m3", ... for further ones (e.g. "c1-m", "c1-m2").
- \`text\` — the span of the input that states the claim, COPIED CHARACTER FOR CHARACTER from the input. Never reword, summarize, translate, correct, or join separated passages with an ellipsis, and do not change capitalization or punctuation — copy the first character exactly as the input has it, upper- or lower-case. Prefer the shortest span that states the claim on its own — usually one sentence or clause. A span that is not present in the input verbatim is discarded, and the claim loses its link back to the source.
- \`span\` — approximate \`{ start, end }\` character offsets of that text in the input. A rough estimate is fine; the text is what is trusted.
- \`segmentId\` — the empty string.

Each canonical claim carries:
- \`miniId\` — assign in order: c1, c2, c3, ...
- \`mentionIds\` — the \`mentionId\`s of every mention that states this claim.
- \`type\` — "normal" (a primary proposition), "citation" (content is "the cited source asserts X"; populate \`url\` + \`title\`, and set \`citationTypeGuess\`), or "axiomatic" (invoked as self-evident; populate \`axiom\`).
- \`citationTypeGuess\` (citation claims only) — your best guess at the source's IEEE reference type, chosen from the allowed values in your output schema (e.g. "JournalArticle", "NewspaperArticle", "Book", "Website", "GovernmentPublication", …). Use "unknown" when no IEEE type fits or you cannot tell.
- \`suggestedSymbol\` — a short PascalCase-or-snake_case identifier (letters/digits/underscores, starts with a letter or underscore, under 32 chars). Avoid single letters and generic names.
- the extension fields your output schema requires (title, body, url, axiom — whichever apply to the claim's type).
- \`mentionToClaim\` — one \`{ "mentionId": "...", "claimMiniId": "..." }\` entry per mention id you used.

Style:
- Third-person, present-tense, active voice.
- State the proposition itself — never "The author claims that ...". For a citation claim, the title summarizes what the source asserts.

Output ONLY the schema-shaped object. No prose.`

function buildExtractPrompt(ctx: TStageContext): {
    system: string
    user: string
} {
    const input = ctx.input as TIngestionInput
    const system = `<!-- stage-id: ${STAGE_IDS.extract} -->\n${EXTRACT_SYSTEM_PROMPT}`
    const user = `Input text:\n\n${input.text}\n\nProduce the canonicalClaims + mentions + mentionToClaim object.`
    return { system, user }
}

/**
 * Build scribe's `extract` LLM stage. Its `outputSchema` is the
 * per-extension canonicalization schema widened with the mention slot,
 * so the cheap model is asked for the same extension-shaped claim
 * records (title/body/url/axiom) scholar's canonicalizer produces —
 * without which finalize would assemble empty claims — plus the quoted
 * spans those claims came from.
 */
export function createExtractStage(
    extension: TIngestionExtension,
    options?: TLlmStageOptionsOverride
): TStage<TScribeExtractOutput> {
    return llmStage<TScribeExtractOutput>({
        id: STAGE_IDS.extract,
        dependsOn: [],
        outputSchema: buildExtractOutputSchema(extension),
        model: options?.model ?? EXTRACT_MODEL,
        maxOutputTokens: options?.maxOutputTokens,
        reasoningEffort: options?.reasoningEffort,
        retry: options?.retry,
        buildPrompt: buildExtractPrompt,
    })
}

/**
 * Adapter — republish `extract`'s canonical claims under the
 * canonicalization slot scholar's deterministic stages + finalize read.
 *
 * It picks the two keys rather than passing the whole output through:
 * the canonicalization envelope is `additionalProperties: false`, so
 * `extract`'s `mentions` would fail validation here. They reach finalize
 * through the mention adapter below instead.
 *
 * Built per-extension because the canonicalization slot's schema carries
 * the extension's claim fields.
 */
export function createExtractCanonicalizationAdapterStage(
    extension: TIngestionExtension
): TStage<TClaimCanonicalizationOutput> {
    return deterministicStage<TClaimCanonicalizationOutput>({
        id: STAGE_IDS.claimCanonicalization,
        dependsOn: [STAGE_IDS.extract],
        outputSchema: buildResponseSchema(extension),
        fn: (ctx) => {
            const extract = ctx.get<TScribeExtractOutput>(STAGE_IDS.extract)
            return {
                canonicalClaims: extract?.canonicalClaims ?? [],
                mentionToClaim: extract?.mentionToClaim ?? [],
            }
        },
    })
}

/**
 * Adapter — republish `extract`'s mentions under the mention slot
 * finalize resolves into each claim's source anchors.
 *
 * Scribe has no segmentation stage, and needs none: a mention's `span`
 * is only ever a tie-break hint between repeated occurrences, and with
 * no segment to offset from, `buildAnchorByMentionId` falls back to the
 * mention's own reported start. The quoted text is what is located.
 */
export const extractMentionAdapterStage: TStage<TClaimMentionExtractionOutput> =
    deterministicStage<TClaimMentionExtractionOutput>({
        id: STAGE_IDS.claimMentionExtraction,
        dependsOn: [STAGE_IDS.extract],
        outputSchema: ClaimMentionExtractionOutputSchema,
        fn: (ctx) => ({
            mentions:
                ctx.get<TScribeExtractOutput>(STAGE_IDS.extract)?.mentions ??
                [],
        }),
    })

/**
 * Adapter — derive the classification slot from `extract`'s claim
 * records: each canonical claim already carries its `type`, so the
 * classification entry is `{ miniId, type, sourceString }`.
 * `sourceString` is the claim's `url` when present (citation claims),
 * else null — mirroring what scholar's classification stage records.
 */
export const extractClassificationAdapterStage: TStage<TClaimTypeClassificationOutput> =
    deterministicStage<TClaimTypeClassificationOutput>({
        id: STAGE_IDS.claimTypeClassification,
        dependsOn: [STAGE_IDS.extract],
        outputSchema: ClaimTypeClassificationOutputSchema,
        fn: (ctx) => {
            const canon = ctx.get<TClaimCanonicalizationOutput>(
                STAGE_IDS.extract
            )
            const claims = canon?.canonicalClaims ?? []
            return {
                classifications: claims.map((c) => {
                    const url = (c as Record<string, unknown>).url
                    const sourceString =
                        typeof url === "string" && url.length > 0 ? url : null
                    return { miniId: c.miniId, type: c.type, sourceString }
                }),
            }
        },
    })
