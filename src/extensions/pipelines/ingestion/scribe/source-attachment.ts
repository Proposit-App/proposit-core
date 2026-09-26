// Attaching scribe's source (citation) claims to the claims they support.
//
// A source becomes derivation backing only as the antecedent of an
// inference relation (`sortInferenceRelations`). `structure` is the only
// stage that emits relations, and it is shown the claim list, never the
// text, so it cannot tell which claim a link sits beside — and it may
// leave a source out altogether. A source attached to nothing backs
// nothing and is lost downstream.
//
// So each source gets extra single-antecedent relations `[source] →
// supported`: first to every normal claim `extract` named for it (the
// one stage that reads the text); failing that, when `structure` did not
// use it either, to a claim chosen by where the mentions sit — the
// normal claim whose mention overlaps the source's most, else the nearest
// normal claim whose mention ends before the source's begins. A relation
// with only a source antecedent compiles to backing and no freeform
// premise, so nothing else about the argument changes.

import type {
    TClaimMention,
    TClaimTypeClassificationEntry,
    TInferenceRelation,
} from "../../base/stages/index.js"
import { locateSourceAnchor } from "../../base/source-anchors.js"
import type { TScribeExtractOutput } from "./schemas.js"

export const SOURCE_ATTACHMENT_FAILURE_CODES = {
    invalidTarget: "SOURCE_ATTACHMENT_INVALID_TARGET",
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

/** The normal claim a source's mentions sit on or just after, if any. */
function claimByPosition(
    sourceRanges: TRange[],
    normalRanges: { miniId: string; ranges: TRange[] }[]
): string | undefined {
    let best: { miniId: string; overlap: number } | undefined
    for (const claim of normalRanges) {
        for (const range of claim.ranges) {
            for (const source of sourceRanges) {
                const overlap = overlapLength(range, source)
                if (
                    overlap > 0 &&
                    (best === undefined || overlap > best.overlap)
                )
                    best = { miniId: claim.miniId, overlap }
            }
        }
    }
    if (best !== undefined) return best.miniId

    if (sourceRanges.length === 0) return undefined
    const sourceStart = Math.min(...sourceRanges.map((r) => r.start))
    let nearest: { miniId: string; end: number } | undefined
    for (const claim of normalRanges) {
        for (const range of claim.ranges) {
            if (range.end > sourceStart) continue
            if (nearest === undefined || range.end > nearest.end)
                nearest = { miniId: claim.miniId, end: range.end }
        }
    }
    return nearest?.miniId
}

/**
 * The relations that attach each source claim to what it supports, to be
 * published alongside `structure`'s own. See the file comment for the
 * order in which a target is chosen.
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
    const attachedByStructure = new Set(
        args.structureRelations
            .filter((r) => args.typeByMiniId.get(r.consequent) === "normal")
            .flatMap((r) => r.antecedents)
    )

    const relations: TInferenceRelation[] = []
    const attach = (sourceMiniId: string, supportedMiniId: string) => {
        relations.push({
            relationId: `source-${sourceMiniId}-${supportedMiniId}`,
            type: "inference",
            antecedents: [sourceMiniId],
            consequent: supportedMiniId,
            title: "",
            evidence: { segmentIds: [], quote: "" },
        })
    }

    for (const claim of claims) {
        if (args.typeByMiniId.get(claim.miniId) !== "citation") continue
        const sourceMiniId = claim.miniId

        const named = new Set<string>()
        for (const entry of args.extract?.sourceSupport ?? []) {
            if (entry.sourceMiniId !== sourceMiniId) continue
            const targetType = args.typeByMiniId.get(entry.supportedMiniId)
            if (targetType !== "normal") {
                args.addFailure({
                    code: SOURCE_ATTACHMENT_FAILURE_CODES.invalidTarget,
                    message: `Source "${sourceMiniId}" was said to support "${entry.supportedMiniId}", which is ${targetType === undefined ? "not a known claim" : `a ${targetType} claim`}; a source can only support a normal claim.`,
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
            attach(sourceMiniId, supportedMiniId)
        }
        if (named.size > 0 || attachedByStructure.has(sourceMiniId)) continue

        const supportedMiniId = claimByPosition(
            rangesOf(claim.mentionIds),
            normalRanges
        )
        if (supportedMiniId === undefined) {
            args.addFailure({
                code: SOURCE_ATTACHMENT_FAILURE_CODES.unattached,
                message: `Source "${sourceMiniId}" supports no claim: none was named for it, and no normal claim is stated where it appears or before it.`,
                severity: "warning",
                context: { sourceMiniId },
            })
            continue
        }
        attach(sourceMiniId, supportedMiniId)
    }
    return relations
}
