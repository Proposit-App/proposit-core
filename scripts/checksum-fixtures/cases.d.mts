// Types for `cases.mjs`, so the TypeScript test can import it.

export type THierarchicalChecksums = {
    checksum: string
    descendantChecksum: string | null
    combinedChecksum: string
}

export type TChecksumRecord = {
    argument: THierarchicalChecksums
    roleState: { conclusionPremiseId?: string }
    collections: { premises: string | null; variables: string | null }
    premises: Record<string, THierarchicalChecksums>
    expressions: Record<string, THierarchicalChecksums>
    variables: Record<string, string>
}

export type TChecksumFixture = {
    capturedFrom: string
    cases: Record<string, TChecksumRecord>
}

export declare const CONFIG_NAMES: readonly string[]
export declare const STANDARD_SCENARIOS: readonly string[]
export declare const FORK_EXTERNAL_SCENARIOS: readonly string[]

export declare function countingIdGenerator(): () => string

/** `lib` is the package's main module: the local source or a published build. */
export declare function buildChecksumCases(
    lib: object,
    scenarios: readonly string[]
): Record<string, TChecksumRecord>
