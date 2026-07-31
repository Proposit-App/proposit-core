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

/**
 * Returns a copy of `source` with every `undefined`-valued key removed.
 *
 * Entities in this library must never carry a key holding `undefined`. Two
 * things go wrong when they do. `entityChecksum` includes a field only when
 * the key is present, so clearing an app-level field by assigning `undefined`
 * would leave the entity hashing as though it were still set — and clearing has
 * to be exactly reversible. And `"field" in entity` becomes true, so any
 * downstream mapper that turns `undefined` into `null` flips the field from
 * absent to present, which moves the checksum of every entity of that kind.
 *
 * Applies wherever caller-supplied fields are spread into an entity: the
 * `setExtras` pair on both engines, and the parser's `map*` extension hooks.
 */
export function withoutUndefinedValues(
    source: Record<string, unknown>
): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(source).filter(([, value]) => value !== undefined)
    )
}

/** Returns a shallow-copied array of items sorted by `id` in lexicographic order. */
export function sortedCopyById<T extends { id: string }>(items: T[]): T[] {
    return [...items].sort((a, b) => a.id.localeCompare(b.id))
}

/** Deduplicates and sorts an iterable of strings. */
export function sortedUnique(values: Iterable<string>): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}
