// `finalize-response-v2` — assembles the v2 multi-stage pipeline's
// final `TParsedArgumentResponse`-shaped output from accumulated
// per-stage outputs.
//
// Behavior per spec §7.2 finalize row + §7.4 (role derivation) +
// §7.5 (failure model):
//
//   - When `claim-canonicalization.canonicalClaims` is empty:
//     `{ argument: null, failureText: "No claims could be extracted
//     from the input.", uncategorizedText: null,
//     selectionRationale: null, processingFailures: [] }`.
//
//   - When `formula-compilation.conclusionPremiseMiniId` is null
//     (conclusion-selection returned null, or the conclusion claim
//     wasn't resolvable to a symbol): `{ argument: null,
//     failureText: "No single conclusion could be selected.", ... }`.
//
//   - Otherwise: assemble the full argument from the canonical claims
//     (with per-claim role derived from `relation-extraction` +
//     `conclusion-selection`), the variables from `variable-assignment`,
//     and the premises from `formula-compilation`. The `selectionRationale`
//     field is `conclusion-selection.rationale` (or null when the
//     stage is missing).
//
// **`processingFailures` slot.** Mirroring v1's convention, finalize
// always emits an empty `processingFailures: []` array on the output.
// The full list of per-stage failures lives on `PipelineResult.failures`
// — consumers that want them read that field. The slot on the response
// object is a forward-compat hook; the framework doesn't have a clean
// way for `finalize.run` to consult the executor's accumulated failure
// list (which would require widening `TStageContext`).

import type { TParsedArgumentResponse } from "../../../lib/parsing/index.js"
import type { TStageContext } from "../../../lib/pipelines/index.js"
import {
    STAGE_IDS,
    type TClaimCanonicalizationOutput,
    type TClaimMentionExtractionOutput,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TCompiledPremise,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TInferenceRelation,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
    type TVariableAssignmentOutput,
} from "./stages/schemas.js"
import {
    locateSourceAnchor,
    type TIngestionSourceAnchor,
} from "./source-anchors.js"
import type { TIngestionExtension, TIngestionInput } from "./types.js"
import { IEEE_REFERENCE_TYPES } from "../../citations/ieee/references.js"
import type {
    TUnparsedCitation,
    TUnparsedCitationTypeGuess,
} from "../../citations/unparsed/index.js"

// The valid `citationTypeGuess` values — the 33 IEEE reference types
// plus the explicit "unknown" fallback. Built from the IEEE list so the
// sanitizer stays in lockstep with the reference-type schema.
const VALID_CITATION_TYPE_GUESSES = new Set<TUnparsedCitationTypeGuess>([
    ...IEEE_REFERENCE_TYPES,
    "unknown",
])

/**
 * Coerce an LLM-emitted citation-type guess into the valid guess enum,
 * clamping anything absent or out-of-enum to "unknown". The model is
 * never trusted to stay in-enum, so its raw value is validated here
 * rather than relied upon.
 */
function sanitizeCitationTypeGuess(raw: unknown): TUnparsedCitationTypeGuess {
    if (
        typeof raw === "string" &&
        VALID_CITATION_TYPE_GUESSES.has(raw as TUnparsedCitationTypeGuess)
    ) {
        return raw as TUnparsedCitationTypeGuess
    }
    return "unknown"
}

/**
 * Build the `UnparsedCitation` attached to a claim that finalize keeps
 * typed `citation`. The display `text` is the claim's authored title,
 * falling back to the type-classifier's recorded `sourceString` and
 * finally the claim miniId so the text is never empty. The guess is
 * sanitized; a present, non-empty url is carried, else omitted.
 */
function buildUnparsedCitation(args: {
    title: string | undefined
    sourceString: string | null | undefined
    rawGuess: unknown
    url: unknown
    fallbackText: string
}): TUnparsedCitation {
    const text =
        firstNonEmptyString(args.title) ??
        firstNonEmptyString(args.sourceString) ??
        args.fallbackText
    const citation: TUnparsedCitation = {
        type: "unparsed",
        text,
        citationTypeGuess: sanitizeCitationTypeGuess(args.rawGuess),
    }
    const url = firstNonEmptyString(args.url)
    if (url !== undefined) {
        citation.url = url
    }
    return citation
}

