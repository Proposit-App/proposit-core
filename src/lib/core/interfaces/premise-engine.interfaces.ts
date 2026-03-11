import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreExpressionAssignment,
    TCorePremiseEvaluationResult,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import type { TCoreMutationResult } from "../../types/mutation.js"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "../expression-manager.js"
import type { TPremiseEngineSnapshot } from "../premise-engine.js"

/**
 * Single-premise expression tree mutations.
 */
export interface TExpressionMutations<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TCoreMutationResult<TExpr | undefined, TExpr, TVar, TPremise, TArg>
    insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
}

/**
 * Single-premise expression tree reads.
 */
export interface TExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    getExpression(id: string): TExpr | undefined
    getRootExpressionId(): string | undefined
    getRootExpression(): TExpr | undefined
    getExpressions(): TExpr[]
    getChildExpressions(parentId: string | null): TExpr[]
}

/**
 * Variable reference queries and cascade deletion.
 */
export interface TVariableReferences<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    getVariables(): TVar[]
    getReferencedVariableIds(): Set<string>
    deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg>
}

/**
 * Premise type classification (inference vs constraint).
 */
export interface TPremiseClassification {
    isInference(): boolean
    isConstraint(): boolean
}

/**
 * Premise-level evaluation: single-assignment evaluation and
 * evaluability validation.
 */
export interface TPremiseEvaluation {
    validateEvaluability(): TCoreValidationResult
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            requireExactCoverage?: boolean
        }
    ): TCorePremiseEvaluationResult
}

/**
 * Premise snapshot and mutation callback lifecycle.
 * Static fromSnapshot factory is class-level only.
 */
export interface TPremiseLifecycle<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    snapshot(): TPremiseEngineSnapshot<TPremise, TExpr>
    setOnMutate(callback: (() => void) | undefined): void
    markDirty(): void
}

/**
 * Premise entity identity and metadata access.
 */
export interface TPremiseIdentity<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    getId(): string
    toPremiseData(): TPremise
    getExtras(): Record<string, unknown>
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
}
