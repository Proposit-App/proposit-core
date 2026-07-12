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

/**
 * The four states a matched-or-membership entity can occupy in a diff.
 *
 * `added` / `removed` are expressed purely by array membership
 * (`TCoreEntitySetDiff.added` / `.removed`); they are never stored on a record.
 * The `state` field on a matched record carries only the `modified-*` pair:
 *
 * - `modified-own` — the entity's own comparator reported field changes (its
 *   own `checksum` differs).
 * - `modified-within` — own fields unchanged, but a containment child changed
 *   or a referenced entity is `modified-own` (a claim/variable edit reaching it
 *   through the reference edge).
 */
export type TCoreDiffState =
    | "added"
    | "removed"
    | "modified-own"
    | "modified-within"

/** Field-level diff for a single matched entity. */
export interface TCoreEntityFieldDiff<T> {
    before: T
    after: T
    changes: TCoreFieldChange[]
    state: "modified-own" | "modified-within"
}

/** Set-level diff for a collection of ID-keyed entities. */
export interface TCoreEntitySetDiff<T extends { id: string }> {
    added: T[]
    removed: T[]
    modified: TCoreEntityFieldDiff<T>[]
}

/** Premise diff includes nested expression diffs. */
export interface TCorePremiseDiff<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> extends TCoreEntityFieldDiff<TPremise> {
    expressions: TCoreEntitySetDiff<TExpr>
}

export interface TCorePremiseSetDiff<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    added: TPremise[]
    removed: TPremise[]
    modified: TCorePremiseDiff<TPremise, TExpr>[]
}

/** Role changes between two argument versions. */
export interface TCoreRoleDiff {
    conclusion: { before: string | undefined; after: string | undefined }
}

/** Top-level diff result from `diffArguments`. */
export interface TCoreArgumentDiff<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    argument: TCoreEntityFieldDiff<TArg>
    variables: TCoreEntitySetDiff<TVar>
    premises: TCorePremiseSetDiff<TPremise, TExpr>
    roles: TCoreRoleDiff
}

/** A comparator receives two matched objects and returns field-level changes. */
export type TCoreFieldComparator<T> = (
    before: T,
    after: T
) => TCoreFieldChange[]

/** Per-entity comparator overrides for `diffArguments`. */
export interface TCoreDiffOptions<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    compareArgument?: TCoreFieldComparator<TArg>
    compareVariable?: TCoreFieldComparator<TVar>
    comparePremise?: TCoreFieldComparator<TPremise>
    compareExpression?: TCoreFieldComparator<TExpr>
    /** Custom entity matcher for pairing premises. Default: match by ID. */
    premiseMatcher?: (a: TPremise, b: TPremise) => boolean
    /** Custom entity matcher for pairing variables. Default: match by ID. */
    variableMatcher?: (a: TVar, b: TVar) => boolean
    /** Custom entity matcher for pairing expressions. Default: match by ID. */
    expressionMatcher?: (a: TExpr, b: TExpr) => boolean
}
