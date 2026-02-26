import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/index.js"

/** A single field-level change on an entity. */
export interface TCoreFieldChange {
    field: string
    before: unknown
    after: unknown
}

/** Field-level diff for a single matched entity. */
export interface TCoreEntityFieldDiff<T> {
    before: T
    after: T
    changes: TCoreFieldChange[]
}

/** Set-level diff for a collection of ID-keyed entities. */
export interface TCoreEntitySetDiff<T extends { id: string }> {
    added: T[]
    removed: T[]
    modified: TCoreEntityFieldDiff<T>[]
}

/** Premise diff includes nested expression diffs. */
export interface TCorePremiseDiff extends TCoreEntityFieldDiff<TCorePremise> {
    expressions: TCoreEntitySetDiff<TCorePropositionalExpression>
}

export interface TCorePremiseSetDiff {
    added: TCorePremise[]
    removed: TCorePremise[]
    modified: TCorePremiseDiff[]
}

/** Role changes between two argument versions. */
export interface TCoreRoleDiff {
    conclusion: { before: string | undefined; after: string | undefined }
    supportingAdded: string[]
    supportingRemoved: string[]
}

/** Top-level diff result from `diffArguments`. */
export interface TCoreArgumentDiff {
    argument: TCoreEntityFieldDiff<TCoreArgument>
    variables: TCoreEntitySetDiff<TCorePropositionalVariable>
    premises: TCorePremiseSetDiff
    roles: TCoreRoleDiff
}

/** A comparator receives two matched objects and returns field-level changes. */
export type TCoreFieldComparator<T> = (
    before: T,
    after: T
) => TCoreFieldChange[]

/** Per-entity comparator overrides for `diffArguments`. */
export interface TCoreDiffOptions {
    compareArgument?: TCoreFieldComparator<TCoreArgument>
    compareVariable?: TCoreFieldComparator<TCorePropositionalVariable>
    comparePremise?: TCoreFieldComparator<TCorePremise>
    compareExpression?: TCoreFieldComparator<TCorePropositionalExpression>
}
