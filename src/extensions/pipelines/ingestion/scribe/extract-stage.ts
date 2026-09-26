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
 * after `settleCitations` has checked their urls and merged citations of
 * the same page.
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
            const settled = settleCitations(
                ctx.get<TScribeExtractOutput>(STAGE_IDS.extract),
                (ctx.input as TIngestionInput).text,
                ctx.addFailure
            )
            return {
                canonicalClaims: settled?.canonicalClaims ?? [],
                mentionToClaim: settled?.mentionToClaim ?? [],
            }
        },
    })
}

type TAddFailure = TStageContext["addFailure"]

/**
 * `extract`'s output with its citations settled: a url the input does not
 * contain is cleared (`SOURCE_URL_NOT_IN_TEXT_FAILURE_CODE`), one it
 * contains in a slightly different form takes the text's form, and
 * citations of the same page are merged into one
 * (`SOURCE_DUPLICATE_MERGED_FAILURE_CODE`) — the first, unless it is an
 * archive copy and the original is also cited. The kept citation takes
 * the merged ones' mentions and supports what any of them supported.
 *
 * Deterministic, so every stage that reads `extract` directly can call it
 * and see the same claim set; only one of them should report.
 */
export function settleCitations(
    extract: TScribeExtractOutput | undefined,
    inputText: string,
    addFailure: TAddFailure
): TScribeExtractOutput | undefined {
    if (extract === undefined) return undefined
    const claims = extract.canonicalClaims.map((claim) => {
        const url = (claim as Record<string, unknown>).url
        if (
            claim.type !== "citation" ||
            typeof url !== "string" ||
            url.trim().length === 0
        )
            return claim
        const found = findUrlInText(url.trim(), inputText)
        if (found !== undefined) return { ...claim, url: found }
        addFailure({
            code: SOURCE_URL_NOT_IN_TEXT_FAILURE_CODE,
            message: `Citation "${claim.miniId}" gave the url "${url}", which does not appear in the input; the url was cleared and the citation kept.`,
            severity: "warning",
            context: { miniId: claim.miniId, url },
        })
        return { ...claim, url: "" }
    })

    const groups = new Map<string, typeof claims>()
    for (const claim of claims) {
        const url = (claim as Record<string, unknown>).url
        if (claim.type !== "citation" || typeof url !== "string" || url === "")
            continue
        const key = citationUrlKey(url)
        groups.set(key, [...(groups.get(key) ?? []), claim])
    }
    const keptByMiniId = new Map<string, string>()
    const mergedMentions = new Map<string, string[]>()
    for (const group of groups.values()) {
        if (group.length < 2) continue
        const kept =
            group.find(
                (c) =>
                    !ARCHIVE_URL.test(
                        (c as Record<string, unknown>).url as string
                    )
            ) ?? group[0]
        const merged = group.filter((c) => c !== kept)
        for (const c of merged) keptByMiniId.set(c.miniId, kept.miniId)
        mergedMentions.set(kept.miniId, [
            ...new Set(group.flatMap((c) => [...c.mentionIds])),
        ])
        addFailure({
            code: SOURCE_DUPLICATE_MERGED_FAILURE_CODE,
            message: `Citations ${merged.map((c) => `"${c.miniId}"`).join(", ")} cite the same page as "${kept.miniId}" and were merged into it.`,
            severity: "warning",
            context: {
                keptMiniId: kept.miniId,
                mergedMiniIds: merged.map((c) => c.miniId),
            },
        })
    }
    if (keptByMiniId.size === 0) return { ...extract, canonicalClaims: claims }

    const resolve = (miniId: string) => keptByMiniId.get(miniId) ?? miniId
    const seenSupport = new Set<string>()
    return {
        ...extract,
        canonicalClaims: claims
            .filter((c) => !keptByMiniId.has(c.miniId))
            .map((c) => {
                const mentionIds = mergedMentions.get(c.miniId)
                return mentionIds === undefined ? c : { ...c, mentionIds }
            }),
        mentionToClaim: extract.mentionToClaim.map((entry) => ({
            ...entry,
            claimMiniId: resolve(entry.claimMiniId),
        })),
        sourceSupport: extract.sourceSupport.flatMap((entry) => {
            const settled = {
                sourceMiniId: resolve(entry.sourceMiniId),
                supportedMiniId: resolve(entry.supportedMiniId),
            }
            const key = `${settled.sourceMiniId}\u0000${settled.supportedMiniId}`
            if (seenSupport.has(key)) return []
            seenSupport.add(key)
            return [settled]
        }),
    }
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
 * Warning code for citations merged because their urls name the same page.
 * A reference list often links one work several ways — an archive copy
 * beside the original, `/index.html` beside `/` — and each became its own
 * citation claim. `context` carries `keptMiniId` and `mergedMiniIds`.
 */
export const SOURCE_DUPLICATE_MERGED_FAILURE_CODE = "SOURCE_DUPLICATE_MERGED"

/** A Wayback Machine copy: `web.archive.org/web/<timestamp>[flag_]/<url>`. */
const ARCHIVE_URL =
    /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?web\.archive\.org\/web\/\d+[a-z_]*\/(.+)$/i

/**
 * What two citation urls must share to name the same page: the url with
 * an archive copy unwrapped to its original, http and https treated alike,
 * the host lowercased and without a leading "www.", a trailing
 * "index.html" or "index.htm" and a trailing slash dropped, and a DOI
 * read the same through either resolver with its path percent-decoded.
 * The fragment is kept: it names a place in the page, as a page number
 * names one in a book.
 */
export function citationUrlKey(url: string): string {
    const archived = ARCHIVE_URL.exec(url.trim())
    if (archived !== null) return citationUrlKey(archived[1])
    const match =
        /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(
            url.trim()
        )
    if (match === null) return url.trim()
    const scheme = match[1].toLowerCase()
    let host = match[2].toLowerCase().replace(/^www\./, "")
    let path = match[3].replace(/\/index\.html?$/i, "").replace(/\/$/, "")
    if (host === "dx.doi.org" || host === "doi.org") {
        host = "doi.org"
        path = safeDecodeUri(path)
    }
    const prefix = scheme === "http" || scheme === "https" ? "" : `${scheme}:`
    return `${prefix}//${host}${path}${match[4] ?? ""}${match[5] ?? ""}`
}

function safeDecodeUri(text: string): string {
    try {
        return decodeURIComponent(text)
    } catch {
        return text
    }
}

/**
 * The url as the input writes it, if the input contains it: the same link
 * with only differences that cannot change where it goes — the case of the
 * scheme and host, http for https or the reverse, and a trailing slash.
 */
export function findUrlInText(url: string, text: string): string | undefined {
    const match = /^([a-z][a-z0-9+.-]*):(\/\/[^/?#]*)(.*)$/i.exec(url)
    if (match === null) return undefined
    const scheme = match[1].toLowerCase()
    const isWeb = scheme === "http" || scheme === "https"
    const authority = match[2].toLowerCase()
    const path = match[3].replace(/\/$/, "")
    const lowerText = text.toLowerCase()
    for (
        let at = lowerText.indexOf(authority);
        at !== -1;
        at = lowerText.indexOf(authority, at + 1)
    ) {
        const textScheme = /([a-z][a-z0-9+.-]*):$/.exec(
            lowerText.slice(Math.max(0, at - 16), at)
        )?.[1]
        if (
            textScheme === undefined ||
            (isWeb
                ? textScheme !== "http" && textScheme !== "https"
                : textScheme !== scheme)
        )
            continue
        const rest = text.slice(at + authority.length)
        if (!rest.startsWith(path)) continue
        // The text's link must end where this one does, give or take its
        // own trailing slash, so neither a longer host nor a longer path
        // matches. Punctuation closing a sentence or clause is not part of
        // a link.
        const trailingSlash = rest.startsWith("/", path.length) ? 1 : 0
        const after = rest.slice(path.length + trailingSlash)
        if (/^[.,;:!?]?[^\s)\]>"'<.,;:!?]/.test(after)) continue
        return text.slice(
            at - textScheme.length - 1,
            at + authority.length + path.length + trailingSlash
        )
    }
    return undefined
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
