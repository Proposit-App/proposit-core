import type { TStageContext } from "../../../../lib/pipelines/index.js"
import type {
    TClaimMentionExtractionOutput,
    TSegmentationOutput,
} from "../stages/schemas.js"
import {
    nearestOccurrence,
    resolveSourceAnchor,
    type TIngestionSourceAnchor,
} from "../source-anchors.js"
import type { TIngestionInput } from "../types.js"

// -- Source anchors --
//
// The pipeline knows where each claim came from, but only as data spread
// across two stages: `segmentation` holds input-relative segment spans,
// and `claim-mention-extraction` holds *segment-relative* mention spans
// plus the mention text. Finalize is the first place both are in scope at
// once, so it is where they become a usable reference back into the
// input. Only claims are anchored: a premise has no content of its own,
// so the quote `relation-extraction` records per relation is not
// resolved into one.
//
// Only quoted text crosses the boundary as fact; the model's offsets are
// used to choose among repeated occurrences and are never emitted
// unverified. See `source-anchors.ts`.

/**
 * Where each segment actually begins in the input.
 *
 * The segmentation prompt requires `segment.text` be copied verbatim, so
 * the true offset is recoverable by searching — and searching is what
 * this does, because the model's own `span.start` drifts — off by one on
 * several segments of the recorded corpus. Small, and invisible until a
 * quote repeats, at which point the drifted hint picks the wrong
 * occurrence.
 *
 * Segments are emitted left to right and cover the input, so the scan
 * carries a cursor rather than searching from zero: that keeps a segment
 * whose text repeats earlier in the document from collapsing onto the
 * earlier copy. Among the candidates at or after the cursor, the one
 * nearest the model's reported start wins — the model's number chooses
 * between verified positions rather than supplying one.
 */
export function resolveSegmentStarts(
    inputText: string,
    segmentation: TSegmentationOutput | undefined
): Map<string, number> {
    const out = new Map<string, number>()
    let cursor = 0
    for (const segment of segmentation?.segments ?? []) {
        const found = nearestOccurrence(
            inputText,
            segment.text,
            segment.span.start,
            cursor
        )
        if (found === undefined) {
            out.set(segment.segmentId, segment.span.start)
            // Advance past where the model says this segment ended.
            // Leaving the cursor behind would let the next segment's
            // scan reach back into territory this one owns and match a
            // duplicate inside it — the exact collapse the cursor
            // exists to prevent, triggered by the branch that handles a
            // rewritten segment.
            cursor = Math.max(cursor, segment.span.end)
            continue
        }
        out.set(segment.segmentId, found)
        cursor = found + segment.text.length
    }
    return out
}

/**
 * Non-fatal note codes for anchor resolution. None stops assembly: an
 * unresolved quote yields no anchor; an ambiguous one yields the
 * occurrence nearest the reported position when the quote is verbatim,
 * and no anchor when it is only approximately in the input; an approximate
 * one yields the nearest passage. Every one of them is reported because
 * silence here is indistinguishable from success — a model that starts
 * paraphrasing would otherwise take anchor coverage to zero with no signal.
 * A claim the mention stage produced no mention for was never looked up at
 * all; it is reported too, so "we did not look" is not read as "we found
 * nothing" or as success. So is the reverse: a mention the stage produced
 * that no claim references, whose passage is linked to no claim. A mention
 * id the stage emitted more than once is resolved from its first copy only,
 * so it gets at most one resolution note; later copies are ignored.
 */
export const SOURCE_ANCHOR_NOTE_CODES = {
    unresolved: "SOURCE_ANCHOR_UNRESOLVED",
    ambiguous: "SOURCE_ANCHOR_AMBIGUOUS",
    approximate: "SOURCE_ANCHOR_APPROXIMATE",
    inputUnavailable: "SOURCE_ANCHOR_INPUT_UNAVAILABLE",
    notAttempted: "SOURCE_ANCHOR_NOT_ATTEMPTED",
    mentionUnclaimed: "SOURCE_ANCHOR_MENTION_UNCLAIMED",
} as const

