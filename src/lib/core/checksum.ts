/**
 * FNV-1a 32-bit hash. Fast, non-cryptographic, browser-compatible.
 */
export function computeHash(input: string): string {
    let hash = 0x811c9dc5
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Deterministic JSON serialization with sorted keys at all levels.
 */
export function canonicalSerialize(value: unknown): string {
    return JSON.stringify(value, (_, v: unknown) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            const obj = v as Record<string, unknown>
            return Object.keys(obj)
                .sort()
                .reduce<Record<string, unknown>>((sorted, key) => {
                    sorted[key] = obj[key]
                    return sorted
                }, {})
        }
        return v
    })
}

/**
 * Compute checksum for an entity using only the specified fields.
 * Fields are sorted before hashing to ensure determinism regardless
 * of the order they are passed.
 */
export function entityChecksum(
    entity: Record<string, unknown>,
    fields: string[]
): string {
    const picked: Record<string, unknown> = {}
    for (const field of [...fields].sort()) {
        if (field in entity) {
            picked[field] = entity[field]
        }
    }
    return computeHash(canonicalSerialize(picked))
}
