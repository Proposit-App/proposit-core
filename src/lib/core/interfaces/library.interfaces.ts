import type { TCoreAssertion } from "../../schemata/assertion.js"
import type { TCoreSource } from "../../schemata/source.js"

/** Narrow read-only interface for assertion lookups. Used by ArgumentEngine for validation. */
export interface TAssertionLookup<
    TAssertion extends TCoreAssertion = TCoreAssertion,
> {
    get(id: string, version: number): TAssertion | undefined
}

/** Narrow read-only interface for source lookups. Used by ArgumentEngine for validation. */
export interface TSourceLookup<TSource extends TCoreSource = TCoreSource> {
    get(id: string, version: number): TSource | undefined
}

/** Serializable snapshot of an AssertionLibrary. */
export type TAssertionLibrarySnapshot<
    TAssertion extends TCoreAssertion = TCoreAssertion,
> = {
    assertions: TAssertion[]
}

/** Serializable snapshot of a SourceLibrary. */
export type TSourceLibrarySnapshot<TSource extends TCoreSource = TCoreSource> =
    {
        sources: TSource[]
    }