/** Return a trimmed non-empty string, or undefined for anything else. */
function firstNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}

export const FINALIZE_V2_FAILURE_TEXTS = {
    noClaims: "No claims could be extracted from the input.",
    noConclusion: "No single conclusion could be selected.",
} as const

type TPremiseFinalForm = {
    miniId: string
    formula: string
    title: string
} & Record<string, unknown>

type TClaimFinalForm = {
    miniId: string
    role: "premise" | "conclusion" | "intermediate"
} & Record<string, unknown>

type TVariableFinalForm = {
    miniId: string
    symbol: string
    claimMiniId: string
} & Record<string, unknown>

type TArgumentFinalForm = {
    claims: TClaimFinalForm[]
    variables: TVariableFinalForm[]
    premises: TPremiseFinalForm[]
    conclusionPremiseMiniId: string
} & Record<string, unknown>

function buildClaimToRole(args: {
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"]
    /** Bare relations array (unwrapped from the stage's envelope). */
    relations: TRelationExtractionOutput["relations"]
    conclusionMiniId: string | null
}): Record<string, "premise" | "conclusion" | "intermediate"> {
    const out: Record<string, "premise" | "conclusion" | "intermediate"> = {}
    // Claims that participate in any relation (source or target) are
    // "premise" by default; claims that don't appear in any relation
    // are "intermediate" (per spec §7.4). The conclusion overrides.
    const claimsInRelations = new Set<string>()
    for (const rel of args.relations) {
        for (const antecedent of rel.antecedents)
            claimsInRelations.add(antecedent)
        claimsInRelations.add(rel.consequent)
    }
    for (const claim of args.canonicalClaims) {
        if (claim.miniId === args.conclusionMiniId) {
            out[claim.miniId] = "conclusion"
        } else if (claimsInRelations.has(claim.miniId)) {
            out[claim.miniId] = "premise"
        } else {
            out[claim.miniId] = "intermediate"
        }
    }
    return out
}

function stripCanonicalizerOnlyFields(
    claim: Record<string, unknown>
): Record<string, unknown> {
    // The canonicalizer's per-claim record carries `mentionIds` and
    // `suggestedSymbol` which are not part of the public response
    // schema. Strip them from the finalize output: the variable's
    // `symbol` carries the assigned identifier, and mention ids name an
    // id space the response never carries — the provenance they trace is
    // resolved into `sourceAnchors` instead, which a consumer can act on.
    const stripped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(claim)) {
        if (key === "mentionIds" || key === "suggestedSymbol") continue
        stripped[key] = value
    }
    return stripped
}

// -- Source anchors --
//
// The pipeline knows where each claim and each inference came from, but
// only as data spread across three stages: `segmentation` holds
// input-relative segment spans, `claim-mention-extraction` holds
// *segment-relative* mention spans plus the mention text, and
// `relation-extraction` holds a quote per relation. Finalize is the
// first place all three are in scope at once, so it is where they become
// a usable reference back into the input.
//
// Only quoted text crosses the boundary as fact; the model's offsets are
// used to choose among repeated occurrences and are never emitted
// unverified. See `source-anchors.ts`.

/**
 * Where each segment actually begins in the input.
 *
 * The segmentation prompt requires `segment.text` be copied verbatim, so
 * the true offset is recoverable by searching — and searching is what
 * this does, because the model's own `span.start` drifts. Measured on
 * recorded runs it runs short by one per segment and accumulates with
 * document length, which is invisible until a quote repeats and the
 * drifted hint picks the wrong occurrence.
 *
 * Segments are emitted left to right and cover the input, so the scan
 * carries a cursor rather than searching from zero: that keeps a segment
 * whose text repeats earlier in the document from collapsing onto the
 * earlier copy. A segment that cannot be found (the model rewrote it)
 * falls back to its own number and does not advance the cursor.
 */
