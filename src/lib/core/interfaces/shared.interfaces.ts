/**
 * An entity that can produce a human-readable display string.
 */
export interface TDisplayable {
    /**
     * Renders the entity as a human-readable string.
     *
     * @returns A human-readable display string.
     */
    toDisplayString(): string
}

/**
 * An entity that can produce hierarchical content checksums:
 * meta (entity-only), descendant (children), and combined (both).
 */
export interface THierarchicalChecksummable<
    TCollectionName extends string = string,
> {
    /** Returns the meta checksum — derived from entity data only. */
    checksum(): string
    /** Returns the descendant checksum — derived from children's combinedChecksums. Null if no children. */
    descendantChecksum(): string | null
    /** Returns the combined checksum — hash(checksum + descendantChecksum), or equals checksum if no descendants. */
    combinedChecksum(): string
    /** Returns the checksum for a named descendant collection. Null if collection is empty. */
    getCollectionChecksum(name: TCollectionName): string | null
    /** Forces recomputation of all dirty checksums in the hierarchy. */
    flushChecksums(): void
}