/** Emit the note for one attempted resolution, if there is one to emit. */
function noteResolution(args: {
    ctx: TStageContext
    match: ReturnType<typeof resolveSourceAnchor>
    quote: string
    subject: Record<string, string>
}): void {
    const subjectText = Object.entries(args.subject)
        .map(([key, value]) => `${key} ${value}`)
        .join(" ")
    if (args.match === undefined) {
        args.ctx.addFailure({
            code: SOURCE_ANCHOR_NOTE_CODES.unresolved,
            message: `Quote for ${subjectText} was not found in the input; no source anchor was emitted.`,
            severity: "warning",
            context: { ...args.subject, quote: args.quote },
        })
        return
    }
    if ("ambiguousPassages" in args.match) {
        args.ctx.addFailure({
            code: SOURCE_ANCHOR_NOTE_CODES.ambiguous,
            message: `Quote for ${subjectText} is not in the input as written and ${String(args.match.ambiguousPassages)} passages match it equally well; no source anchor was emitted.`,
            severity: "warning",
            context: {
                ...args.subject,
                quote: args.quote,
                occurrences: args.match.ambiguousPassages,
            },
        })
        return
    }
    if (args.match.approximate !== undefined) {
        args.ctx.addFailure({
            code: SOURCE_ANCHOR_NOTE_CODES.approximate,
            message: `Quote for ${subjectText} is not in the input as written; it was anchored to the nearest passage (${args.match.approximate}).`,
            severity: "warning",
            context: {
                ...args.subject,
                quote: args.quote,
                rule: args.match.approximate,
                anchoredQuote: args.match.anchor.quote,
                startUtf16: args.match.anchor.startUtf16,
            },
        })
        return
    }
    if (args.match.occurrences > 1) {
        args.ctx.addFailure({
            code: SOURCE_ANCHOR_NOTE_CODES.ambiguous,
            message: `Quote for ${subjectText} occurs ${String(args.match.occurrences)} times in the input; the occurrence nearest the reported position was used.`,
            severity: "warning",
            context: {
                ...args.subject,
                quote: args.quote,
                occurrences: args.match.occurrences,
                startUtf16: args.match.anchor.startUtf16,
            },
        })
    }
}

/** Resolve every mention to a verified anchor in the input, by id. */
export function buildAnchorByMentionId(args: {
    ctx: TStageContext
    inputText: string
    segmentStartById: Map<string, number>
    segments: TSegmentationOutput["segments"] | undefined
    mentions: TClaimMentionExtractionOutput | undefined
}): Map<string, TIngestionSourceAnchor> {
    const out = new Map<string, TIngestionSourceAnchor>()
    if (!args.mentions) return out
    const segmentStartById = args.segmentStartById
    const segmentTextById = new Map(
        (args.segments ?? []).map((s) => [s.segmentId, s.text])
    )
    // Ids should be unique, and nothing enforces it. Only the first copy of
    // an id is resolved, so each id gets at most one resolution note and one
    // anchor; later copies are ignored.
    const firstById = new Map<
        string,
        TClaimMentionExtractionOutput["mentions"][number]
    >()
    for (const mention of args.mentions.mentions) {
        if (!firstById.has(mention.mentionId)) {
            firstById.set(mention.mentionId, mention)
        }
    }
    for (const mention of firstById.values()) {
        // Mention spans are relative to the segment's text, so the
        // input-relative hint only exists once the segment's own start is
        // added back on.
        //
        // Both halves of that sum are located rather than trusted. The
        // mention's own offset is the larger error of the two on the
        // recorded corpus — a model can miscount its way through a
        // markdown link and report a mention 14 characters early — and
        // the mention text is copied from the segment, so its position
        // inside the segment is recoverable exactly the way the
        // segment's position in the document is.
        const segmentText = segmentTextById.get(mention.segmentId)
        const offsetInSegment =
            segmentText === undefined
                ? undefined
                : nearestOccurrence(
                      segmentText,
                      mention.text,
                      mention.span.start
                  )
        const hint =
            (segmentStartById.get(mention.segmentId) ?? 0) +
            (offsetInSegment ?? mention.span.start)
        const match = resolveSourceAnchor(args.inputText, mention.text, hint)
        noteResolution({
            ctx: args.ctx,
            match,
            quote: mention.text,
            subject: { mentionId: mention.mentionId },
        })
        if (match !== undefined && "anchor" in match) {
            out.set(mention.mentionId, match.anchor)
        }
    }
    return out
}

/** Anchors for the mentions of one claim, in order, deduped by range. */
export function claimAnchors(
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
export function readInputText(input: unknown): string {
    const text = (input as TIngestionInput | null | undefined)?.text
    return typeof text === "string" ? text : ""
}

/** The `mentionIds` on a canonical claim record, defensively read. */
export function readMentionIds(record: Record<string, unknown>): string[] {
    const raw = record.mentionIds
    return Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string")
        : []
}
