// Locating a model-supplied quote in the pipeline input.
//
// The ingestion stages emit both quoted text and character offsets, but
// only the text is trustworthy. Two independent reasons:
//
//   - Offset units are ambiguous. JS string indices are UTF-16 code
//     units, so an emoji or much CJK counts as two, while a model told
//     "character offsets" generally counts code points.
//   - Claim-mention spans are *segment-relative* (see the
//     `claim-mention-extraction` prompt), so an input-relative offset
//     only exists after composing them with the segment's own span —
//     arithmetic over two numbers the model produced independently.
//
// So the model's number is used only as a hint for choosing among
// occurrences of a quote that has already been found by text match.
// Every anchor returned here satisfies
// `input.slice(startUtf16, endUtf16) === quote`; a quote that cannot be
// located yields no anchor at all, never an anchor at an unverified
// offset.

/** Characters of surrounding input carried on either side of a quote. */
export const SOURCE_ANCHOR_CONTEXT_CHARS = 32

/**
 * A verified reference from an ingested entity back into the text the
 * pipeline was given.
 *
 * `quote` is authoritative: it is the input's own text for the range,
 * so a consumer that stores a differently-normalized copy of the
 * document can re-locate it there rather than trusting these offsets.
 * `prefix` / `suffix` disambiguate a quote that occurs more than once.
 *
 * Offsets are **JS string indices (UTF-16 code units)** into the
 * pipeline input, which is why they say so in their names — a consumer
 * counting code points must convert.
 */
export type TIngestionSourceAnchor = {
    quote: string
    startUtf16: number
    endUtf16: number
    prefix: string
    suffix: string
}

/** Escape a literal string for use inside a regular expression. */
function escapeForRegExp(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Every start index at which `needle` occurs in `haystack`. */
function exactOccurrences(haystack: string, needle: string): number[] {
    const starts: number[] = []
    let from = 0
    for (;;) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) return starts
        starts.push(at)
        from = at + 1
    }
}

/**
 * Ranges matching `quote` when every whitespace run is treated as
 * interchangeable. Covers the common case of a model flattening a line
 * break to a space while copying.
 */
function whitespaceInsensitiveRanges(
    haystack: string,
    quote: string
): { start: number; end: number }[] {
    const pattern = quote.split(/\s+/).map(escapeForRegExp).join("\\s+")
    const ranges: { start: number; end: number }[] = []
    const matcher = new RegExp(pattern, "g")
    for (const match of haystack.matchAll(matcher)) {
        if (match.index === undefined) continue
        ranges.push({ start: match.index, end: match.index + match[0].length })
    }
    return ranges
}

/** Build the anchor for an already-verified range. */
function buildAnchor(
    input: string,
    start: number,
    end: number
): TIngestionSourceAnchor {
    return {
        quote: input.slice(start, end),
        startUtf16: start,
        endUtf16: end,
        prefix: input.slice(
            Math.max(0, start - SOURCE_ANCHOR_CONTEXT_CHARS),
            start
        ),
        suffix: input.slice(
            end,
            Math.min(input.length, end + SOURCE_ANCHOR_CONTEXT_CHARS)
        ),
    }
}

/** The range whose start sits nearest `hintUtf16`, or undefined if none. */
function nearestRange(
    ranges: { start: number; end: number }[],
    hintUtf16: number
): { start: number; end: number } | undefined {
    let best: { start: number; end: number } | undefined
    let bestDistance = Number.POSITIVE_INFINITY
    for (const range of ranges) {
        const distance = Math.abs(range.start - hintUtf16)
        if (distance < bestDistance) {
            best = range
            bestDistance = distance
        }
    }
    return best
}

/**
 * Locate `quote` in `input`, returning a verified anchor or `undefined`.
 *
 * `hintUtf16` selects among repeated occurrences — the occurrence whose
 * start sits nearest the hint wins. It never affects *whether* a quote
 * matches, so a wrong hint degrades to "picked another occurrence of the
 * same text", never to a wrong span.
 *
 * The ladder is exact match, then whitespace-insensitive match. Nothing
 * approximate: a quote that still does not match yields `undefined`.
 */
export function locateSourceAnchor(
    input: string,
    quote: string,
    hintUtf16: number
): TIngestionSourceAnchor | undefined {
    const trimmed = quote.trim()
    if (trimmed.length === 0) return undefined

    const exact = exactOccurrences(input, trimmed).map((start) => ({
        start,
        end: start + trimmed.length,
    }))
    const ranges =
        exact.length > 0 ? exact : whitespaceInsensitiveRanges(input, trimmed)

    const range = nearestRange(ranges, hintUtf16)
    return range === undefined
        ? undefined
        : buildAnchor(input, range.start, range.end)
}
