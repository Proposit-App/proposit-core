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
// offset. A quote the model reworded or spliced can still be located,
// conservatively, and the match then says so — its anchor quote is the
// input's text, not the model's.

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
    /**
     * Set when the quote was not in the input as written and the anchor is
     * the nearest passage instead — see `approximateRange` for each rule.
     * The anchor is still the input's own text for its range.
     */
    approximate?: TApproximateAnchorRule
}

/**
 * How an approximate anchor was found: `normalized` — equal once quote
 * marks, dashes, ellipses, case and edge punctuation are folded;
 * `reworded` — a few words differ; `joined` — the quote splices passages,
 * and the anchor is its longest word-for-word run.
 */
export type TApproximateAnchorRule = "normalized" | "reworded" | "joined"

type TWord = { start: number; end: number; key: string }

/** A word's comparison key: folded punctuation and case, edges stripped. */
function wordKey(word: string): string {
    const folded = word
        .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
        .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
        .replace(/[\u2010-\u2015\u2212]/g, "-")
        .replace(/\u2026/g, "...")
        .toLowerCase()
    const stripped = folded.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "")
    return stripped.length > 0 ? stripped : folded
}

/** The whitespace-separated words of `text`, with their ranges. */
function wordsOf(text: string): TWord[] {
    return [...text.matchAll(/\S+/g)].map((m) => ({
        start: m.index,
        end: m.index + m[0].length,
        key: wordKey(m[0]),
    }))
}

/** Quotes shorter than this are never matched loosely. */
const APPROXIMATE_MIN_WORDS = 5

/**
 * The input range a non-verbatim quote most plausibly came from, or
 * `undefined`. Deliberately conservative, since a wrong highlight is worse
 * than none:
 *
 * - **Reworded.** The passage with the fewest changed words (word-level
 *   edit distance, over a passage of any start and length). Accepted when
 *   the quote has at least five words, at most one word in eight changed
 *   and at most three in all, and no passage outside the winner does as
 *   well — two equally good passages give no anchor.
 * - **Joined.** Only when no passage qualifies: the quote's longest run of
 *   words found word-for-word in the input, if it is at least eight words
 *   long, or at least five and 60% of the quote. The anchor covers that run
 *   alone.
 */
function approximateRange(
    input: string,
    quote: string,
    hintUtf16: number
): { start: number; end: number; rule: TApproximateAnchorRule } | undefined {
    const q = wordsOf(quote).map((w) => w.key)
    const t = wordsOf(input)
    const n = q.length
    if (n < APPROXIMATE_MIN_WORDS || t.length === 0) return undefined
    const allowed = Math.min(3, Math.floor(n / 8))

    // Edit distance of the quote to the best passage ending at each word,
    // with that passage's first word (free start: row 0 is all zeros).
    let dist = new Array<number>(t.length + 1).fill(0)
    let from = Array.from({ length: t.length + 1 }, (_, j) => j)
    for (let i = 1; i <= n; i++) {
        const nextDist = new Array<number>(t.length + 1)
        const nextFrom = new Array<number>(t.length + 1)
        nextDist[0] = i
        nextFrom[0] = 0
        for (let j = 1; j <= t.length; j++) {
            // Cheapest step; on a tie the earliest start, so a word the
            // quote dropped stays inside the passage instead of cutting it.
            const steps = [
                {
                    cost: dist[j - 1] + (q[i - 1] === t[j - 1].key ? 0 : 1),
                    start: from[j - 1],
                },
                { cost: dist[j] + 1, start: from[j] },
                { cost: nextDist[j - 1] + 1, start: nextFrom[j - 1] },
            ]
            const step = steps.reduce((a, b) =>
                b.cost < a.cost || (b.cost === a.cost && b.start < a.start)
                    ? b
                    : a
            )
            nextDist[j] = step.cost
            nextFrom[j] = step.start
        }
        dist = nextDist
        from = nextFrom
    }

    const candidates: { first: number; last: number; cost: number }[] = []
    for (let j = 1; j <= t.length; j++) {
        if (dist[j] <= allowed && from[j] < j) {
            candidates.push({ first: from[j], last: j - 1, cost: dist[j] })
        }
    }
    if (candidates.length > 0) {
        const cost = Math.min(...candidates.map((c) => c.cost))
        const tied = candidates.filter((c) => c.cost === cost)
        // Passages overlapping one another are the same place read with a
        // word more or less; prefer the quote's own length, then the hint.
        const best = tied.reduce((a, b) => {
            const lengthA = Math.abs(a.last - a.first + 1 - n)
            const lengthB = Math.abs(b.last - b.first + 1 - n)
            if (lengthA !== lengthB) return lengthA < lengthB ? a : b
            return Math.abs(t[a.first].start - hintUtf16) <=
                Math.abs(t[b.first].start - hintUtf16)
                ? a
                : b
        })
        const rival = candidates.some(
            (c) =>
                (c.last < best.first || c.first > best.last) &&
                c.cost <= best.cost
        )
        if (rival) return undefined
        return {
            start: t[best.first].start,
            end: t[best.last].end,
            rule: cost === 0 ? "normalized" : "reworded",
        }
    }

    // Longest run of consecutive words shared by quote and input.
    let run = 0
    let runEnds: number[] = []
    let previous = new Array<number>(t.length + 1).fill(0)
    for (let i = 1; i <= n; i++) {
        const current = new Array<number>(t.length + 1).fill(0)
        for (let j = 1; j <= t.length; j++) {
            if (q[i - 1] !== t[j - 1].key) continue
            current[j] = previous[j - 1] + 1
            if (current[j] > run) {
                run = current[j]
                runEnds = [j - 1]
            } else if (current[j] === run && !runEnds.includes(j - 1)) {
                runEnds.push(j - 1)
            }
        }
        previous = current
    }
    if (!(run >= 8 || (run >= APPROXIMATE_MIN_WORDS && run >= 0.6 * n))) {
        return undefined
    }
    // The same run found twice is an exact tie; the hint breaks it.
    const last = runEnds.reduce((a, b) =>
        Math.abs(t[a - run + 1].start - hintUtf16) <=
        Math.abs(t[b - run + 1].start - hintUtf16)
            ? a
            : b
    )
    return { start: t[last - run + 1].start, end: t[last].end, rule: "joined" }
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
 * both again with the quote's first character re-cased, and last an
 * approximate match (`approximateRange`), which the result marks. A quote
 * that matches none of them yields `undefined`.
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
    if (range !== undefined) {
        return {
            anchor: buildAnchor(input, range.start, range.end),
            occurrences: ranges.length,
        }
    }
    // Word boundaries are whitespace, so an approximate range can never
    // split a surrogate pair.
    const approximate = approximateRange(input, trimmed, hintUtf16)
    return approximate === undefined
        ? undefined
        : {
              anchor: buildAnchor(input, approximate.start, approximate.end),
              occurrences: 1,
              approximate: approximate.rule,
          }
}
