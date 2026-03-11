/**
 * An entity that can produce a human-readable display string.
 */
export interface TDisplayable {
    toDisplayString(): string
}

/**
 * An entity that can produce a deterministic content checksum.
 */
export interface TChecksummable {
    checksum(): string
}
