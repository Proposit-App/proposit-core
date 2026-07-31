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

/**
 * Drop a lone surrogate left at either edge by slicing on a code-unit
 * boundary, shrinking the window by one unit rather than emitting an
 * ill-formed string.
 *
 * Ill-formed here is not cosmetic. Postgres rejects an unpaired
 * surrogate escape on insert into `json`/`jsonb`, so one emoji sitting
 * on the context boundary would fail a consumer's whole persist
 * transaction; and a `TextEncoder` round-trip silently substitutes
 * U+FFFD, which breaks the re-locate path the context exists to serve.
 * A slice of well-formed text can strand at most one surrogate per edge.
 */
function dropEdgeLoneSurrogates(context: string): string {
    let start = 0
    let end = context.length
    const first = context.charCodeAt(start)
    if (first >= 0xdc00 && first <= 0xdfff) start += 1
    const last = context.charCodeAt(end - 1)
    if (last >= 0xd800 && last <= 0xdbff) end -= 1
    return start === 0 && end === context.length
        ? context
        : context.slice(start, end)
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
        prefix: dropEdgeLoneSurrogates(
            input.slice(Math.max(0, start - SOURCE_ANCHOR_CONTEXT_CHARS), start)
        ),
        suffix: dropEdgeLoneSurrogates(
            input.slice(
                end,
                Math.min(input.length, end + SOURCE_ANCHOR_CONTEXT_CHARS)
            )
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
 * A located anchor together with how many candidates it was chosen from.
 *
 * `occurrences > 1` means the quote is not unique in the input and the
 * hint broke the tie. Callers surface that as a note rather than
 * swallowing it: a silent tie-break is indistinguishable from a certain
 * match, and the two deserve different trust.
 */
export type TSourceAnchorMatch = {
    anchor: TIngestionSourceAnchor
    occurrences: number
}

/**
 * Locate `quote` in `input`, returning a verified match or `undefined`.
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
): TSourceAnchorMatch | undefined {
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
        : {
              anchor: buildAnchor(input, range.start, range.end),
              occurrences: ranges.length,
          }
}
