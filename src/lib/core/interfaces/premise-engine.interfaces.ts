import type {
    TCoreArgument,
    TCoreLogicalOperatorType,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreExpressionAssignment,
    TCorePremiseEvaluationResult,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import type { TInvariantValidationResult } from "../../types/validation.js"
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
    /**
     * Adds an expression to this premise's tree.
     *
     * If the expression has `parentId: null` it becomes the root; only one
     * root is permitted per premise. All structural rules (`implies`/`iff`
     * root-only, child limits, position uniqueness) are enforced.
     *
     * When `grammarConfig.autoNormalize` is `true`, operator nesting
     * violations are auto-corrected by inserting a `formula` buffer between
     * the parent operator and the non-`not` operator child, rather than
     * throwing. Auto-normalize is only active for `addExpression`; compound
     * operations (`insertExpression`, `wrapExpression`) and `removeExpression`
     * always throw on violations regardless of this flag.
     *
     * @param expression - The expression to add, including position and
     *   parent assignment.
     * @returns The added expression (with checksum) and changeset.
     * @throws If the premise already has a root expression and this one is
     *   also a root.
     * @throws If the expression's parent does not exist in this premise.
     * @throws If the expression is a variable reference and the variable
     *   has not been registered.
     * @throws If a non-not operator would become a direct child of another
     *   operator expression (when `autoNormalize` is `false`).
     */
    addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    /**
     * Adds an expression as the last child of the given parent, with
     * position computed automatically. If `parentId` is `null`, the
     * expression becomes the root.
     *
     * @param parentId - The parent expression ID, or `null` for root.
     * @param expression - The expression to add (position is auto-assigned).
     * @returns The added expression (with checksum) and changeset.
     * @throws If the premise already has a root and `parentId` is `null`.
     * @throws If the expression is a variable reference and the variable
     *   has not been registered.
     * @throws If a non-not operator would become a direct child of another
     *   operator expression.
     */
    appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    /**
     * Adds an expression immediately before or after an existing sibling,
     * with position computed automatically.
     *
     * @param siblingId - The ID of the existing sibling expression.
     * @param relativePosition - Whether to insert `"before"` or `"after"`
     *   the sibling.
     * @param expression - The expression to add (position is auto-assigned).
     * @returns The added expression (with checksum) and changeset.
     * @throws If the sibling does not exist in this premise.
     * @throws If the expression is a variable reference and the variable
     *   has not been registered.
     * @throws If a non-not operator would become a direct child of another
     *   operator expression.
     */
    addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    /**
     * Updates mutable fields of an existing expression. Only `position`,
     * `variableId`, and `operator` may be updated.
     *
     * @param expressionId - The ID of the expression to update.
     * @param updates - The fields to update.
     * @returns The updated expression and changeset.
     * @throws If the expression does not exist in this premise.
     * @throws If `variableId` references a non-existent variable.
     */
    updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    /**
     * Removes an expression and optionally its entire descendant subtree,
     * then collapses any ancestor operators with fewer than two children.
     *
     * @param expressionId - The ID of the expression to remove.
     * @param deleteSubtree - Whether to remove all descendants as well.
     * @returns The removed root expression, or `undefined` if not found.
     * @throws If removal would promote a non-not operator as a direct
     *   child of another operator expression.
     */
    removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TCoreMutationResult<TExpr | undefined, TExpr, TVar, TPremise, TArg>
    /**
     * Splices a new expression between existing nodes in the tree. The new
     * expression inherits the tree slot of the anchor node
     * (`leftNodeId ?? rightNodeId`).
     *
     * @param expression - The expression to insert, including position and
     *   parent assignment.
     * @param leftNodeId - The existing node to become the left child of
     *   the new expression.
     * @param rightNodeId - The existing node to become the right child of
     *   the new expression.
     * @returns The inserted expression (with checksum) and changeset.
     * @throws If the expression is a variable reference and the variable
     *   has not been registered.
     * @throws If a non-not operator would become a direct child of another
     *   operator expression.
     */
    insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    /**
     * Wraps an existing expression with a new operator and a new sibling
     * in a single atomic operation.
     *
     * The operator takes the existing node's slot in the tree. Both the
     * existing node and the new sibling become children of the operator.
     * Exactly one of `leftNodeId` / `rightNodeId` must be provided — it
     * identifies the existing node and which child slot it occupies.
     *
     * @param operator - The new operator expression to wrap with.
     * @param newSibling - The new sibling expression to add alongside the
     *   existing node.
     * @param leftNodeId - The existing node to place as the left child.
     * @param rightNodeId - The existing node to place as the right child.
     * @returns The inserted operator (with checksum) and changeset.
     * @throws If the new sibling is a variable reference and the variable
     *   has not been registered.
     * @throws If a non-not operator would become a direct child of another
     *   operator expression.
     */
    wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    /**
     * Toggles negation on an expression. If the expression's parent is a
     * NOT operator, removes the NOT (promoting the expression). Otherwise,
     * wraps the expression with a new NOT operator.
     *
     * @param expressionId - The ID of the expression to toggle negation on.
     * @param extraFields - Optional additional fields to merge into newly
     *   created expressions (NOT and formula nodes). Structural fields
     *   (id, type, operator, parentId, position, premiseId, argumentId,
     *   argumentVersion) cannot be overridden.
     * @returns The new NOT expression when adding negation, or `null` when
     *   removing it, along with the changeset.
     * @throws If the expression does not exist in this premise.
     */
    toggleNegation(
        expressionId: string,
        extraFields?: Partial<TExpr>
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg>
    /**
     * Changes the operator type of an existing operator expression.
     *
     * Handles three structural cases automatically:
     * - **Simple change:** The operator has exactly 2 children and no merge
     *   condition. Updates the operator type in-place.
     * - **Merge:** The operator has exactly 2 children and its parent is the
     *   same type as `newOperator`. Dissolves the current operator and
     *   reparents its children under the parent.
     * - **Split:** The operator has >2 children. Extracts `sourceChildId` and
     *   `targetChildId` into a new sub-operator of type `newOperator`,
     *   inserting a formula buffer if required by grammar enforcement.
     *
     * @param expressionId  The operator expression to change.
     * @param newOperator   The target operator type.
     * @param sourceChildId First child to include in a split (required when >2 children).
     * @param targetChildId Second child to include in a split (required when >2 children).
     * @param extraFields   Optional partial expression fields merged into any
     *                      newly created expressions (formula buffer, new sub-operator).
     *                      Structural fields (id, type, operator, parentId, position,
     *                      premiseId, argumentId, argumentVersion) cannot be overridden.
     * @returns result — For simple change: the updated operator expression.
     *                   For merge: null (operator was dissolved).
     *                   For split: the newly created sub-operator expression.
     *          changes — Full changeset with correct hierarchical checksums.
     * @throws If the expression does not exist, is not an operator, or is "not".
     * @throws If >2 children and sourceChildId/targetChildId not provided.
     * @throws If sourceChildId/targetChildId are not children of expressionId.
     */
    changeOperator(
        expressionId: string,
        newOperator: TCoreLogicalOperatorType,
        sourceChildId?: string,
        targetChildId?: string,
        extraFields?: Partial<TExpr>
    ): TCoreMutationResult<TExpr | null, TExpr, TVar, TPremise, TArg>
}

/**
 * Single-premise expression tree reads.
 */
export interface TExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    /**
     * Returns an expression by ID, or `undefined` if not found in this
     * premise.
     *
     * @param id - The expression ID to look up.
     * @returns The expression entity, or `undefined`.
     */
    getExpression(id: string): TExpr | undefined
    /**
     * Returns the ID of the root expression, or `undefined` if the premise
     * is empty.
     *
     * @returns The root expression ID, or `undefined`.
     */
    getRootExpressionId(): string | undefined
    /**
     * Returns the root expression, or `undefined` if the premise is empty.
     *
     * @returns The root expression entity, or `undefined`.
     */
    getRootExpression(): TExpr | undefined
    /**
     * Returns all expressions in this premise.
     *
     * @returns An array of expression entities.
     */
    getExpressions(): TExpr[]
    /**
     * Returns the child expressions of the given parent, sorted by
     * position.
     *
     * @param parentId - The parent expression ID, or `null` for root-level
     *   children.
     * @returns An array of child expression entities.
     */
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
    /**
     * Returns all argument-level variables (from the shared
     * VariableManager) sorted by ID. Since the VariableManager is shared
     * across all premises, this returns every registered variable — not
     * just those referenced by expressions in this premise.
     *
     * @returns An array of variable entities.
     */
    getVariables(): TVar[]
    /**
     * Returns the set of variable IDs referenced by expressions in this
     * premise. Only variables that appear in `type: "variable"` expression
     * nodes are included.
     *
     * @returns A Set of referenced variable ID strings.
     */
    getReferencedVariableIds(): Set<string>
    /**
     * Deletes all expressions that reference the given variable ID,
     * including their subtrees. Operator collapse runs after each removal.
     *
     * @param variableId - The variable ID whose referencing expressions
     *   should be removed.
     * @returns The removed expressions and changeset.
     */
    deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg>
}

