import type {
    TClaimBoundVariable,
    TPremiseBoundVariable,
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
} from "../../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreArgumentRoleState,
    TCoreExpressionAssignment,
    TCoreValidationResult,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
} from "../../types/evaluation.js"
import type { TCoreMutationResult } from "../../types/mutation.js"
import type { TReactiveSnapshot } from "../../types/reactive.js"
import type { TInvariantValidationResult } from "../../types/validation.js"
import type { PremiseEngine } from "../premise-engine.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"

/**
 * Premise creation, removal, and lookup.
 */
export interface TPremiseCrud<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Creates a new premise with an auto-generated UUID and registers it
     * with this engine.
     *
     * @param extras - Optional extra metadata to attach to the premise.
     * @returns The newly created PremiseEngine instance and changeset.
     */
    createPremise(
        extras?: Record<string, unknown>,
        symbol?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    /**
     * Creates a premise with a caller-supplied ID and registers it with
     * this engine.
     *
     * @param id - The ID to assign to the new premise.
     * @param extras - Optional extra metadata to attach to the premise.
     * @returns The newly created PremiseEngine instance and changeset.
     * @throws If a premise with the given ID already exists.
     */
    createPremiseWithId(
        id: string,
        extras?: Record<string, unknown>,
        symbol?: string
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    /**
     * Removes a premise and clears any role assignments that reference it.
     *
     * @param premiseId - The ID of the premise to remove.
     * @returns The removed premise data, or `undefined` if not found.
     */
    removePremise(
        premiseId: string
    ): TCoreMutationResult<TPremise | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Returns the premise with the given ID, or `undefined` if not found.
     *
     * @param premiseId - The ID of the premise to retrieve.
     * @returns The PremiseEngine instance, or `undefined`.
     */
    getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
    /**
     * Returns `true` if a premise with the given ID exists.
     *
     * @param premiseId - The ID to check.
     * @returns Whether the premise exists.
     */
    hasPremise(premiseId: string): boolean
    /**
     * Returns all premise IDs in lexicographic order.
     *
     * @returns An array of premise ID strings.
     */
    listPremiseIds(): string[]
    /**
     * Returns all premises in lexicographic ID order.
     *
     * @returns An array of PremiseEngine instances.
     */
    listPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    /**
     * Returns the PremiseEngine containing the given expression, or
     * `undefined`.
     *
     * @param expressionId - The expression ID to search for.
     * @returns The owning PremiseEngine, or `undefined`.
     */
    findPremiseByExpressionId(
        expressionId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
}

/**
 * Variable CRUD and lookup across the argument.
 */
export interface TVariableManagement<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Registers a propositional variable for use across all premises.
     *
     * @param variable - The variable entity to register.
     * @returns The registered variable (with checksum) and changeset.
     * @throws If `variable.symbol` is already in use.
     * @throws If `variable.id` already exists.
     * @throws If the variable does not belong to this argument.
     */
    addVariable(
        variable: TOptionalChecksum<TClaimBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
    /**
     * Registers a premise-bound propositional variable whose truth value is
     * derived from another premise's evaluation.
     *
     * @param variable - The premise-bound variable entity to register.
     * @returns The registered variable (with checksum) and changeset.
     * @throws If `variable.symbol` is already in use.
     * @throws If `variable.id` already exists.
     * @throws If `variable.boundPremiseId` does not exist in this argument.
     * @throws If `variable.boundArgumentId` does not match this argument.
     * @throws If the variable does not belong to this argument.
     */
    bindVariableToPremise(
        variable: TOptionalChecksum<TPremiseBoundVariable> &
            Record<string, unknown>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
    /**
     * Updates fields on an existing variable. Since all premises share the
     * same VariableManager, the update is immediately visible everywhere.
     *
     * @param variableId - The ID of the variable to update.
     * @param updates - Fields to update. For claim-bound variables: `symbol`,
     *   `claimId`, `claimVersion`. For premise-bound variables: `symbol`,
     *   `boundPremiseId`, `boundArgumentId`, `boundArgumentVersion`.
     *   `claimId` and `claimVersion` must be provided together on claim-bound variables.
     * @returns The updated variable, or `undefined` if not found.
     * @throws If the new symbol is already in use by a different variable.
     * @throws If the new claim reference does not exist in the claim library.
     * @throws If updates include fields from the wrong binding type (e.g., `boundPremiseId` on a claim-bound variable).
     * @throws If the new `boundPremiseId` does not exist in this argument.
     */
    updateVariable(
        variableId: string,
        updates: Record<string, unknown>
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Removes a variable and cascade-deletes all expressions referencing it
     * across every premise (including subtrees and operator collapse).
     *
     * @param variableId - The ID of the variable to remove.
     * @returns The removed variable, or `undefined` if not found.
     */
    removeVariable(
        variableId: string
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Returns the variable with the given ID, or `undefined` if not found.
     *
     * @param variableId - The variable ID to look up.
     * @returns The variable entity, or `undefined`.
     */
    getVariable(variableId: string): TVar | undefined
    /**
     * Returns `true` if a variable with the given ID exists.
     *
     * @param variableId - The variable ID to check.
     * @returns Whether the variable exists.
     */
    hasVariable(variableId: string): boolean
    /**
     * Returns the variable with the given symbol, or `undefined` if not
     * found.
     *
     * @param symbol - The symbol string to look up.
     * @returns The variable entity, or `undefined`.
     */
    getVariableBySymbol(symbol: string): TVar | undefined
    /**
     * Returns all registered variables sorted by ID.
     *
     * @returns An array of variable entities.
     */
    getVariables(): TVar[]
    /**
     * Builds a Map keyed by a caller-supplied function over all variables.
     * Useful for indexing by extension fields (e.g. statementId). The
     * caller should cache the result — this is O(n) per call.
     *
     * @param keyFn - A function that extracts the map key from a variable.
     * @returns A Map from the extracted key to the variable.
     */
    buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar>
    /**
     * Returns all premise-bound variables whose `boundPremiseId` matches the
     * given premise ID. This is a linear scan over all variables.
     *
     * @param premiseId - The premise ID to filter by.
     * @returns An array of variables bound to the given premise.
     */
    getVariablesBoundToPremise(premiseId: string): TVar[]
}

/**
 * Cross-premise expression lookups and analysis.
 */
export interface TArgumentExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    /**
     * Returns an expression by ID from any premise, or `undefined` if not
     * found.
     *
     * @param expressionId - The expression ID to look up.
     * @returns The expression entity, or `undefined`.
     */
    getExpression(expressionId: string): TExpr | undefined
    /**
     * Returns `true` if an expression with the given ID exists in any
     * premise.
     *
     * @param expressionId - The expression ID to check.
     * @returns Whether the expression exists.
     */
    hasExpression(expressionId: string): boolean
    /**
     * Returns the premise ID that contains the given expression, or
     * `undefined`.
     *
     * @param expressionId - The expression ID to look up.
     * @returns The owning premise ID, or `undefined`.
     */
    getExpressionPremiseId(expressionId: string): string | undefined
    /**
     * Returns all expressions across all premises, sorted by ID.
     *
     * @returns An array of expression entities.
     */
    getAllExpressions(): TExpr[]
    /**
     * Returns all expressions that reference the given variable ID, across
     * all premises.
     *
     * @param variableId - The variable ID to search for.
     * @returns An array of referencing expression entities.
     */
    getExpressionsByVariableId(variableId: string): TExpr[]
    /**
     * Returns the root expression from each premise that has one.
     *
     * @returns An array of root expression entities.
     */
    listRootExpressions(): TExpr[]
    /**
     * Collects all variables referenced by expressions across all premises,
     * indexed both by variable ID and by symbol.
     *
     * @returns An object with `variableIds`, `byId`, and `bySymbol` indexes.
     */
    collectReferencedVariables(): {
        variableIds: string[]
        byId: Record<string, { symbol: string; premiseIds: string[] }>
        bySymbol: Record<
            string,
            { variableIds: string[]; premiseIds: string[] }
        >
    }
}

/**
 * Conclusion and supporting premise role management.
 */
export interface TArgumentRoleState<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Returns the conclusion premise, or `undefined` if none is set.
     *
     * @returns The conclusion PremiseEngine, or `undefined`.
     */
    getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar>
        | undefined
    /**
     * Returns all supporting premises (derived: inference premises that are
     * not the conclusion) in lexicographic ID order.
     *
     * @returns An array of supporting PremiseEngine instances.
     */
    listSupportingPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    /**
     * Designates a premise as the argument's conclusion.
     *
     * @param premiseId - The ID of the premise to designate.
     * @returns The updated role state and changeset.
     * @throws If the premise does not exist.
     */
    setConclusionPremise(
        premiseId: string
    ): TCoreMutationResult<TCoreArgumentRoleState, TExpr, TVar, TPremise, TArg>
    /**
     * Clears the conclusion designation.
     *
     * @returns The updated role state and changeset.
     */
    clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    /**
     * Returns the current role assignments (conclusion premise ID only;
     * supporting is derived).
     *
     * @returns The current argument role state.
     */
    getRoleState(): TCoreArgumentRoleState
}

/**
 * Argument-level evaluation: single-assignment evaluation, evaluability
 * validation, and exhaustive validity checking.
 */
export interface TArgumentEvaluation {
    /**
     * Validates that this argument is structurally ready for evaluation: a
     * conclusion must be set, all role references must point to existing
     * premises, variable ID/symbol mappings must be consistent, and every
     * premise must be individually evaluable.
     *
     * @returns A validation result with any issues found.
     */
    validateEvaluability(): TCoreValidationResult
    /**
     * Evaluates the argument under a three-valued expression assignment.
     *
     * Variables may be `true`, `false`, or `null` (unknown). All result
     * flags (`isAdmissibleAssignment`, `isCounterexample`, etc.) are
     * three-valued: `null` means indeterminate due to unknown variable
     * values.
     *
     * @param assignment - The variable assignment and optional rejected
     *   expression IDs.
     * @param options - Optional evaluation options.
     * @returns The evaluation result, or `{ ok: false }` with validation
     *   details if the argument is not structurally evaluable.
     */
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult
    /**
     * Enumerates all 2^n variable assignments and checks for
     * counterexamples.
     *
     * A counterexample is an admissible assignment where all supporting
     * premises are true but the conclusion is false. The argument is valid
     * if no counterexamples exist.
     *
     * @param options - Optional limits on variables/assignments checked
     *   and early termination mode.
     * @returns The validity check result including any counterexamples.
     */
    checkValidity(options?: TCoreValidityCheckOptions): TCoreValidityCheckResult
}

/**
 * Snapshot, rollback, and reactive subscription lifecycle.
 * Static factory methods (fromSnapshot, fromData) are class-level only.
 */
export interface TArgumentLifecycle<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Registers a listener that is called after every mutation.
     *
     * @param listener - The callback to invoke on mutation.
     * @returns An unsubscribe function that removes the listener.
     */
    subscribe(listener: () => void): () => void
    /**
     * Returns the current reactive snapshot for external store consumption.
     *
     * @returns The reactive snapshot.
     */
    getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
    /**
     * Returns a serializable snapshot of the full engine state.
     *
     * @returns The engine snapshot.
     */
    snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    /**
     * Restores the engine to a previously captured snapshot state.
     *
     * @param snapshot - The snapshot to restore from.
     */
    rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void
    /**
     * Run a comprehensive invariant validation sweep on the entire argument.
     * Checks schema conformance, structural invariants, grammar rules,
     * reference integrity, and checksum consistency.
     */
    validate(): TInvariantValidationResult
}

/**
 * Argument entity access.
 */
export interface TArgumentIdentity<TArg extends TCoreArgument = TCoreArgument> {
    /**
     * Returns a shallow copy of the argument metadata with checksum
     * attached.
     *
     * @returns The argument entity.
     */
    getArgument(): TArg
}
