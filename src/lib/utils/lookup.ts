import type {
    TClaimLookup,
    TClaimConnectionLookup,
} from "../core/interfaces/library.interfaces.js"
import type { TCoreClaimConnection } from "../schemata/claim-connection.js"

/**
 * Creates a keyed lookup from an array of items. Items are indexed by a
 * composite string key (typically `"id:version"`), and the returned object
 * exposes a `get(id, version)` method that reconstructs the same key
 * internally.
 *
 * Use this to build the `TClaimLookup` required by `ArgumentEngine`'s
 * constructor from flat arrays (e.g. database query results).
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
 * const engine = new ArgumentEngine(arg, claimLookup, ...)
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
    getCurrent: () => undefined,
}

/**
 * Returns an empty claim-connection lookup. Use this in tests and contexts
 * that need the lookup contract but have no actual data. Each call returns
 * a fresh empty implementation; values are stateless.
 *
 * @example
 *   const emptyCitations = emptyClaimConnectionLookup<TCoreClaimCitation>()
 *   const emptyAxioms = emptyClaimConnectionLookup<TCoreClaimAxiom>()
 */
export function emptyClaimConnectionLookup<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
>(): TClaimConnectionLookup<TConn> {
    return {
        getConnectionsForClaim: () => [],
        get: () => undefined,
    }
}
