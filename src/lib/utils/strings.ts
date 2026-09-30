/**
 * Shorten `value` to at most `limit` characters without cutting a word
 * in half: it ends at the last whole word that fits, followed by "…" so
 * a reader can see it was shortened. A value with no space to break at
 * inside the limit (a URL, a single long token) is cut at the limit
 * exactly. A value already within the limit is returned
 * unchanged.
 */
export function shortenToLength(value: string, limit: number): string {
    if (value.length <= limit) return value
    // The last whitespace inside the limit is where the last whole word
    // ends. It sits at index `limit - 1` at most, so the kept words plus
    // the "…" still fit. Trailing punctuation is dropped before the "…".
    const lastBreak = value.slice(0, limit).search(/\s\S*$/)
    const head =
        lastBreak > 0
            ? value.slice(0, lastBreak).replace(/[\s,;:.-]+$/, "")
            : ""
    return head.length > 0 ? head + "…" : value.slice(0, limit)
}
