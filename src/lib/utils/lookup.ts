import type {
    TClaimLookup,
    TSourceLookup,
    TClaimSourceLookup,
} from "../core/interfaces/library.interfaces.js"

/**
 * Creates a keyed lookup from an array of items. Items are indexed by a
 * composite string key (typically `"id:version"`), and the returned object
 * exposes a `get(id, version)` method that reconstructs the same key
 * internally.
 *
 * Use this to build the `TClaimLookup` or `TSourceLookup` required by
 * `ArgumentEngine`'s constructor from flat arrays (e.g. database query
 * results).
 *
 * @param items - The array of items to index.
 * @param getKey - A function that produces the composite key for each item.
 *   Must return a string of the form `"id:version"` so that the returned
 *   `get(id, version)` method can reconstruct it.
 * @returns An object with a `get(id, version)` method that looks up items
 *   by reconstructing the composite key. Returns `undefined` if no item
 *   matches.
 *
 * @example
 * ```ts
 * const claimLookup = createLookup(claims, (c) => `${c.id}:${c.version}`)
 * const sourceLookup = createLookup(sources, (s) => `${s.id}:${s.version}`)
 * const engine = new ArgumentEngine(arg, claimLookup, sourceLookup, ...)
 * ```
 */
export function createLookup<T>(
    items: T[],
    getKey: (item: T) => string
): { get(id: string, version: number): T | undefined } {
    const map = new Map<string, T>()
    for (const item of items) {
        map.set(getKey(item), item)
    }
    return {
        get(id: string, version: number): T | undefined {
            return map.get(`${id}:${version}`)
        },
    }
}

/**
 * A no-op claim lookup that always returns `undefined`. Use this when the
 * consumer does not use claims (e.g. an argument with no claim-bound
 * variables).
 */
export const EMPTY_CLAIM_LOOKUP: TClaimLookup = {
    get: () => undefined,
}

/**
 * A no-op source lookup that always returns `undefined`. Use this when the
 * consumer does not use sources.
 */
export const EMPTY_SOURCE_LOOKUP: TSourceLookup = {
    get: () => undefined,
}

/**
 * A no-op claim-source association lookup that always returns `undefined`
 * or empty arrays. Use this when the consumer does not use claim-source
 * associations.
 */
export const EMPTY_CLAIM_SOURCE_LOOKUP: TClaimSourceLookup = {
    getForClaim: () => [],
    getForSource: () => [],
    get: () => undefined,
}
