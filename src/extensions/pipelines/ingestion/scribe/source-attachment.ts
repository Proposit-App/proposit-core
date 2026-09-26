// Attaching scribe's source claims — citations and axioms — to the claims
// they support.
//
// A source becomes derivation backing only as the antecedent of an
// inference relation (`sortInferenceRelations`). `structure` is the only
// stage that emits relations, and it is shown the claim list, never the
// text, so it cannot tell which claim a link or an appeal to a principle
// sits beside — and it may leave a source out altogether. A source
// attached to nothing backs nothing and is lost downstream.
//
// So each source gets extra single-antecedent relations `[source] →
// supported`: first to every normal claim `extract` named for it (the
// one stage that reads the text); failing that, when `structure` did not
// use it either, to a claim chosen by where the mentions sit — the
// normal claim whose mention overlaps the source's most, else the nearest
// normal claim in the same sentence, else the nearest normal claim whose
// mention ends before the source's begins. A relation
// with only a source antecedent compiles to backing and no freeform
// premise, so nothing else about the argument changes.
//
// An axiom is never attached to a claim a citation backs: grammar rule D-3
// forbids one derivation mixing the two. Citations are attached first and
// the axiom is dropped with a warning.

import type {
    TClaimMention,
    TClaimTypeClassificationEntry,
    TInferenceRelation,
} from "../../base/stages/index.js"
import { locateSourceAnchor } from "../../base/source-anchors.js"
import { sortInferenceRelations } from "../../base/stages/formula-compilation.js"
import type { TScribeExtractOutput } from "./schemas.js"

export const SOURCE_ATTACHMENT_FAILURE_CODES = {
    invalidSource: "SOURCE_ATTACHMENT_INVALID_SOURCE",
    invalidTarget: "SOURCE_ATTACHMENT_INVALID_TARGET",
    mixed: "SOURCE_ATTACHMENT_MIXED",
    unattached: "SOURCE_ATTACHMENT_UNATTACHED",
} as const

type TClaimType = TClaimTypeClassificationEntry["type"]

type TRange = { start: number; end: number }

type TAddFailure = (failure: {
    code: string
    message: string
    severity: "warning" | "error"
    context?: Record<string, unknown>
}) => void

/**
 * Where a mention sits in the input: its quote located in the text when
 * it can be, else the offsets the model reported.
 */
function mentionRange(mention: TClaimMention, inputText: string): TRange {
    const match = locateSourceAnchor(
        inputText,
        mention.text,
        mention.span.start
    )
    return match === undefined
        ? mention.span
        : { start: match.anchor.startUtf16, end: match.anchor.endUtf16 }
}

