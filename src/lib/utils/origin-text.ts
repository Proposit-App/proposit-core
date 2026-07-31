// Origin-text normalization and code-point addressing.
//
// An origin document's text is the coordinate system every anchor indexes
// into, so `normalizeOriginText` defines what those coordinates mean.
//
// TREAT ANY LATER EDIT TO `normalizeOriginText` AS A DATA MIGRATION, NOT A
// BUG FIX. Every stored anchor is an offset into text this function produced;
// changing what it emits re-indexes all of them silently.
//
// Positions are counted in Unicode code points, per the W3C Web Annotation
// Data Model's normative requirement that a text selection be expressed "in
// terms of unicode code points (the 'character number'), not in terms of code
// units". `Intl.Segmenter` and the grapheme-splitting libraries segment
// grapheme clusters — a different unit that would silently yield wrong
// offsets — so only the built-in string iterator is used here.

/**
 * Adjacency test for a zero width joiner: pictographs, the emoji variation
 * selector, and skin-tone modifiers are the characters that legitimately sit
 * beside one.
 */
const EMOJI_ADJACENT = /[\p{Extended_Pictographic}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/u

/** A variation selector is doing real work after a pictograph, an emoji component (a keycap base, say), or a CJK ideograph. */
const VARIATION_SELECTOR_BASE =
    /[\p{Extended_Pictographic}\p{Emoji_Component}\p{Ideographic}]/u

/** A Mongolian free variation selector is doing real work only after Mongolian script. */
const MONGOLIAN_BASE = /\p{Script=Mongolian}/u

/** A tag-character run is an emoji tag sequence only when it starts right after a pictograph. */
const PICTOGRAPH = /\p{Extended_Pictographic}/u

/** Every line-break form the normalizer folds to LF. Removing them instead would join two lines, which is a content change. */
const LINE_BREAK_FORMS = /\r\n|\r|\u0085|\u2028|\u2029/g

const TAG_RANGE_START = 0xe0000
const TAG_RANGE_END = 0xe007f

/**
 * Whether a code point is a candidate for removal — either unconditionally
 * (controls, bidi overrides, zero-width characters) or subject to a
 * preservation check in `isLegitimateInContext`.
 *
 * Carriage return, NEL, and the line/paragraph separators are absent by
 * design: the line-break step has already folded them to LF.
 */
function isRemovalCandidate(code: number): boolean {
    return (
        code <= 0x08 ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        (code >= 0x7f && code <= 0x9f) ||
        code === 0x00ad ||
        code === 0x061c ||
        (code >= 0x180b && code <= 0x180f) ||
        (code >= 0x200b && code <= 0x200f) ||
        (code >= 0x202a && code <= 0x202e) ||
        (code >= 0x2060 && code <= 0x2064) ||
        (code >= 0x2066 && code <= 0x2069) ||
        (code >= 0xfe00 && code <= 0xfe0f) ||
        code === 0xfeff ||
        (code >= TAG_RANGE_START && code <= TAG_RANGE_END)
    )
}

/**
 * Whether a removal candidate is doing legitimate work where it sits.
 *
 * These four boundaries are the hard part of invisible-character stripping:
 * naive removal breaks family and profession emoji, keycaps, CJK variation
 * sequences, Mongolian text, and flag tag sequences.
 *
 * **A removal candidate never legitimizes another removal candidate.** The
 * joiner, the variation selectors, and the tag characters all satisfy the
 * emoji-adjacency and variation-selector-base tests themselves, so a rule that
 * consulted the raw input would keep a character on the strength of a
 * neighbour that was being deleted in the same pass — and a second pass, seeing
 * that neighbour gone, would then delete it too. That is what `emitted`
 * enforces: the backward look reads only what actually survived, and the one
 * forward look (the joiner's) rejects a candidate outright.
 */
function isLegitimateInContext(
    emitted: readonly string[],
    codePoints: readonly string[],
    index: number,
    code: number
): boolean {
    const previous = emitted.length > 0 ? emitted[emitted.length - 1] : ""
    if (code === 0x200d) {
        if (previous !== "" && EMOJI_ADJACENT.test(previous)) return true
        const next = index + 1 < codePoints.length ? codePoints[index + 1] : ""
        if (next === "") return false
        const nextCode = next.codePointAt(0) ?? 0
        return !isRemovalCandidate(nextCode) && EMOJI_ADJACENT.test(next)
    }
    if (code >= 0xfe00 && code <= 0xfe0f) {
        return previous !== "" && VARIATION_SELECTOR_BASE.test(previous)
    }
    if (code >= 0x180b && code <= 0x180f) {
        return previous !== "" && MONGOLIAN_BASE.test(previous)
    }
    if (code >= TAG_RANGE_START && code <= TAG_RANGE_END) {
        let start = emitted.length
        while (start > 0) {
            const preceding = emitted[start - 1].codePointAt(0) ?? 0
            if (preceding < TAG_RANGE_START || preceding > TAG_RANGE_END) break
            start--
        }
        const base = start > 0 ? emitted[start - 1] : ""
        return base !== "" && PICTOGRAPH.test(base)
    }
    return false
}

function stripInvisibleCharacters(text: string): string {
    const codePoints = Array.from(text)
    const emitted: string[] = []
    for (let i = 0; i < codePoints.length; i++) {
        const char = codePoints[i]
        const code = char.codePointAt(0) ?? 0
        if (
            isRemovalCandidate(code) &&
            !isLegitimateInContext(emitted, codePoints, i, code)
        ) {
            continue
        }
        emitted.push(char)
    }
    return emitted.join("")
}

/**
 * Normalizes an origin document's text for *encoding*, never for content.
 *
 * Does: folds every line-break form to LF; strips the byte-order mark,
 * control characters other than LF and tab, bidirectional controls,
 * zero-width characters, tag characters, and stray variation selectors —
 * while preserving emoji ZWJ, keycap, CJK, Mongolian, and emoji-tag
 * sequences; composes to Unicode NFC; trims leading and trailing whitespace.
 *
 * Does not: collapse internal whitespace, reflow paragraphs, fold smart
 * quotes or dashes, case-fold, or strip punctuation, diacritics, emoji, or
 * non-ASCII characters. The document is meant to be the original.
 *
 * Idempotent — `normalizeOriginText(normalizeOriginText(t))` equals
 * `normalizeOriginText(t)` — which is what makes it safe to apply both at an
 * application's import boundary and again on document creation.
 *
 * Two things make it idempotent, and both are load-bearing.
 *
 * The step order. Line breaks are folded first because a lone carriage return
 * is itself a control character, so stripping first would delete the break
 * rather than convert it. Stripping precedes NFC because removing an invisible
 * character can leave a base letter adjacent to a combining mark it was
 * previously separated from; composing first would leave that pair for a second
 * application to compose. NFC never emits a control, an invisible, or a line
 * break, so the reverse hazard does not exist.
 *
 * And the rule that a removal candidate never legitimizes another removal
 * candidate — see `isLegitimateInContext`. Without it a character survives on
 * the strength of a neighbour deleted in the same pass, and the next pass
 * deletes it too.
 */
export function normalizeOriginText(text: string): string {
    const withUnixLineBreaks = text.replace(LINE_BREAK_FORMS, "\n")
    const stripped = stripInvisibleCharacters(withUnixLineBreaks)
    return stripped.normalize("NFC").trim()
}

/** The number of Unicode code points in a string — not its UTF-16 `length`. */
export function codePointLength(text: string): number {
    let count = 0
    for (let i = 0; i < text.length; ) {
        const code = text.codePointAt(i)
        i += code !== undefined && code > 0xffff ? 2 : 1
        count++
    }
    return count
}

/**
 * A reusable code-point↔UTF-16 offset map for one document.
 *
 * Build it once per document and reuse it across that document's anchors;
 * resolving N anchors with `sliceByCodePoints` instead costs a full scan per
 * anchor.
 */
export type TCodePointIndex = {
    readonly text: string
    /** UTF-16 offset of each code point, with one extra entry for the end of the string. */
    readonly offsets: readonly number[]
}

/** Builds the reusable offset map described by {@link TCodePointIndex}. */
export function buildCodePointIndex(text: string): TCodePointIndex {
    const offsets: number[] = []
    for (let i = 0; i < text.length; ) {
        offsets.push(i)
        const code = text.codePointAt(i)
        i += code !== undefined && code > 0xffff ? 2 : 1
    }
    offsets.push(text.length)
    return { text, offsets }
}

function clamp(value: number, low: number, high: number): number {
    return value < low ? low : value > high ? high : value
}

/**
 * Slices a string by **code-point** offsets.
 *
 * `String.prototype.slice` on the same offsets is wrong for any text
 * containing an astral-plane character, and passes every ASCII test — which
 * is why anchor fields are named `startCodePoint` / `endCodePoint` and why
 * this helper exists. Offsets are clamped rather than rejected; range
 * checking against a document belongs to the origin library's validation.
 */
export function sliceByCodePoints(
    text: string,
    startCodePoint: number,
    endCodePoint: number
): string {
    return sliceByCodePointsIndexed(
        buildCodePointIndex(text),
        startCodePoint,
        endCodePoint
    )
}

/** {@link sliceByCodePoints} against a prebuilt {@link TCodePointIndex}. */
export function sliceByCodePointsIndexed(
    index: TCodePointIndex,
    startCodePoint: number,
    endCodePoint: number
): string {
    const total = index.offsets.length - 1
    const start = clamp(startCodePoint, 0, total)
    const end = clamp(endCodePoint, start, total)
    return index.text.slice(index.offsets[start], index.offsets[end])
}
