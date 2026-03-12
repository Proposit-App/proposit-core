import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
} from "../../schemata/index.js"
import type {
    TCoreSource,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../../schemata/index.js"
import type { TCoreMutationResult } from "../../types/mutation.js"

/**
 * Source CRUD, association management, and lookup for an argument.
 */
export interface TSourceManagement<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
> {
    /**
     * Registers a new source with this argument.
     *
     * @param source - The source entity to add, with optional checksum.
     * @returns The added source (with checksum) and changeset.
     * @throws If a source with the given ID already exists.
     */
    addSource(
        source: TOptionalChecksum<TSource>
    ): TCoreMutationResult<TSource, TExpr, TVar, TPremise, TArg, TSource>

    /**
     * Removes a source and any associations referencing it.
     *
     * @param sourceId - The ID of the source to remove.
     * @returns The removed source, or `undefined` if not found.
     */
    removeSource(
        sourceId: string
    ): TCoreMutationResult<
        TSource | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    >

    /**
     * Creates an association between a source and a variable.
     *
     * @param sourceId - The ID of the source.
     * @param variableId - The ID of the variable to associate.
     * @returns The created association and changeset.
     * @throws If the source does not exist.
     * @throws If the variable does not exist.
     * @throws If the association already exists.
     */
    addVariableSourceAssociation(
        sourceId: string,
        variableId: string
    ): TCoreMutationResult<
        TCoreVariableSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    >

    /**
     * Removes a variable–source association by its own ID.
     *
     * @param associationId - The ID of the association to remove.
     * @returns The removed association, or `undefined` if not found.
     */
    removeVariableSourceAssociation(
        associationId: string
    ): TCoreMutationResult<
        TCoreVariableSourceAssociation | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    >

    /**
     * Creates an association between a source and an expression within a
     * specific premise.
     *
     * @param sourceId - The ID of the source.
     * @param expressionId - The ID of the expression to associate.
     * @param premiseId - The ID of the premise that owns the expression.
     * @returns The created association and changeset.
     * @throws If the source does not exist.
     * @throws If the expression does not exist in the specified premise.
     * @throws If the association already exists.
     */
    addExpressionSourceAssociation(
        sourceId: string,
        expressionId: string,
        premiseId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    >

    /**
     * Removes an expression–source association by its own ID.
     *
     * @param associationId - The ID of the association to remove.
     * @returns The removed association, or `undefined` if not found.
     */
    removeExpressionSourceAssociation(
        associationId: string
    ): TCoreMutationResult<
        TCoreExpressionSourceAssociation | undefined,
        TExpr,
        TVar,
        TPremise,
        TArg,
        TSource
    >

    /**
     * Returns all registered sources sorted by ID.
     *
     * @returns An array of source entities.
     */
    getSources(): TSource[]

    /**
     * Returns the source with the given ID, or `undefined` if not found.
     *
     * @param sourceId - The source ID to look up.
     * @returns The source entity, or `undefined`.
     */
    getSource(sourceId: string): TSource | undefined

    /**
     * Returns all variable and expression associations for a given source.
     *
     * @param sourceId - The source ID to look up.
     * @returns An object with `variable` and `expression` association arrays.
     */
    getAssociationsForSource(sourceId: string): {
        variable: TCoreVariableSourceAssociation[]
        expression: TCoreExpressionSourceAssociation[]
    }

    /**
     * Returns all source associations for a given variable.
     *
     * @param variableId - The variable ID to look up.
     * @returns An array of variable–source associations.
     */
    getAssociationsForVariable(
        variableId: string
    ): TCoreVariableSourceAssociation[]

    /**
     * Returns all source associations for a given expression.
     *
     * @param expressionId - The expression ID to look up.
     * @returns An array of expression–source associations.
     */
    getAssociationsForExpression(
        expressionId: string
    ): TCoreExpressionSourceAssociation[]

    /**
     * Returns all variable–source associations across the argument.
     *
     * @returns An array of all variable–source association entities.
     */
    getAllVariableSourceAssociations(): TCoreVariableSourceAssociation[]

    /**
     * Returns all expression–source associations across the argument.
     *
     * @returns An array of all expression–source association entities.
     */
    getAllExpressionSourceAssociations(): TCoreExpressionSourceAssociation[]
}
