import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCorePremise,
} from "../schemata/propositional.js"
import type {
    TCoreArgument,
    TCoreArgumentRoleState,
} from "../schemata/argument.js"
import type {
    TCoreSource,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"
/** Added/modified/removed entities of one type within a single mutation. */
export interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[]
    removed: T[]
}

/**
 * Entity-typed changeset produced by every mutating operation.
 * Only categories that were actually affected are present.
 */
export interface TCoreChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
    TSource extends TCoreSource = TCoreSource,
> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    /** New role state, present only when roles changed. */
    roles?: TCoreArgumentRoleState
    /** New argument metadata, present only when argument changed. */
    argument?: TArg
    sources?: TCoreEntityChanges<TSource>
    variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>
    expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>
}

/**
 * Every mutating method returns this wrapper.
 * `result` is the direct answer (e.g. the removed expression).
 * `changes` is the full set of DB-level side effects.
 */
export interface TCoreMutationResult<
    T,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
    TSource extends TCoreSource = TCoreSource,
> {
    result: T
    changes: TCoreChangeset<TExpr, TVar, TPremise, TArg, TSource>
}
