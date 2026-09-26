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

export const EXTRACT_MODEL = "gpt-6-sol"

/** Internal default knobs for scribe's `extract` stage. */
export const EXTRACT_STAGE_DEFAULTS: TLlmStageOptionsOverride = {
    model: EXTRACT_MODEL,
}

export const EXTRACT_SYSTEM_PROMPT = `You read a raw argument and emit its canonical claim set in one pass.

For each distinct proposition the author makes, emit one canonical claim. Two phrasings of the same proposition merge into a single claim.

Every explicit link or URL the author offers as evidence becomes its own citation claim — one per distinct link, even when several links sit in one sentence or a link backs a claim you also emit as a normal claim.

Lines that begin with "> " quote someone else, usually the person the author is replying to. They are not the author's claims: never emit a claim from them, and use them only to understand what the author is responding to.

Also emit \`mentions\` — where in the input each claim is stated. One entry per place a claim is made:
- \`mentionId\` — "<claim miniId>-m" for the first mention of a claim, then "-m2", "-m3", ... for further ones (e.g. "c1-m", "c1-m2").
- \`text\` — the span of the input that states the claim, COPIED CHARACTER FOR CHARACTER from the input. Never reword, summarize, translate, correct, or join separated passages with an ellipsis, and do not change capitalization or punctuation — copy the first character exactly as the input has it, upper- or lower-case. Prefer the shortest span that states the claim on its own — usually one sentence or clause. A span that is not present in the input verbatim is discarded, and the claim loses its link back to the source.
- \`span\` — approximate \`{ start, end }\` character offsets of that text in the input. A rough estimate is fine; the text is what is trusted.
- \`segmentId\` — the empty string.

Each canonical claim carries:
- \`miniId\` — assign in order: c1, c2, c3, ...
- \`mentionIds\` — the \`mentionId\`s of every mention that states this claim.
- \`type\` — "normal" (a primary proposition), "citation" (content is "the cited source asserts X"; populate \`url\` + \`title\`, and set \`citationTypeGuess\`), or "axiomatic" (invoked as self-evident; populate \`axiom\`).
- \`url\` (citation claims only) — a URL copied from the input exactly as written, scheme included. Never build one from a site name, domain or title ("www.example.org" is not "https://www.example.org/"); when the input gives the source no URL, use the empty string.
- \`citationTypeGuess\` (citation claims only) — your best guess at the source's IEEE reference type, chosen from the allowed values in your output schema (e.g. "JournalArticle", "NewspaperArticle", "Book", "Website", "GovernmentPublication", …). Use "unknown" when no IEEE type fits or you cannot tell.
- \`suggestedSymbol\` — a short PascalCase-or-snake_case identifier (letters/digits/underscores, starts with a letter or underscore, under 32 chars). Avoid single letters and generic names.
- the extension fields your output schema requires (title, body, url, axiom — whichever apply to the claim's type).
- \`mentionToClaim\` — one \`{ "mentionId": "...", "claimMiniId": "..." }\` entry per mention id you used.
- \`sourceSupport\` — one \`{ "sourceMiniId": "...", "supportedMiniId": "..." }\` entry per citation claim and per axiomatic claim: its miniId, and the miniId of the normal claim it is offered as evidence for, or invoked to justify — usually the claim stated in the same sentence, or just before it. The supported claim must be a normal claim, never a citation or axiomatic one.

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
    const user = `Input text:\n\n${input.text}\n\nProduce the canonicalClaims + mentions + mentionToClaim + sourceSupport object.`
    return { system, user }
}

/**
 * Build scribe's `extract` LLM stage. Its `outputSchema` is the
 * per-extension canonicalization schema widened with the mention slot,
 * so the cheap model is asked for the same extension-shaped claim
 * records (title/body/url/axiom) scholar's canonicalizer produces —
 * without which finalize would assemble empty claims — plus the quoted
 * spans those claims came from, plus which claim each source supports.
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
 * canonicalization slot scholar's deterministic stages + finalize read,
 * clearing any citation url the input does not contain
 * (`SOURCE_URL_NOT_IN_TEXT_FAILURE_CODE`).
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
            const inputText = (ctx.input as TIngestionInput).text
            return {
                canonicalClaims: (extract?.canonicalClaims ?? []).map(
                    (claim) => {
                        const url = (claim as Record<string, unknown>).url
                        if (
                            claim.type !== "citation" ||
                            typeof url !== "string" ||
                            url.trim().length === 0 ||
                            isUrlInText(url.trim(), inputText)
                        )
                            return claim
                        ctx.addFailure({
                            code: SOURCE_URL_NOT_IN_TEXT_FAILURE_CODE,
                            message: `Citation "${claim.miniId}" gave the url "${url}", which does not appear in the input; the url was cleared and the citation kept.`,
                            severity: "warning",
                            context: { miniId: claim.miniId, url },
                        })
                        return { ...claim, url: "" }
                    }
                ),
                mentionToClaim: extract?.mentionToClaim ?? [],
            }
        },
    })
}

/**
 * Warning code for a citation url `extract` reported that the input does
 * not contain. A model asked for a source's url will build one from a bare
 * site name ("www.gutenberg.org" in a reference list becomes
 * "https://www.gutenberg.org/"), and a link the author never gave is worse
 * than none — so the url is cleared and the citation kept, since the
 * source itself is still named in the text.
 */
export const SOURCE_URL_NOT_IN_TEXT_FAILURE_CODE = "SOURCE_URL_NOT_IN_TEXT"

/**
 * Whether `url` appears in `text` as written, scheme included, allowing
 * only differences that cannot change where the link goes: the case of the
 * scheme and host, and a trailing slash.
 */
export function isUrlInText(url: string, text: string): boolean {
    const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i.exec(url)
    if (match === null) return false
    const origin = match[1].toLowerCase()
    const path = match[2].replace(/\/$/, "")
    const lowerText = text.toLowerCase()
    for (
        let at = lowerText.indexOf(origin);
        at !== -1;
        at = lowerText.indexOf(origin, at + 1)
    ) {
        const rest = text.slice(at + origin.length)
        // The text's link must end where this one does, give or take its
        // own trailing slash, so neither a longer host nor a longer path
        // matches. A sentence's closing full stop is not part of a link.
        if (
            rest.startsWith(path) &&
            !/^\.?[\w\-~%]/.test(rest.slice(path.length))
        )
            return true
    }
    return false
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
 * Adapter — derive the classification slot from the canonical claim
 * records: each one already carries its `type`, so the classification
 * entry is `{ miniId, type, sourceString }`. `sourceString` is the claim's
 * `url` when present (citation claims), else null — mirroring what
 * scholar's classification stage records. It reads the canonicalization
 * slot rather than `extract` itself, so a url that adapter cleared is not
 * carried here.
 */
export const extractClassificationAdapterStage: TStage<TClaimTypeClassificationOutput> =
    deterministicStage<TClaimTypeClassificationOutput>({
        id: STAGE_IDS.claimTypeClassification,
        dependsOn: [STAGE_IDS.claimCanonicalization],
        outputSchema: ClaimTypeClassificationOutputSchema,
        fn: (ctx) => {
            const canon = ctx.get<TClaimCanonicalizationOutput>(
                STAGE_IDS.claimCanonicalization
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
