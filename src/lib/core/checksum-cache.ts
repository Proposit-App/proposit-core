/**
 * Lazily-flushed cache of an entity's hierarchical checksums (meta /
 * descendant / combined). Subclasses implement {@link flushChecksums}, which
 * must populate the three cached fields and clear {@link checksumDirty}; the
 * accessors below flush on demand and return the cached value.
 */
export abstract class HierarchicalChecksumCache {
    protected checksumDirty = true
    protected cachedMetaChecksum: string | undefined
    protected cachedDescendantChecksum: string | null | undefined
    protected cachedCombinedChecksum: string | undefined

    public checksum(): string {
        if (this.checksumDirty || this.cachedMetaChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedMetaChecksum!
    }

    public descendantChecksum(): string | null {
        if (this.checksumDirty || this.cachedDescendantChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedDescendantChecksum!
    }

    public combinedChecksum(): string {
        if (this.checksumDirty || this.cachedCombinedChecksum === undefined) {
            this.flushChecksums()
        }
        return this.cachedCombinedChecksum!
    }

    public abstract flushChecksums(): void
}
