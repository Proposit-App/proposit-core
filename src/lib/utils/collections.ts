/**
 * Returns the value for `key` from `map`, creating and inserting it via
 * `makeDefault` if absent.
 */
export function getOrCreate<K, V>(
    map: Map<K, V>,
    key: K,
    makeDefault: () => V
): V {
    const existing = map.get(key)
    if (existing !== undefined) {
        return existing
    }

    const value = makeDefault()
    map.set(key, value)
    return value
}

/** Returns a shallow-copied array of items sorted by `id` in lexicographic order. */
export function sortedCopyById<T extends { id: string }>(items: T[]): T[] {
    return [...items]
        .map((item) => ({ ...item }))
        .sort((a, b) => a.id.localeCompare(b.id))
}

/** Deduplicates and sorts an iterable of strings. */
export function sortedUnique(values: Iterable<string>): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}