function resolveSegmentStarts(
    inputText: string,
    segmentation: TSegmentationOutput | undefined
): Map<string, number> {
    const out = new Map<string, number>()
    let cursor = 0
    for (const segment of segmentation?.segments ?? []) {
        const found = inputText.indexOf(segment.text, cursor)
        if (found === -1) {
            out.set(segment.segmentId, segment.span.start)
            continue
        }
        out.set(segment.segmentId, found)
        cursor = found + segment.text.length
    }
    return out
}

/** Resolve every mention to a verified anchor in the input, by id. */
function buildAnchorByMentionId(args: {
    inputText: string
    segmentStartById: Map<string, number>
    mentions: TClaimMentionExtractionOutput | undefined
}): Map<string, TIngestionSourceAnchor> {
    const out = new Map<string, TIngestionSourceAnchor>()
    if (!args.mentions) return out
    const segmentStartById = args.segmentStartById
    for (const mention of args.mentions.mentions) {
        // Mention spans are relative to the segment's text, so the
        // input-relative hint only exists once the segment's own start is
        // added back on.
        const hint =
            (segmentStartById.get(mention.segmentId) ?? 0) + mention.span.start
        const anchor = locateSourceAnchor(args.inputText, mention.text, hint)
        if (anchor !== undefined) out.set(mention.mentionId, anchor)
    }
    return out
}

/** Anchors for the mentions of one claim, in order, deduped by range. */
function claimAnchors(
    mentionIds: readonly string[],
    anchorByMentionId: Map<string, TIngestionSourceAnchor>
): TIngestionSourceAnchor[] {
    const seen = new Set<string>()
    const anchors: TIngestionSourceAnchor[] = []
    for (const mentionId of mentionIds) {
        const anchor = anchorByMentionId.get(mentionId)
        if (anchor === undefined) continue
        const key = `${String(anchor.startUtf16)}:${String(anchor.endUtf16)}`
        if (seen.has(key)) continue
        seen.add(key)
        anchors.push(anchor)
    }
    return anchors
}

/** The anchor for a relation's evidence quote, if it can be located. */
function relationAnchor(args: {
    inputText: string
    relation: TInferenceRelation
    segmentStartById: Map<string, number>
}): TIngestionSourceAnchor | undefined {
    const starts = args.relation.evidence.segmentIds
        .map((id) => args.segmentStartById.get(id))
        .filter((start): start is number => start !== undefined)
    const hint = starts.length > 0 ? Math.min(...starts) : 0
    return locateSourceAnchor(
        args.inputText,
        args.relation.evidence.quote,
        hint
    )
}

/**
 * The raw text this pipeline was given, or `""` for any input shape that
 * does not carry one.
 *
 * `TStageContext.input` is `unknown` and this assembler is public API
 * for consumers composing their own pipelines, whose `inputSchema` need
 * not be `{ text }`. Anchors are the only thing that reads the input, so
 * an empty string degrades exactly into the documented no-anchor
 * behavior — every match misses — rather than throwing out of finalize
 * on the happy path, after every LLM call has been paid for.
 */
function readInputText(input: unknown): string {
    const text = (input as TIngestionInput | null | undefined)?.text
    return typeof text === "string" ? text : ""
}

/** The `mentionIds` on a canonical claim record, defensively read. */
function readMentionIds(record: Record<string, unknown>): string[] {
    const raw = record.mentionIds
    return Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string")
        : []
}

