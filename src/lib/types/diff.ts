import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreSource,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
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
    TSource extends TCoreSource = TCoreSource,
> {
    argument: TCoreEntityFieldDiff<TArg>
    variables: TCoreEntitySetDiff<TVar>
    premises: TCorePremiseSetDiff<TPremise, TExpr>
    roles: TCoreRoleDiff
    sources: TCoreEntitySetDiff<TSource>
    variableSourceAssociations: TCoreEntitySetDiff<TCoreVariableSourceAssociation>
    expressionSourceAssociations: TCoreEntitySetDiff<TCoreExpressionSourceAssociation>
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
    TSource extends TCoreSource = TCoreSource,
> {
    compareArgument?: TCoreFieldComparator<TArg>
    compareVariable?: TCoreFieldComparator<TVar>
    comparePremise?: TCoreFieldComparator<TPremise>
    compareExpression?: TCoreFieldComparator<TExpr>
    compareSource?: TCoreFieldComparator<TSource>
    compareVariableSourceAssociation?: TCoreFieldComparator<TCoreVariableSourceAssociation>
    compareExpressionSourceAssociation?: TCoreFieldComparator<TCoreExpressionSourceAssociation>
}
