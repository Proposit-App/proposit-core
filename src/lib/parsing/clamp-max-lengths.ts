import type { TSchema } from "typebox"

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

/**
 * Recursively walks a TypeBox schema and a data value in tandem,
 * shortening any string that exceeds its schema's `maxLength` (see
 * `shortenToLength`).
 *
 * Mutates `data` in place (caller is expected to pass throwaway data).
 * Handles objects, arrays, and TypeBox `Nullable` unions (`anyOf` with
 * a `null` type branch).
 */
export function clampMaxLengths(schema: TSchema, data: unknown): void {
    if (data === null || data === undefined) return

    // Handle Nullable / discriminated-union schemas — recurse into every
    // non-null branch. For Nullable<T> this is just T. For an n-ary union
    // (e.g. a discriminated claim union) each branch's properties are
    // applied independently; fields absent from a branch are skipped, and
    // string clamping is idempotent so branches with overlapping fields
    // converge on the smallest maxLength.
    const anyOf = (schema as Record<string, unknown>).anyOf as
        | TSchema[]
        | undefined
    if (anyOf) {
        for (const branch of anyOf) {
            if ((branch as Record<string, unknown>).type === "null") continue
            clampMaxLengths(branch, data)
        }
        return
    }

    const schemaType = (schema as Record<string, unknown>).type as
        | string
        | undefined

    if (schemaType === "object" && typeof data === "object") {
        const properties = (schema as Record<string, unknown>).properties as
            | Record<string, TSchema>
            | undefined
        if (!properties) return
        const obj = data as Record<string, unknown>
        for (const [key, propSchema] of Object.entries(properties)) {
            if (!(key in obj)) continue
            const value = obj[key]

            const propType = (propSchema as Record<string, unknown>).type as
                | string
                | undefined

            if (propType === "string" && typeof value === "string") {
                const maxLength = (propSchema as Record<string, unknown>)
                    .maxLength as number | undefined
                if (
                    maxLength !== undefined &&
                    maxLength >= 0 &&
                    value.length > maxLength
                ) {
                    obj[key] = shortenToLength(value, maxLength)
                }
            } else {
                clampMaxLengths(propSchema, value)
            }
        }
        return
    }

    if (schemaType === "array" && Array.isArray(data)) {
        const itemSchema = (schema as Record<string, unknown>).items as
            | TSchema
            | undefined
        if (!itemSchema) return
        for (const element of data) {
            clampMaxLengths(itemSchema, element)
        }
    }
}
