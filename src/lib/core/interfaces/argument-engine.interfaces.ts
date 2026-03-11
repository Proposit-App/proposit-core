import type {
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
    createPremise(
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    createPremiseWithId(
        id: string,
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    removePremise(
        premiseId: string
    ): TCoreMutationResult<TPremise | undefined, TExpr, TVar, TPremise, TArg>
    getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
    hasPremise(premiseId: string): boolean
    listPremiseIds(): string[]
    listPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
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
    addVariable(
        variable: TOptionalChecksum<TVar>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
    updateVariable(
        variableId: string,
        updates: { symbol?: string }
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    removeVariable(
        variableId: string
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    getVariable(variableId: string): TVar | undefined
    hasVariable(variableId: string): boolean
    getVariableBySymbol(symbol: string): TVar | undefined
    getVariables(): TVar[]
    buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar>
}

/**
 * Cross-premise expression lookups and analysis.
 */
export interface TArgumentExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    getExpression(expressionId: string): TExpr | undefined
    hasExpression(expressionId: string): boolean
    getExpressionPremiseId(expressionId: string): string | undefined
    getAllExpressions(): TExpr[]
    getExpressionsByVariableId(variableId: string): TExpr[]
    listRootExpressions(): TExpr[]
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
    getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar>
        | undefined
    listSupportingPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    setConclusionPremise(
        premiseId: string
    ): TCoreMutationResult<TCoreArgumentRoleState, TExpr, TVar, TPremise, TArg>
    clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    getRoleState(): TCoreArgumentRoleState
}

/**
 * Argument-level evaluation: single-assignment evaluation, evaluability
 * validation, and exhaustive validity checking.
 */
export interface TArgumentEvaluation {
    validateEvaluability(): TCoreValidationResult
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult
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
    subscribe(listener: () => void): () => void
    getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
    snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void
}

/**
 * Argument entity access.
 */
export interface TArgumentIdentity<TArg extends TCoreArgument = TCoreArgument> {
    getArgument(): TArg
}