/**
 * Premise type classification (inference vs constraint).
 */
export interface TPremiseClassification {
    /**
     * Returns `true` if the root expression is an `implies` or `iff`
     * operator, meaning this premise expresses a logical inference
     * relationship.
     *
     * @returns Whether this premise is an inference.
     */
    isInference(): boolean
    /**
     * Returns `true` if this premise does not have an inference operator at
     * its root. Equivalent to `!isInference()`.
     *
     * @returns Whether this premise is a constraint.
     */
    isConstraint(): boolean
}

/**
 * Premise-level evaluation: single-assignment evaluation and evaluability
 * validation.
 */
export interface TPremiseEvaluation {
    /**
     * Validates that this premise is structurally ready for evaluation.
     *
     * @returns A validation result with any issues found.
     */
    validateEvaluability(): TCoreValidationResult
    /**
     * Evaluates the premise under a three-valued expression assignment.
     *
     * Variable values are looked up using Kleene three-valued logic
     * (`null` = unknown). Missing variables default to `null`. For
     * inference premises (`implies`/`iff`), an `inferenceDiagnostic` is
     * computed with three-valued fields unless the root is rejected.
     *
     * @param assignment - The variable assignment and optional rejected
     *   expression IDs.
     * @param options - Optional evaluation options.
     * @param options.strictUnknownKeys - If `true`, unknown variable keys
     *   in the assignment cause an error.
     * @param options.requireExactCoverage - If `true`, the assignment must
     *   cover exactly the referenced variables.
     * @returns The premise evaluation result.
     */
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
    /**
     * Returns a serializable snapshot of the premise's owned state.
     *
     * @returns The premise engine snapshot.
     */
    snapshot(): TPremiseEngineSnapshot<TPremise, TExpr>
    /**
     * Sets a callback invoked after every mutation, or `undefined` to
     * clear.
     *
     * @param callback - The mutation callback, or `undefined` to remove.
     */
    setOnMutate(callback: (() => void) | undefined): void
    /**
     * Sets a callback that checks whether adding a variable-expression to a
     * premise would create a circular binding. Injected by `ArgumentEngine`
     * to enable cross-premise cycle detection. If not set, only the direct
     * check (within the premise itself) runs.
     *
     * @param check - A function that returns `true` if adding the variable
     *   to the premise would create a cycle, or `undefined` to clear.
     */
    setCircularityCheck(
        check: ((variableId: string, premiseId: string) => boolean) | undefined
    ): void
    /**
     * Sets a callback that checks whether a premise-bound variable's target
     * premise has an empty expression tree. Injected by `ArgumentEngine` to
     * enable cross-premise validation. Used during `validateEvaluability`.
     *
     * @param check - A function that returns `true` if the variable's bound
     *   premise has no root expression, or `undefined` to clear.
     */
    setEmptyBoundPremiseCheck(
        check: ((variableId: string) => boolean) | undefined
    ): void
    /**
     * Invalidates the cached checksum so the next call recomputes it.
     */
    markDirty(): void
    /**
     * Run invariant validation on this premise and its expression tree.
     */
    validate(): TInvariantValidationResult
    /**
     * Sets a callback that returns the full set of variable IDs registered
     * in the argument. Injected by `ArgumentEngine`.
     *
     * @param callback - A function returning the set of registered variable
     *   IDs, or `undefined` to clear.
     */
    setVariableIdsCallback(callback: (() => Set<string>) | undefined): void
    /**
     * Sets a callback that runs full argument-level invariant validation.
     * Injected by `ArgumentEngine` so the premise can delegate to the
     * argument-level validator.
     *
     * @param callback - A function returning the invariant validation result,
     *   or `undefined` to clear.
     */
    setArgumentValidateCallback(
        callback: (() => TInvariantValidationResult) | undefined
    ): void
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
    /**
     * Returns the premise ID.
     *
     * @returns The premise ID string.
     */
    getId(): string
    /**
     * Returns a serializable premise representation containing only
     * identity/metadata and checksum. Use `getRootExpressionId()`,
     * `getExpressions()`, `getReferencedVariableIds()` for runtime state.
     *
     * @returns The premise data entity.
     */
    toPremiseData(): TPremise
    /**
     * Returns the premise's extra metadata record.
     *
     * @returns The extras record.
     */
    getExtras(): Record<string, unknown>
    /**
     * Replaces the premise's extra metadata record.
     *
     * @param extras - The new extras record.
     * @returns The previous extras record and changeset.
     */
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
}
