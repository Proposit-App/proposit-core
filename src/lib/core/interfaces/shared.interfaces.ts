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
 * An entity that can produce a deterministic content checksum.
 */
export interface TChecksummable {
    /**
     * Returns a deterministic content checksum. Computed lazily — only
     * recalculated when state has changed.
     *
     * @returns A hex-encoded checksum string.
     */
    checksum(): string
}
