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

/** Every start index at which `needle` occurs in `haystack`, from `fromUtf16`. */
function exactOccurrences(
    haystack: string,
    needle: string,
    fromUtf16 = 0
): number[] {
    const starts: number[] = []
    let from = fromUtf16
    for (;;) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) return starts
        starts.push(at)
        from = at + 1
    }
}

/**
 * The occurrence of `needle` at or after `fromUtf16` whose start sits
 * nearest `hintUtf16`, or `undefined` when there is none.
 *
 * The same rule the anchor locator applies, exposed because the offsets
 * the model reports for segments and mentions need it too: take the
 * verifiable positions as the candidates and let the model's number pick
 * between them, never the reverse.
 */
export function nearestOccurrence(
    haystack: string,
    needle: string,
    hintUtf16: number,
    fromUtf16 = 0
): number | undefined {
    if (needle.length === 0) return undefined
    let best: number | undefined
    for (const at of exactOccurrences(haystack, needle, fromUtf16)) {
        if (
            best === undefined ||
            Math.abs(at - hintUtf16) < Math.abs(best - hintUtf16)
        ) {
            best = at
        }
    }
    return best
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

/** Exact ranges for `quote`, falling back to whitespace-insensitive ones. */
function rangesFor(
    input: string,
    quote: string
): { start: number; end: number }[] {
    const exact = exactOccurrences(input, quote).map((start) => ({
        start,
        end: start + quote.length,
    }))
    return exact.length > 0 ? exact : whitespaceInsensitiveRanges(input, quote)
}

/**
 * The same text with its first character's case flipped, or `undefined`
 * when that character has no other case.
 *
 * Models re-case the first character of a quoted span reflexively, in
 * both directions: a span lifted from mid-sentence comes back with a
 * capital, and one lifted from a sentence start comes back lower-cased
 * to look like a fragment. Both were observed on the same document, on
 * consecutive runs, under a prompt that forbids exactly this — so it is
 * handled here rather than argued about in the prompt.
 *
 * Only the first character, and only after an exact search has already
 * failed: every other character must still match, so this cannot invent
 * a match the model did not essentially supply. The anchor is built from
 * the range in the input, so what gets stored is the document's own
 * casing, not the model's.
 */
function flipFirstCharacterCase(text: string): string | undefined {
    const first = text[0]
    const lower = first.toLowerCase()
    const upper = first.toUpperCase()
    if (lower === upper) return undefined
    return (first === lower ? upper : lower) + text.slice(1)
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

/**
 * Whether index `at` falls between the halves of a surrogate pair.
 *
 * A range boundary there would put a lone surrogate in `quote`. That is
 * reachable from an ill-formed model quote — a bare `\uD83D` escape is
 * valid JSON and survives `JSON.parse`, and half a pair matches inside a
 * whole one — and the resulting string fails a Postgres `json`/`jsonb`
 * insert just as an ill-formed context string would.
 */
function splitsSurrogatePair(text: string, at: number): boolean {
    if (at <= 0 || at >= text.length) return false
    const before = text.charCodeAt(at - 1)
    const after = text.charCodeAt(at)
    return (
        before >= 0xd800 &&
        before <= 0xdbff &&
        after >= 0xdc00 &&
        after <= 0xdfff
    )
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
 * The ladder is exact match, then whitespace-insensitive match, then
 * both again with the quote's first character re-cased. Nothing
 * approximate: a quote that still does not match yields `undefined`.
 */
export function locateSourceAnchor(
    input: string,
    quote: string,
    hintUtf16: number
): TSourceAnchorMatch | undefined {
    const trimmed = quote.trim()
    if (trimmed.length === 0) return undefined

    let candidates = rangesFor(input, trimmed)
    if (candidates.length === 0) {
        const recased = flipFirstCharacterCase(trimmed)
        if (recased !== undefined) candidates = rangesFor(input, recased)
    }
    // Discarding the range, rather than trimming the quote, is what
    // keeps `input.slice(start, end) === quote` true.
    const ranges = candidates.filter(
        (range) =>
            !splitsSurrogatePair(input, range.start) &&
            !splitsSurrogatePair(input, range.end)
    )

    const range = nearestRange(ranges, hintUtf16)
    return range === undefined
        ? undefined
        : {
              anchor: buildAnchor(input, range.start, range.end),
              occurrences: ranges.length,
          }
}