// **Premise titles read as prose, not formulas.** Each premise title
// is composed from the LLM-authored claim titles that back its
// variables — mirroring how `buildArgumentTitle` reuses the conclusion
// claim's title — rather than serializing the compiled symbolic
// `formula`. The machine `formula` field is left untouched; only the
// human-facing `title` changes.
//
// **Structure-walk, not string-substitution.** Each relation-derived
// premise (support / joint-support / derivation) is composed by walking
// the *relation* that produced it (`antecedents` → `consequent`, both claim
// miniIds, with the relation `type` giving the connective shape) rather
// than by parsing the `formula` string. The relation is the semantic
// origin of the premise and carries the logical structure directly, so
// composing from it avoids any fragile re-parse of the symbol string.
// The conclusion premise has no source relation (it is synthesized from
// a bare symbol), so it is composed by resolving that symbol to its
// claim title.
//
// **No role prefix.** The display layer renders a separate "Conclusion"
// chip, so a textual `Conclusion:` / `Support:` prefix on the prose is
// redundant; titles are pure prose.
//
// **No truncation.** The pre-prose implementation capped titles at 50
// chars, which mangled multi-claim premises mid-symbol. Prose titles
// are emitted in full.

type TTitleComposerMaps = {
    /** claim miniId → display title (LLM `title`, else `axiom`). */
    claimTitleByMiniId: Map<string, string>
    /** assigned variable symbol → claim miniId. */
    claimMiniIdBySymbol: Map<string, string>
    /** claim miniId → assigned variable symbol (defensive fallback). */
    symbolByClaimMiniId: Map<string, string>
    /** relationId → the relation that produced a premise. */
    relationById: Map<string, TInferenceRelation>
}

/**
 * Resolve a claim miniId to its quoted display title, falling back to
 * the claim's assigned variable symbol (quoted) when no title is
 * authored — and to the bare claim miniId only if even the symbol is
 * unresolvable. (Used for the source/target slots of relation-derived
 * premises.) Never throws.
 */
function quotedClaimTitle(
    claimMiniId: string,
    maps: TTitleComposerMaps
): string {
    const title =
        maps.claimTitleByMiniId.get(claimMiniId) ??
        maps.symbolByClaimMiniId.get(claimMiniId) ??
        claimMiniId
    return `"${title}"`
}

function buildPremiseTitle(
    premise: TCompiledPremise,
    maps: TTitleComposerMaps
): string {
    if (premise.roleHint === "conclusion") {
        // The conclusion premise is a bare symbol; its prose title is
        // the conclusion claim's title (unquoted — the whole title is
        // the proposition, not an embedded clause). Fall back to the
        // symbol when the claim title is unresolvable.
        const symbol = premise.formula.trim()
        const claimMiniId = maps.claimMiniIdBySymbol.get(symbol)
        return (
            (claimMiniId !== undefined
                ? maps.claimTitleByMiniId.get(claimMiniId)
                : undefined) ?? symbol
        )
    }

    // Relation-derived premise: compose `If <antecedent> then
    // <consequent>` by walking the source relation. The antecedent is
    // the `and`-joined source claim titles; the consequent is the
    // target claim title.
    const relation =
        premise.sourceRelationId !== null
            ? maps.relationById.get(premise.sourceRelationId)
            : undefined
    if (relation === undefined) {
        // No resolvable source relation — fall back to the raw formula
        // so the title is never empty. (Should not occur in practice:
        // every non-conclusion premise carries a sourceRelationId that
        // resolves; the bare-formula fallback is purely defensive.)
        return premise.formula
    }

    const antecedent = relation.antecedents
        .map((src) => quotedClaimTitle(src, maps))
        .join(" and ")
    const consequent = quotedClaimTitle(relation.consequent, maps)
    return `If ${antecedent} then ${consequent}`
}

function buildClaimTitleByMiniId(
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"]
): Map<string, string> {
    const m = new Map<string, string>()
    for (const claim of canonicalClaims) {
        const record = claim as Record<string, unknown>
        const title =
            (record.title as string | undefined) ??
            (record.axiom as string | undefined)
        if (title !== undefined) {
            m.set(claim.miniId, title)
        }
    }
    return m
}