function overlapLength(a: TRange, b: TRange): number {
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

// A sentence ends at a terminator followed by whitespace (closing quotes and
// brackets allowed in between), or at a line break. The dots inside a URL
// are followed by more of the URL, so they never count.
const SENTENCE_BREAK = /[.!?]["')\]]*\s|\n/

/**
 * The normal claim a source's mentions belong to, if any: the one whose
 * mention overlaps a source mention most; else the nearest one in the same
 * sentence, on either side ("According to <link>, <claim>."); else the
 * nearest one that ends before the source begins.
 */
function claimByPosition(
    sourceRanges: TRange[],
    normalRanges: { miniId: string; ranges: TRange[] }[],
    inputText: string
): string | undefined {
    let overlapping: { miniId: string; overlap: number } | undefined
    let sameSentence: { miniId: string; gap: number } | undefined
    let preceding: { miniId: string; end: number } | undefined
    for (const claim of normalRanges) {
        for (const range of claim.ranges) {
            for (const source of sourceRanges) {
                const overlap = overlapLength(range, source)
                if (overlap > 0) {
                    if (
                        overlapping === undefined ||
                        overlap > overlapping.overlap
                    )
                        overlapping = { miniId: claim.miniId, overlap }
                    continue
                }
                const [gapStart, gapEnd] =
                    range.end <= source.start
                        ? [range.end, source.start]
                        : [source.end, range.start]
                const gap = gapEnd - gapStart
                // From the earlier mention's last character, which is where
                // a sentence it closes has its terminator.
                const between = inputText.slice(
                    Math.max(0, gapStart - 1),
                    gapEnd
                )
                if (
                    !SENTENCE_BREAK.test(between) &&
                    (sameSentence === undefined || gap < sameSentence.gap)
                )
                    sameSentence = { miniId: claim.miniId, gap }
                if (
                    range.end <= source.start &&
                    (preceding === undefined || range.end > preceding.end)
                )
                    preceding = { miniId: claim.miniId, end: range.end }
            }
        }
    }
    return (overlapping ?? sameSentence ?? preceding)?.miniId
}

/**
 * The relations that attach each citation and axiomatic claim to what it
 * supports, to be published alongside `structure`'s own. See the file
 * comment for the order in which a target is chosen.
 */
export function buildSourceRelations(args: {
    extract: TScribeExtractOutput | undefined
    structureRelations: readonly TInferenceRelation[]
    typeByMiniId: Map<string, TClaimType>
    inputText: string
    addFailure: TAddFailure
}): TInferenceRelation[] {
    const claims = args.extract?.canonicalClaims ?? []
    const mentionById = new Map(
        (args.extract?.mentions ?? []).map((m) => [m.mentionId, m])
    )
    const rangesOf = (mentionIds: readonly string[]): TRange[] =>
        mentionIds.flatMap((id) => {
            const mention = mentionById.get(id)
            return mention === undefined
                ? []
                : [mentionRange(mention, args.inputText)]
        })
    const normalRanges = claims
        .filter((c) => args.typeByMiniId.get(c.miniId) === "normal")
        .map((c) => ({ miniId: c.miniId, ranges: rangesOf(c.mentionIds) }))
    // Read off what the compiler will make of structure's relations, so a
    // relation it drops (an unknown claim id, say) attaches nothing here
    // either. Its warnings are the compiler's to report, not this stage's.
    const structureBacking = sortInferenceRelations({
        relations: [...args.structureRelations],
        typeByClaimMiniId: args.typeByMiniId,
    }).derivationBacking
    const attachedByStructure = new Set([...structureBacking.values()].flat())
    // Claims a citation backs. An axiom may not join them: one derivation
    // mixing axioms and citations breaks grammar rule D-3.
    const backedByCitation = new Set(
        [...structureBacking]
            .filter(([, supporters]) =>
                supporters.some(
                    (id) => args.typeByMiniId.get(id) === "citation"
                )
            )
            .map(([consequent]) => consequent)
    )

    const relations: TInferenceRelation[] = []
    const attach = (
        sourceMiniId: string,
        sourceType: TClaimType,
        supportedMiniId: string
    ) => {
        if (
            sourceType === "axiomatic" &&
            backedByCitation.has(supportedMiniId)
        ) {
            args.addFailure({
                code: SOURCE_ATTACHMENT_FAILURE_CODES.mixed,
                message: `Axiom "${sourceMiniId}" supports "${supportedMiniId}", which a citation already backs; one claim cannot be backed by both, so the axiom was not attached.`,
                severity: "warning",
                context: { sourceMiniId, supportedMiniId },
            })
            return
        }
        if (sourceType === "citation") backedByCitation.add(supportedMiniId)
        relations.push({
            relationId: `source-${sourceMiniId}-${supportedMiniId}`,
            type: "inference",
            antecedents: [sourceMiniId],
            consequent: supportedMiniId,
            title: "",
            evidence: { segmentIds: [], quote: "" },
        })
    }

    for (const entry of args.extract?.sourceSupport ?? []) {
        const sourceType = args.typeByMiniId.get(entry.sourceMiniId)
        if (sourceType === "citation" || sourceType === "axiomatic") continue
        args.addFailure({
            code: SOURCE_ATTACHMENT_FAILURE_CODES.invalidSource,
            message: `"${entry.sourceMiniId}" was paired as a source for "${entry.supportedMiniId}", but it is ${sourceType === undefined ? "not a known claim" : `a ${sourceType} claim`}; only a citation or axiomatic claim is a source. Ignoring the pairing.`,
            severity: "warning",
            context: {
                sourceMiniId: entry.sourceMiniId,
                supportedMiniId: entry.supportedMiniId,
            },
        })
    }

    // Citations first, so an axiom sees every claim a citation backs.
    for (const sourceType of ["citation", "axiomatic"] as const) {
        const label = sourceType === "citation" ? "Source" : "Axiom"
        for (const claim of claims) {
            if (args.typeByMiniId.get(claim.miniId) !== sourceType) continue
            const sourceMiniId = claim.miniId

            const named = new Set<string>()
            for (const entry of args.extract?.sourceSupport ?? []) {
                if (entry.sourceMiniId !== sourceMiniId) continue
                const targetType = args.typeByMiniId.get(entry.supportedMiniId)
                if (targetType !== "normal") {
                    args.addFailure({
                        code: SOURCE_ATTACHMENT_FAILURE_CODES.invalidTarget,
                        message: `${label} "${sourceMiniId}" was said to support "${entry.supportedMiniId}", which is ${targetType === undefined ? "not a known claim" : `a ${targetType} claim`}; a ${label.toLowerCase()} can only support a normal claim.`,
                        severity: "warning",
                        context: {
                            sourceMiniId,
                            supportedMiniId: entry.supportedMiniId,
                        },
                    })
                    continue
                }
                named.add(entry.supportedMiniId)
            }
            for (const supportedMiniId of named) {
                attach(sourceMiniId, sourceType, supportedMiniId)
            }
            if (named.size > 0 || attachedByStructure.has(sourceMiniId))
                continue

            const supportedMiniId = claimByPosition(
                rangesOf(claim.mentionIds),
                normalRanges,
                args.inputText
            )
            if (supportedMiniId === undefined) {
                args.addFailure({
                    code: SOURCE_ATTACHMENT_FAILURE_CODES.unattached,
                    message: `${label} "${sourceMiniId}" supports no claim: none was named for it, and no normal claim is stated where it appears or before it.`,
                    severity: "warning",
                    context: { sourceMiniId },
                })
                continue
            }
            attach(sourceMiniId, sourceType, supportedMiniId)
        }
    }
    return relations
}