function buildArgumentTitle(
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"],
    conclusionMiniId: string | null
): string {
    const cap = 50
    const conclusionClaim = canonicalClaims.find(
        (c) => c.miniId === conclusionMiniId
    ) as Record<string, unknown> | undefined
    const candidateTitle =
        (conclusionClaim?.title as string | undefined) ??
        (conclusionClaim?.axiom as string | undefined) ??
        "Argument"
    return candidateTitle.length <= cap
        ? candidateTitle
        : candidateTitle.slice(0, cap - 1) + "…"
}

export type TFinalizeResponseV2Input = {
    ctx: TStageContext
    extension: TIngestionExtension
    /**
     * Segmentation + mention outputs, supplied by the caller rather than
     * read from `ctx`, because not every pipeline has these stages —
     * `ctx.get` on a stage outside `finalize.dependsOn` is a
     * configuration error, and declaring a dep on a stage the pipeline
     * does not contain is another. Passing them keeps the declaration
     * and the read in the same file, per pipeline. Omit both and claims
     * carry no source anchors; premises are unaffected either way.
     */
    segmentation?: TSegmentationOutput
    mentions?: TClaimMentionExtractionOutput
}

/**
 * Assembles the v2 pipeline's final response from the
 * `TStageContext`'s accumulated upstream outputs.
 */
export function finalizeResponseV2(
    input: TFinalizeResponseV2Input
): TParsedArgumentResponse {
    void input.extension // forward-compat (extension-specific assembly hooks)
    const { ctx } = input
    const canon = ctx.get<TClaimCanonicalizationOutput>(
        STAGE_IDS.claimCanonicalization
    )
    const variables =
        ctx.get<TVariableAssignmentOutput>(STAGE_IDS.variableAssignment) ?? []
    const compilation = ctx.get<TFormulaCompilationOutput>(
        STAGE_IDS.formulaCompilation
    )
    const conclusion = ctx.get<TConclusionSelectionOutput>(
        STAGE_IDS.conclusionSelection
    )
    const relationEnvelope = ctx.get<TRelationExtractionOutput>(
        STAGE_IDS.relationExtraction
    )
    const relations = relationEnvelope?.relations ?? []
    const typeEnvelope = ctx.get<TClaimTypeClassificationOutput>(
        STAGE_IDS.claimTypeClassification
    )
    const typeByMiniId = new Map<string, TClaimTypeClassificationEntry>()
    for (const entry of typeEnvelope?.classifications ?? []) {
        typeByMiniId.set(entry.miniId, entry)
    }

    const processingFailures: never[] = []
    const baseResponse = {
        uncategorizedText: null,
        selectionRationale: conclusion?.rationale ?? null,
    }

    // Failure path 1: no canonical claims at all.
    if (!canon || canon.canonicalClaims.length === 0) {
        return {
            argument: null,
            failureText: FINALIZE_V2_FAILURE_TEXTS.noClaims,
            ...baseResponse,
            // `processingFailures` is a side-channel slot the v1
            // finalize also attaches; the response schema permits
            // additional properties.

            processingFailures,
        } as TParsedArgumentResponse
    }

    // Failure path 2: no single conclusion could be selected (or the
    // conclusion claim has no resolvable variable, in which case
    // formula-compilation already emitted an unresolved-conclusion
    // failure and left conclusionPremiseMiniId null).
    if (compilation?.conclusionPremiseMiniId === null || !compilation) {
        return {
            argument: null,
            failureText: FINALIZE_V2_FAILURE_TEXTS.noConclusion,
            ...baseResponse,

            processingFailures,
        } as TParsedArgumentResponse
    }

    // Happy path: assemble the argument.
    const inputText = readInputText(ctx.input)
    const segmentStartById = resolveSegmentStarts(inputText, input.segmentation)
    const anchorByMentionId = buildAnchorByMentionId({
        inputText,
        segmentStartById,
        mentions: input.mentions,
    })
    const conclusionMiniId = conclusion?.conclusionMiniId ?? null
    const roles = buildClaimToRole({
        canonicalClaims: canon.canonicalClaims,
        relations,
        conclusionMiniId,
    })

    const claims: TClaimFinalForm[] = canon.canonicalClaims.map((c) => {
        const role = roles[c.miniId]
        const classifiedType = typeByMiniId.get(c.miniId)?.type ?? c.type
        const record = c as unknown as Record<string, unknown>
        const stripped = stripCanonicalizerOnlyFields(record)
        // An entity with no resolvable provenance carries no key at all
        // rather than an empty array — "we found nothing" and "we did not
        // look" read the same to a consumer, and neither is a claim about
        // the text.
        const anchors = claimAnchors(readMentionIds(record), anchorByMentionId)
        if (anchors.length > 0) {
            stripped.sourceAnchors = anchors
        }
        // A claim classified `citation` stays `citation` and carries an
        // explicit `UnparsedCitation` (its `text` is the display text, so
        // a url-less reference no longer renders blank). Premise
        // placement is handled upstream by the deterministic relation
        // sort, which keeps citation claims out of freeform premises — so a
        // citation never lands as a freeform antecedent here, and there is
        // no url-presence demotion to do.
        if (classifiedType === "citation") {
            const unparsedCitation = buildUnparsedCitation({
                title: firstNonEmptyString(stripped.title),
                sourceString: typeByMiniId.get(c.miniId)?.sourceString,
                rawGuess: record.citationTypeGuess,
                url: record.url,
                fallbackText: c.miniId,
            })
            // The raw `citationTypeGuess` field rides into finalize on the
            // canonical claim; it is folded into the `citation` object's
            // `citationTypeGuess`, so drop the loose copy from the output.
            const { citationTypeGuess: _rawGuess, ...withoutRawGuess } =
                stripped
            void _rawGuess
            return {
                ...withoutRawGuess,
                type: classifiedType,
                role,
                citation: unparsedCitation,
            } as unknown as TClaimFinalForm
        }
        return {
            ...stripped,
            type: classifiedType,
            role,
        } as unknown as TClaimFinalForm
    })

    const finalVariables: TVariableFinalForm[] = variables.map((v) => ({
        ...v,
    }))

    const titleComposerMaps: TTitleComposerMaps = {
        claimTitleByMiniId: buildClaimTitleByMiniId(canon.canonicalClaims),
        claimMiniIdBySymbol: new Map(
            variables.map((v) => [v.symbol, v.claimMiniId])
        ),
        symbolByClaimMiniId: new Map(
            variables.map((v) => [v.claimMiniId, v.symbol])
        ),
        relationById: new Map(relations.map((r) => [r.relationId, r])),
    }

    const finalPremises: TPremiseFinalForm[] = compilation.premises.map((p) => {
        const premise: TPremiseFinalForm = {
            miniId: p.premiseMiniId,
            formula: p.formula,
            title: buildPremiseTitle(p, titleComposerMaps),
        }
        // The conclusion premise is synthesized from a bare symbol and
        // has no source relation, so it has no evidence quote to anchor.
        const relation =
            p.sourceRelationId !== null
                ? titleComposerMaps.relationById.get(p.sourceRelationId)
                : undefined
        const anchor =
            relation !== undefined
                ? relationAnchor({ inputText, relation, segmentStartById })
                : undefined
        if (anchor !== undefined) {
            premise.sourceAnchors = [anchor]
        }
        return premise
    })

    const argument: TArgumentFinalForm = {
        claims,
        variables: finalVariables,
        premises: finalPremises,
        conclusionPremiseMiniId: compilation.conclusionPremiseMiniId,
        // Citation/axiomatic backing the sort extracted from inference
        // antecedents; the parser materializes it into derivation edges.
        derivationBacking: compilation.derivationBacking,
        title: buildArgumentTitle(canon.canonicalClaims, conclusionMiniId),
    }

    return {
        argument: argument as unknown as TParsedArgumentResponse["argument"],
        failureText: null,
        ...baseResponse,

        processingFailures,
    } as TParsedArgumentResponse
}
