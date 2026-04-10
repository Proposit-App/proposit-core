import type {
    TCoreLogicalOperatorType,
    TCorePropositionalExpression,
} from "../schemata/index.js"
import { CorePropositionalExpressionSchema } from "../schemata/index.js"
import type { ChangeCollector } from "./change-collector.js"
import { getOrCreate } from "../utils/collections.js"
import {
    DEFAULT_POSITION_CONFIG,
    type TCorePositionConfig,
    midpoint,
} from "../utils/position.js"
import { defaultGenerateId } from "./argument-engine.js"
import type { TLogicEngineOptions } from "./argument-engine.js"
import {
    DEFAULT_CHECKSUM_CONFIG,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "../consts.js"
import { entityChecksum, computeHash, canonicalSerialize } from "./checksum.js"
import {
    DEFAULT_GRAMMAR_CONFIG,
    resolveAutoNormalize,
    type TGrammarConfig,
} from "../types/grammar.js"
import { Value } from "typebox/value"
import type {
    TInvariantViolation,
    TInvariantValidationResult,
} from "../types/validation.js"
import {
    EXPR_SCHEMA_INVALID,
    EXPR_DUPLICATE_ID,
    EXPR_SELF_REFERENTIAL_PARENT,
    EXPR_PARENT_NOT_FOUND,
    EXPR_PARENT_NOT_CONTAINER,
    EXPR_ROOT_ONLY_VIOLATED,
    EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED,
    EXPR_CHILD_LIMIT_EXCEEDED,
    EXPR_POSITION_DUPLICATE,
    EXPR_CHECKSUM_MISMATCH,
} from "../types/validation.js"

// Distribute Omit across the union to preserve discriminated-union narrowing.
export type TExpressionInput<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TCorePropositionalExpression
        ? Omit<U, "checksum" | "descendantChecksum" | "combinedChecksum">
        : never
    : never

export type TExpressionWithoutPosition<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TCorePropositionalExpression
        ? Omit<
              U,
              | "position"
              | "checksum"
              | "descendantChecksum"
              | "combinedChecksum"
          >
        : never
    : never

export type TExpressionManagerSnapshot<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = {
    expressions: TExpr[]
    config?: TLogicEngineOptions
}

/** Fields that may be updated on an existing expression. */
export type TExpressionUpdate = {
    position?: number
    variableId?: string
    operator?: TCoreLogicalOperatorType
}

const PERMITTED_OPERATOR_SWAPS: Record<string, string | undefined> = {
    and: "or",
    or: "and",
    implies: "iff",
    iff: "implies",
}

/**
 * Low-level manager for a flat-stored expression tree.
 *
 * Expressions are immutable value objects stored in three maps: the main
 * expression store, a parent-to-children ID index, and a parent-to-positions
 * index. Structural invariants (child limits, root-only operators, position
 * uniqueness) are enforced on every mutation.
 *
 * This class is an internal building block used by {@link PremiseEngine}
 * and is not part of the public API.
 */
export class ExpressionManager<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    private expressions: Map<string, TExpr>
    private childExpressionIdsByParentId: Map<string | null, Set<string>>
    private childPositionsByParentId: Map<string | null, Set<number>>
    private positionConfig: TCorePositionConfig
    private config?: TLogicEngineOptions
    private generateId: () => string
    private collector: ChangeCollector | null = null
    private dirtyExpressionIds = new Set<string>()

    setCollector(collector: ChangeCollector | null): void {
        this.collector = collector
    }

    /**
     * Overrides the grammar config used for validation and mutation-time
     * checks. Called by restoration paths (e.g. `fromSnapshot`) when the
     * caller supplies a grammar config that should override whatever was
     * stored in the snapshot.
     */
    setGrammarConfig(grammarConfig: TGrammarConfig): void {
        this.config = { ...this.config, grammarConfig }
    }

    constructor(config?: TLogicEngineOptions) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()
        this.positionConfig = config?.positionConfig ?? DEFAULT_POSITION_CONFIG
        this.config = config
        this.generateId = config?.generateId ?? defaultGenerateId
    }

    private get grammarConfig(): TGrammarConfig {
        return this.config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
    }

    private attachChecksum(expr: TExpressionInput<TExpr>): TExpr {
        const fields =
            this.config?.checksumConfig?.expressionFields ??
            DEFAULT_CHECKSUM_CONFIG.expressionFields!
        const checksum = entityChecksum(
            expr as unknown as Record<string, unknown>,
            fields
        )
        return {
            ...expr,
            checksum,
            descendantChecksum: null,
            combinedChecksum: checksum,
        } as TExpr
    }

    /**
     * Registers an expression in the internal data structures without any
     * grammar validation or normalization. This is the mechanical
     * bookkeeping that both `addExpression` (after validation) and
     * `loadInitialExpressions` (direct bulk load) share.
     */
    private registerExpression(expression: TExpressionInput<TExpr>): void {
        getOrCreate(
            this.childPositionsByParentId,
            expression.parentId,
            () => new Set()
        ).add(expression.position)

        const withChecksum = this.attachChecksum(expression)
        this.expressions.set(expression.id, withChecksum)
        this.collector?.addedExpression({
            ...withChecksum,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            expression.parentId,
            () => new Set()
        ).add(expression.id)

        this.markExpressionDirty(expression.id)
    }

    /**
     * Creates and registers a formula-buffer expression in the three internal
     * maps (`expressions`, `childExpressionIdsByParentId`,
     * `childPositionsByParentId`) and notifies the change collector.
     *
     * Used by `addExpression`, `insertExpression`, and `wrapExpression` to
     * auto-insert formula nodes between operators when
     * `grammarConfig.autoNormalize` is enabled.
     *
     * @returns The generated formula expression ID.
     */
    private registerFormulaBuffer(
        sourceExpr: TExpr,
        parentId: string | null,
        position: number,
        formulaId?: string
    ): string {
        formulaId ??= this.generateId()
        const formulaExpr = this.attachChecksum({
            id: formulaId,
            type: "formula",
            argumentId: sourceExpr.argumentId,
            argumentVersion: sourceExpr.argumentVersion,
            premiseId: (sourceExpr as unknown as { premiseId: string })
                .premiseId,
            parentId,
            position,
        } as TExpressionInput<TExpr>)

        this.expressions.set(formulaId, formulaExpr)
        this.collector?.addedExpression({
            ...formulaExpr,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            parentId,
            () => new Set()
        ).add(formulaId)
        getOrCreate(
            this.childPositionsByParentId,
            parentId,
            () => new Set()
        ).add(position)

        return formulaId
    }

    /**
     * Removes an expression from the three internal maps: deletes it from
     * the main `expressions` store, removes it from its parent's child-id
     * and position indexes, and deletes its own child-id and position
     * indexes.
     *
     * Callers remain responsible for collector notification, dirty-set
     * cleanup, and parent dirtying — timing for those varies by call site.
     */
    private detachExpression(expressionId: string, expression: TExpr): void {
        this.expressions.delete(expressionId)
        this.childExpressionIdsByParentId
            .get(expression.parentId)
            ?.delete(expressionId)
        this.childPositionsByParentId
            .get(expression.parentId)
            ?.delete(expression.position)
        this.childExpressionIdsByParentId.delete(expressionId)
        this.childPositionsByParentId.delete(expressionId)
    }

    /**
     * Marks an expression and all its ancestors as dirty for hierarchical
     * checksum recomputation. Stops early when it reaches an expression
     * already in the dirty set (since its ancestors are already marked).
     */
    public markExpressionDirty(exprId: string): void {
        let current: string | null = exprId
        while (current !== null) {
            if (this.dirtyExpressionIds.has(current)) break // ancestors already dirty
            this.dirtyExpressionIds.add(current)
            const expr = this.expressions.get(current)
            current = expr ? expr.parentId : null
        }
    }

    /**
     * Recomputes `descendantChecksum` and `combinedChecksum` for all dirty
     * expressions, processing bottom-up (deepest first) so that children
     * are up-to-date before their parents are computed.
     */
    public flushExpressionChecksums(): void {
        if (this.dirtyExpressionIds.size === 0) return

        // Sort dirty expressions by depth (deepest first) for bottom-up processing
        const dirtyIds = [...this.dirtyExpressionIds]
        const depthOf = (id: string): number => {
            let depth = 0
            let current = this.expressions.get(id)
            while (current && current.parentId !== null) {
                depth++
                current = this.expressions.get(current.parentId)
            }
            return depth
        }
        dirtyIds.sort((a, b) => depthOf(b) - depthOf(a))

        const fields =
            this.config?.checksumConfig?.expressionFields ??
            DEFAULT_CHECKSUM_CONFIG.expressionFields!

        for (const id of dirtyIds) {
            const expr = this.expressions.get(id)
            if (!expr) continue

            const oldChecksum = expr.checksum
            const oldDescendantChecksum = expr.descendantChecksum
            const oldCombinedChecksum = expr.combinedChecksum

            const metaChecksum = entityChecksum(
                expr as unknown as Record<string, unknown>,
                fields
            )

            const childIds = this.childExpressionIdsByParentId.get(id)
            let descendantChecksum: string | null = null
            if (childIds && childIds.size > 0) {
                const childMap: Record<string, string> = {}
                for (const childId of childIds) {
                    const child = this.expressions.get(childId)
                    if (child) {
                        childMap[childId] = child.combinedChecksum
                    }
                }
                descendantChecksum = computeHash(canonicalSerialize(childMap))
            }

            const combinedChecksum =
                descendantChecksum === null
                    ? metaChecksum
                    : computeHash(metaChecksum + descendantChecksum)

            this.expressions.set(id, {
                ...expr,
                checksum: metaChecksum,
                descendantChecksum,
                combinedChecksum,
            } as TExpr)

            if (
                this.collector &&
                !this.collector.isExpressionAdded(expr.id) &&
                (metaChecksum !== oldChecksum ||
                    descendantChecksum !== oldDescendantChecksum ||
                    combinedChecksum !== oldCombinedChecksum)
            ) {
                this.collector.modifiedExpression({
                    ...expr,
                    checksum: metaChecksum,
                    descendantChecksum,
                    combinedChecksum,
                } as TExpr)
            }
        }

        this.dirtyExpressionIds.clear()
    }

    /**
     * Removes deleted expression IDs from the dirty set so that flush
     * doesn't attempt to process expressions that no longer exist.
     */
    public pruneDeletedFromDirtySet(deletedIds: Set<string>): void {
        for (const id of deletedIds) {
            this.dirtyExpressionIds.delete(id)
        }
    }

    /** Returns all expressions sorted by ID for deterministic output. */
    public toArray(): TExpr[] {
        return Array.from(this.expressions.values()).sort((a, b) =>
            a.id.localeCompare(b.id)
        )
    }

    /**
     * Adds an expression to the tree.
     *
     * @throws If the expression ID already exists.
     * @throws If the expression references itself as parent.
     * @throws If `implies`/`iff` operators have a non-null parentId (they must be roots).
     * @throws If the parent does not exist or is not an operator/formula.
     * @throws If the parent's child limit would be exceeded.
     * @throws If the position is already occupied under the parent.
     */
    public addExpression(input: TExpressionInput<TExpr>) {
        let expression = input

        if (this.expressions.has(expression.id)) {
            throw new Error(
                `Expression with ID "${expression.id}" already exists.`
            )
        }
        if (expression.parentId === expression.id) {
            throw new Error(
                `Expression "${expression.id}" cannot be its own parent.`
            )
        }

        if (
            expression.type === "operator" &&
            (expression.operator === "implies" ||
                expression.operator === "iff") &&
            expression.parentId !== null
        ) {
            throw new Error(
                `Operator expression "${expression.id}" with "${expression.operator}" must be a root expression (parentId must be null).`
            )
        }

        if (expression.parentId !== null) {
            let parent = this.expressions.get(expression.parentId)
            if (!parent) {
                throw new Error(
                    `Parent expression "${expression.parentId}" does not exist.`
                )
            }
            if (parent.type !== "operator" && parent.type !== "formula") {
                throw new Error(
                    `Parent expression "${expression.parentId}" is not an operator expression.`
                )
            }

            // Non-not operators cannot be direct children of operators.
            if (
                this.grammarConfig.enforceFormulaBetweenOperators &&
                parent.type === "operator" &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
                if (
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "wrapInsertFormula"
                    )
                ) {
                    // Check original parent can accept the formula as a new child.
                    this.assertChildLimit(parent.operator, expression.parentId)

                    // Auto-insert a formula buffer between parent and expression.
                    const formulaId = this.registerFormulaBuffer(
                        expression as unknown as TExpr,
                        expression.parentId,
                        expression.position
                    )

                    // Rewrite expression to be child of formula.
                    expression = {
                        ...expression,
                        parentId: formulaId,
                        position: 0,
                    } as TExpressionInput<TExpr>

                    // Update parent reference for subsequent checks.
                    parent = this.expressions.get(formulaId)!
                } else {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
            }

            if (parent.type === "operator") {
                this.assertChildLimit(parent.operator, expression.parentId!)
            } else {
                const childCount =
                    this.childExpressionIdsByParentId.get(expression.parentId)
                        ?.size ?? 0
                if (childCount >= 1) {
                    throw new Error(
                        `Formula expression "${expression.parentId}" can only have one child.`
                    )
                }
            }
        }

        const occupiedPositions = getOrCreate(
            this.childPositionsByParentId,
            expression.parentId,
            () => new Set()
        )
        if (occupiedPositions.has(expression.position)) {
            throw new Error(
                `Position ${expression.position} is already used under parent "${expression.parentId}".`
            )
        }

        this.registerExpression(expression)
    }

    /**
     * Adds an expression as the last child of the given parent.
     *
     * If the parent has no children, the expression gets `POSITION_INITIAL`.
     * Otherwise it gets a midpoint between the last child's position and
     * `POSITION_MAX`.
     */
    public appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): void {
        const children = this.getChildExpressions(parentId)
        const position =
            children.length === 0
                ? this.positionConfig.initial
                : midpoint(
                      children[children.length - 1].position,
                      this.positionConfig.max
                  )
        this.addExpression({
            ...expression,
            parentId,
            position,
        } as TExpressionInput<TExpr>)
    }

    /**
     * Adds an expression immediately before or after an existing sibling.
     *
     * @throws If the sibling does not exist.
     */
    public addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): void {
        const sibling = this.expressions.get(siblingId)
        if (!sibling) {
            throw new Error(`Expression "${siblingId}" not found.`)
        }

        const children = this.getChildExpressions(sibling.parentId)
        const siblingIndex = children.findIndex((c) => c.id === siblingId)

        let position: number
        if (relativePosition === "before") {
            const prevPosition =
                siblingIndex > 0
                    ? children[siblingIndex - 1].position
                    : this.positionConfig.min
            position = midpoint(prevPosition, sibling.position)

            if (position === prevPosition || position === sibling.position) {
                if (
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "repositionOnCollision"
                    )
                ) {
                    this.repositionSiblings(
                        sibling.parentId,
                        siblingIndex > 0
                            ? children[siblingIndex - 1].position
                            : this.positionConfig.min,
                        sibling.position
                    )
                    const updated = this.getChildExpressions(sibling.parentId)
                    const newSiblingIdx = updated.findIndex(
                        (c) => c.id === siblingId
                    )
                    const newPrevPos =
                        newSiblingIdx > 0
                            ? updated[newSiblingIdx - 1].position
                            : this.positionConfig.min
                    position = midpoint(
                        newPrevPos,
                        updated[newSiblingIdx].position
                    )
                }
            }
        } else {
            const nextPosition =
                siblingIndex < children.length - 1
                    ? children[siblingIndex + 1].position
                    : this.positionConfig.max
            position = midpoint(sibling.position, nextPosition)

            if (position === sibling.position || position === nextPosition) {
                if (
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "repositionOnCollision"
                    )
                ) {
                    this.repositionSiblings(
                        sibling.parentId,
                        sibling.position,
                        siblingIndex < children.length - 1
                            ? children[siblingIndex + 1].position
                            : this.positionConfig.max
                    )
                    const updated = this.getChildExpressions(sibling.parentId)
                    const newSiblingIdx = updated.findIndex(
                        (c) => c.id === siblingId
                    )
                    const newNextPos =
                        newSiblingIdx < updated.length - 1
                            ? updated[newSiblingIdx + 1].position
                            : this.positionConfig.max
                    position = midpoint(
                        updated[newSiblingIdx].position,
                        newNextPos
                    )
                }
            }
        }

        this.addExpression({
            ...expression,
            parentId: sibling.parentId,
            position,
        } as TExpressionInput<TExpr>)
    }

    /**
     * Updates mutable fields of an existing expression in-place.
     *
     * Only `position`, `variableId`, and `operator` may be updated. Structural
     * fields (`id`, `parentId`, `type`, `argumentId`, `argumentVersion`,
     * `checksum`) are forbidden.
     *
     * Operator changes are restricted to permitted swaps: `and`/`or` and
     * `implies`/`iff`. Variable ID changes require the expression to be of
     * type `"variable"`.
     *
     * @throws If the expression does not exist.
     * @throws If a forbidden field is present in `updates`.
     * @throws If an operator change is not permitted.
     * @throws If `variableId` is set on a non-variable expression.
     * @throws If the new position collides with a sibling.
     */
    public updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TExpr {
        const expression = this.expressions.get(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" not found.`)
        }

        // Reject forbidden fields passed via `as any`.
        const FORBIDDEN_KEYS = [
            "id",
            "argumentId",
            "argumentVersion",
            "premiseId",
            "checksum",
            "parentId",
            "type",
        ]
        for (const key of FORBIDDEN_KEYS) {
            if (key in updates) {
                throw new Error(
                    `Field "${key}" is forbidden in expression updates.`
                )
            }
        }

        // If no actual mutable fields are set, return the expression as-is.
        if (
            updates.position === undefined &&
            updates.variableId === undefined &&
            updates.operator === undefined
        ) {
            return expression
        }

        // Validate operator change.
        if (updates.operator !== undefined) {
            if (expression.type !== "operator") {
                throw new Error(
                    `Expression "${expressionId}" is not an operator expression; cannot update operator.`
                )
            }
            const permitted = PERMITTED_OPERATOR_SWAPS[expression.operator]
            if (permitted !== updates.operator) {
                throw new Error(
                    `Changing operator from "${expression.operator}" to "${updates.operator}" is not a permitted operator change. Permitted: and↔or, implies↔iff.`
                )
            }
        }

        // Validate variableId change.
        if (updates.variableId !== undefined) {
            if (expression.type !== "variable") {
                throw new Error(
                    `Expression "${expressionId}" is not a variable expression; cannot update variableId.`
                )
            }
        }

        // Validate position change.
        if (updates.position !== undefined) {
            const positionSet = this.childPositionsByParentId.get(
                expression.parentId
            )
            if (positionSet) {
                positionSet.delete(expression.position)
                if (positionSet.has(updates.position)) {
                    // Restore old position before throwing.
                    positionSet.add(expression.position)
                    throw new Error(
                        `Position ${updates.position} is already used under parent "${expression.parentId}".`
                    )
                }
                positionSet.add(updates.position)
            }
        }

        // Build an updated copy and replace in the map.
        const updated = this.attachChecksum({
            ...expression,
            ...(updates.position !== undefined
                ? { position: updates.position }
                : {}),
            ...(updates.variableId !== undefined
                ? { variableId: updates.variableId }
                : {}),
            ...(updates.operator !== undefined
                ? { operator: updates.operator }
                : {}),
        } as TExpressionInput<TExpr>)
        this.expressions.set(expressionId, updated)

        this.collector?.modifiedExpression({
            ...updated,
        } as unknown as TCorePropositionalExpression)

        // Mark the updated expression and its ancestors dirty for hierarchical checksum recomputation.
        this.markExpressionDirty(expressionId)

        return updated
    }

    /**
     * Removes an expression from the tree.
     *
     * When `deleteSubtree` is `true`, the expression and its entire descendant
     * subtree are removed, then {@link collapseIfNeeded} runs on the parent.
     *
     * When `deleteSubtree` is `false`, the expression is removed but its single
     * child (if any) is promoted into the removed expression's slot.  If the
     * expression has more than one child, an error is thrown.  Leaf removal
     * (0 children) still triggers {@link collapseIfNeeded} on the parent.
     * Promotion does **not** trigger collapse.
     *
     * @throws If `deleteSubtree` is `false` and the expression has multiple children.
     * @throws If `deleteSubtree` is `false` and the single child is a root-only
     *   operator (`implies`/`iff`) that would be placed in a non-root position.
     * @returns The removed expression, or `undefined` if not found.
     */
    public removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TExpr | undefined {
        const target = this.expressions.get(expressionId)
        if (!target) {
            return undefined
        }

        // Pre-flight: simulate collapse chain to detect nesting/root-only violations.
        this.assertRemovalSafe(expressionId, deleteSubtree)

        if (deleteSubtree) {
            return this.removeSubtree(expressionId, target)
        } else {
            return this.removeAndPromote(expressionId, target)
        }
    }

    private removeSubtree(expressionId: string, target: TExpr): TExpr {
        const parentId = target.parentId

        const toRemove = new Set<string>()
        const stack = [expressionId]
        while (stack.length > 0) {
            const currentId = stack.pop()
            if (!currentId || toRemove.has(currentId)) {
                continue
            }

            toRemove.add(currentId)
            const children = this.childExpressionIdsByParentId.get(currentId)
            if (!children) {
                continue
            }
            for (const childId of children) {
                stack.push(childId)
            }
        }

        for (const id of toRemove) {
            const expression = this.expressions.get(id)
            if (!expression) {
                continue
            }

            this.collector?.removedExpression({
                ...expression,
            } as unknown as TCorePropositionalExpression)
            this.detachExpression(id, expression)
        }

        // Prune deleted expressions from the dirty set and mark the surviving parent dirty.
        this.pruneDeletedFromDirtySet(toRemove)
        if (parentId !== null) {
            this.markExpressionDirty(parentId)
        }

        this.collapseIfNeeded(parentId)

        return target
    }

    private removeAndPromote(expressionId: string, target: TExpr): TExpr {
        const children = this.getChildExpressions(expressionId)

        if (children.length > 1) {
            throw new Error(
                `Cannot promote: expression "${expressionId}" has multiple children (${children.length}). Use deleteSubtree: true or remove children first.`
            )
        }

        if (children.length === 0) {
            // Leaf removal — same as removing a single node, then collapse parent.
            const parentId = target.parentId

            this.collector?.removedExpression({
                ...target,
            } as unknown as TCorePropositionalExpression)
            this.detachExpression(expressionId, target)

            // Prune deleted expression from dirty set and mark surviving parent dirty.
            this.dirtyExpressionIds.delete(expressionId)
            if (parentId !== null) {
                this.markExpressionDirty(parentId)
            }

            this.collapseIfNeeded(parentId)

            return target
        }

        // Exactly 1 child — promote it into the target's slot.
        const child = children[0]

        // Validate: non-not operators cannot be promoted into an operator parent.
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            if (
                child.type === "operator" &&
                child.operator !== "not" &&
                target.parentId !== null
            ) {
                const grandparent = this.expressions.get(target.parentId)
                if (grandparent && grandparent.type === "operator") {
                    throw new Error(
                        `Cannot remove expression — would promote a non-not operator as a direct child of another operator`
                    )
                }
            }
        }

        // Validate: root-only operators cannot be promoted into a non-root position.
        if (
            child.type === "operator" &&
            (child.operator === "implies" || child.operator === "iff") &&
            target.parentId !== null
        ) {
            throw new Error(
                `Cannot promote: child "${child.id}" is a root-only operator ("${child.operator}") and would be placed in a non-root position.`
            )
        }

        // Promote child into the target's slot.
        const promoted = this.attachChecksum({
            ...child,
            parentId: target.parentId,
            position: target.position,
        } as TExpressionInput<TExpr>)
        this.expressions.set(child.id, promoted)

        // Update parent's child-id set: remove target, add promoted child.
        this.childExpressionIdsByParentId
            .get(target.parentId)
            ?.delete(expressionId)
        getOrCreate(
            this.childExpressionIdsByParentId,
            target.parentId,
            () => new Set()
        ).add(child.id)

        // The parent's position set is unchanged: target.position was already
        // tracked and continues to be occupied by the promoted child.

        // Clean up target's own tracking entries.
        this.childExpressionIdsByParentId.delete(expressionId)
        this.childPositionsByParentId.delete(expressionId)

        // Notify collector.
        this.collector?.removedExpression({
            ...target,
        } as unknown as TCorePropositionalExpression)
        this.collector?.modifiedExpression({
            ...promoted,
        } as unknown as TCorePropositionalExpression)

        // Remove target from expressions map.
        this.expressions.delete(expressionId)

        // Prune deleted expression from dirty set and mark promoted child dirty
        // (its parentId changed) which also propagates to ancestors.
        this.dirtyExpressionIds.delete(expressionId)
        this.markExpressionDirty(child.id)

        // After promotion, the target's parent may be a formula that now needs collapsing
        // (e.g., if the promoted child has no binary operator in its bounded subtree).
        this.collapseIfNeeded(target.parentId)

        return target
    }

    /**
     * Promotes `child` into the slot occupied by `parent` and removes `parent`.
     * Used by `collapseIfNeeded` and `normalize()`.
     */
    private promoteChild(parentId: string, parent: TExpr, child: TExpr): void {
        const grandparentId = parent.parentId
        const grandparentPosition = parent.position

        const promoted = this.attachChecksum({
            ...child,
            parentId: grandparentId,
            position: grandparentPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(child.id, promoted)
        this.collector?.modifiedExpression({
            ...promoted,
        } as unknown as TCorePropositionalExpression)

        this.childExpressionIdsByParentId.get(grandparentId)?.delete(parentId)
        getOrCreate(
            this.childExpressionIdsByParentId,
            grandparentId,
            () => new Set()
        ).add(child.id)

        this.childExpressionIdsByParentId.delete(parentId)
        this.childPositionsByParentId.delete(parentId)
        this.collector?.removedExpression({
            ...parent,
        } as unknown as TCorePropositionalExpression)
        this.expressions.delete(parentId)

        this.dirtyExpressionIds.delete(parentId)
        this.markExpressionDirty(child.id)
    }

    /**
     * Redistributes the minimal set of sibling positions to create room at
     * an insertion point between `leftPos` and `rightPos` under `parentId`.
     *
     * When `leftPos` or `rightPos` is a boundary value (positionConfig.min/max)
     * rather than a real node position, the corresponding chain has 0 nodes.
     */
    private repositionSiblings(
        parentId: string | null,
        leftPos: number,
        rightPos: number
    ): TExpr[] {
        const children = this.getChildExpressions(parentId)
        if (children.length === 0) return []

        const positions = children.map((c) => c.position)

        const leftIdx = positions.indexOf(leftPos)
        const rightIdx = positions.indexOf(rightPos)

        // Scan left from leftIdx: expand while consecutive gaps <= 1.
        let scanLeft: number
        let leftBound: number
        let leftCount: number
        if (leftIdx === -1) {
            // leftPos is a boundary (positionConfig.min), not a real node.
            scanLeft = 0
            leftBound = leftPos
            leftCount = 0
        } else {
            scanLeft = leftIdx
            while (
                scanLeft > 0 &&
                positions[scanLeft] - positions[scanLeft - 1] <= 1
            ) {
                scanLeft--
            }
            leftBound =
                scanLeft > 0 ? positions[scanLeft - 1] : this.positionConfig.min
            leftCount = leftIdx - scanLeft + 1
        }

        // Scan right from rightIdx: expand while consecutive gaps <= 1.
        let scanRight: number
        let rightBound: number
        let rightCount: number
        if (rightIdx === -1) {
            // rightPos is a boundary (positionConfig.max), not a real node.
            scanRight = positions.length - 1
            rightBound = rightPos
            rightCount = 0
        } else {
            scanRight = rightIdx
            while (
                scanRight < positions.length - 1 &&
                positions[scanRight + 1] - positions[scanRight] <= 1
            ) {
                scanRight++
            }
            rightBound =
                scanRight < positions.length - 1
                    ? positions[scanRight + 1]
                    : this.positionConfig.max
            rightCount = scanRight - rightIdx + 1
        }

        // Pick direction with fewer nodes. Tie-break: right.
        let startIdx: number
        let endIdx: number
        let lowerBound: number
        let upperBound: number

        if (leftCount > 0 && leftCount < rightCount) {
            startIdx = scanLeft
            endIdx = leftIdx
            lowerBound = leftBound
            upperBound = rightPos
        } else if (rightCount > 0) {
            startIdx = rightIdx
            endIdx = scanRight
            lowerBound = leftPos
            upperBound = rightBound
        } else {
            // leftCount > 0, rightCount === 0: must pick left.
            startIdx = scanLeft
            endIdx = leftIdx
            lowerBound = leftBound
            upperBound = rightPos
        }

        const count = endIdx - startIdx + 1
        const range = upperBound - lowerBound
        if (range <= count) {
            throw new Error(
                `Cannot reposition: not enough space in range (${lowerBound}, ${upperBound}) for ${count} expressions.`
            )
        }

        const modified: TExpr[] = []

        const positionSet = this.childPositionsByParentId.get(parentId)
        for (let i = startIdx; i <= endIdx; i++) {
            positionSet?.delete(positions[i])
        }

        for (let i = startIdx; i <= endIdx; i++) {
            const newPos = Math.trunc(
                lowerBound +
                    ((upperBound - lowerBound) / (count + 1)) *
                        (i - startIdx + 1)
            )
            const child = children[i]

            const updated = this.attachChecksum({
                ...child,
                position: newPos,
            } as TExpressionInput<TExpr>)
            this.expressions.set(child.id, updated)
            this.collector?.modifiedExpression({
                ...updated,
            } as unknown as TCorePropositionalExpression)
            positionSet?.add(newPos)
            this.markExpressionDirty(child.id)
            modified.push(updated)
        }

        return modified
    }

    private collapseIfNeeded(operatorId: string | null): void {
        if (!resolveAutoNormalize(this.grammarConfig, "collapseEmptyFormula"))
            return
        if (operatorId === null) return

        const operator = this.expressions.get(operatorId)
        if (!operator) return

        if (operator.type === "formula") {
            const children = this.getChildExpressions(operatorId)
            if (children.length === 0) {
                const grandparentId = operator.parentId
                this.collector?.removedExpression({
                    ...operator,
                } as unknown as TCorePropositionalExpression)
                this.detachExpression(operatorId, operator)

                this.dirtyExpressionIds.delete(operatorId)
                if (grandparentId !== null) {
                    this.markExpressionDirty(grandparentId)
                }

                this.collapseIfNeeded(grandparentId)
                return
            }

            // 1-child formula: collapse if no binary operator in bounded subtree.
            if (
                children.length === 1 &&
                !this.hasBinaryOperatorInBoundedSubtree(children[0].id)
            ) {
                const grandparentId = operator.parentId
                this.promoteChild(operatorId, operator, children[0])

                // Grandparent may also be a formula that now needs collapsing.
                this.collapseIfNeeded(grandparentId)
            }

            return
        }

        if (operator.type !== "operator") return

        const children = this.getChildExpressions(operatorId)

        if (children.length === 0) {
            const grandparentId = operator.parentId

            this.collector?.removedExpression({
                ...operator,
            } as unknown as TCorePropositionalExpression)
            this.detachExpression(operatorId, operator)

            // Prune collapsed operator from dirty set and propagate to grandparent.
            this.dirtyExpressionIds.delete(operatorId)
            if (grandparentId !== null) {
                this.markExpressionDirty(grandparentId)
            }

            this.collapseIfNeeded(grandparentId)
        } else if (children.length === 1 && operator.operator === "not") {
            // `not` is unary — 1 child is its valid state; skip collapse.
            // Still recurse to grandparent: a formula wrapping this `not` may
            // now qualify for collapse after a descendant change.
            this.collapseIfNeeded(operator.parentId)
        } else if (children.length === 1) {
            const child = children[0]
            const grandparentId = operator.parentId

            // Defense-in-depth: validate promotion doesn't violate nesting or root-only rules.
            if (child.type === "operator") {
                // Root-only — always enforced
                if (
                    (child.operator === "implies" ||
                        child.operator === "iff") &&
                    grandparentId !== null
                ) {
                    throw new Error(
                        `Cannot promote: child "${child.id}" is a root-only operator ("${child.operator}") and would be placed in a non-root position.`
                    )
                }
                // Nesting — grammar-configurable
                if (this.grammarConfig.enforceFormulaBetweenOperators) {
                    if (child.operator !== "not" && grandparentId !== null) {
                        const grandparent = this.expressions.get(grandparentId)
                        if (grandparent && grandparent.type === "operator") {
                            throw new Error(
                                `Cannot remove expression — would promote a non-not operator as a direct child of another operator`
                            )
                        }
                    }
                }
            }

            this.promoteChild(operatorId, operator, child)

            // Grandparent may be a formula that now needs collapsing after the
            // promoted child replaced the operator.
            this.collapseIfNeeded(grandparentId)
        }
    }

    /**
     * Checks whether the subtree rooted at `expressionId` contains a binary
     * operator (`and` or `or`). Traversal stops at formula boundaries — a
     * nested formula owns its own subtree and is not inspected.
     */
    private hasBinaryOperatorInBoundedSubtree(expressionId: string): boolean {
        const expr = this.expressions.get(expressionId)
        if (!expr) return false
        if (expr.type === "formula") return false
        if (expr.type === "variable") return false
        if (
            expr.type === "operator" &&
            (expr.operator === "and" || expr.operator === "or")
        ) {
            return true
        }
        const children = this.getChildExpressions(expressionId)
        return children.some((child) =>
            this.hasBinaryOperatorInBoundedSubtree(child.id)
        )
    }

    /**
     * Performs a full normalization sweep on the expression tree:
     * 1. Collapses operators with 0 or 1 children.
     * 2. Collapses formulas whose bounded subtree has no binary operator.
     * 3. Inserts formula buffers where `enforceFormulaBetweenOperators` requires them.
     * 4. Repeats until stable.
     *
     * Works regardless of the current `autoNormalize` setting — this is an
     * explicit on-demand normalization.
     */
    public normalize(): void {
        let changed = true
        while (changed) {
            changed = false

            // Pass 1: Collapse operators with 0 or 1 children (bottom-up).
            for (const expr of this.toArray()) {
                if (expr.type !== "operator") continue
                if (!this.expressions.has(expr.id)) continue
                const children = this.getChildExpressions(expr.id)
                if (children.length === 0) {
                    const grandparentId = expr.parentId
                    this.collector?.removedExpression({
                        ...expr,
                    } as unknown as TCorePropositionalExpression)
                    this.detachExpression(expr.id, expr)
                    this.dirtyExpressionIds.delete(expr.id)
                    if (grandparentId !== null) {
                        this.markExpressionDirty(grandparentId)
                    }
                    changed = true
                } else if (children.length === 1 && expr.operator !== "not") {
                    this.promoteChild(expr.id, expr, children[0])
                    changed = true
                }
            }

            // Pass 2: Collapse unjustified formulas (bottom-up).
            for (const expr of this.toArray()) {
                if (expr.type !== "formula") continue
                if (!this.expressions.has(expr.id)) continue
                const children = this.getChildExpressions(expr.id)
                if (children.length === 0) {
                    const grandparentId = expr.parentId
                    this.collector?.removedExpression({
                        ...expr,
                    } as unknown as TCorePropositionalExpression)
                    this.detachExpression(expr.id, expr)
                    this.dirtyExpressionIds.delete(expr.id)
                    if (grandparentId !== null) {
                        this.markExpressionDirty(grandparentId)
                    }
                    changed = true
                } else if (
                    children.length === 1 &&
                    !this.hasBinaryOperatorInBoundedSubtree(children[0].id)
                ) {
                    this.promoteChild(expr.id, expr, children[0])
                    changed = true
                }
            }

            // Pass 3: Insert formula buffers for operator-under-operator violations.
            for (const expr of this.toArray()) {
                if (expr.type !== "operator" || expr.operator === "not")
                    continue
                if (!this.expressions.has(expr.id)) continue
                if (expr.parentId === null) continue
                const parent = this.expressions.get(expr.parentId)
                if (!parent || parent.type !== "operator") continue

                // Non-not operator is direct child of operator — insert formula buffer.
                const formulaPosition = expr.position
                const formulaParentId = expr.parentId
                const formulaId = this.registerFormulaBuffer(
                    expr as unknown as TExpr,
                    formulaParentId,
                    formulaPosition
                )
                // Reparent the operator under the formula. This removes the
                // operator's old position from the parent's position set, but
                // the formula now occupies that slot, so re-add it. Also mark
                // the formula dirty since it now has a child and its
                // descendant/combined checksums need recomputation.
                this.reparent(expr.id, formulaId, 0)
                getOrCreate(
                    this.childPositionsByParentId,
                    formulaParentId,
                    () => new Set()
                ).add(formulaPosition)
                this.markExpressionDirty(formulaId)
                changed = true
            }

            // Pass 4: Collapse double negation — NOT(NOT(x)) → x.
            for (const expr of this.toArray()) {
                if (expr.type !== "operator" || expr.operator !== "not")
                    continue
                if (!this.expressions.has(expr.id)) continue
                const children = this.getChildExpressions(expr.id)
                if (children.length !== 1) continue
                const child = children[0]
                // Direct: NOT → NOT → x
                if (child.type === "operator" && child.operator === "not") {
                    const innerChildren = this.getChildExpressions(child.id)
                    if (innerChildren.length === 1) {
                        // Promote inner child into outer NOT's slot, remove both NOTs.
                        this.promoteChild(child.id, child, innerChildren[0])
                        this.promoteChild(
                            expr.id,
                            // Re-fetch since promoteChild mutated in place.
                            this.expressions.get(expr.id)!,
                            innerChildren[0]
                        )
                        changed = true
                    }
                }
                // Buffered: NOT → formula → NOT → x
                if (
                    child.type === "formula" &&
                    this.expressions.has(child.id)
                ) {
                    const formulaChildren = this.getChildExpressions(child.id)
                    if (
                        formulaChildren.length === 1 &&
                        formulaChildren[0].type === "operator" &&
                        formulaChildren[0].operator === "not"
                    ) {
                        const innerNot = formulaChildren[0]
                        const innerChildren = this.getChildExpressions(
                            innerNot.id
                        )
                        if (innerChildren.length === 1) {
                            // Remove inner NOT, promote its child into formula.
                            this.promoteChild(
                                innerNot.id,
                                innerNot,
                                innerChildren[0]
                            )
                            // Remove outer NOT, promote formula into its slot.
                            this.promoteChild(
                                expr.id,
                                this.expressions.get(expr.id)!,
                                child
                            )
                            changed = true
                        }
                    }
                }
            }
        }
    }

    /** Returns `true` if any expression in the tree references the given variable ID. */
    public hasVariableReference(variableId: string): boolean {
        for (const expression of this.expressions.values()) {
            if (
                expression.type === "variable" &&
                expression.variableId === variableId
            ) {
                return true
            }
        }
        return false
    }

    /** Returns the expression with the given ID, or `undefined` if not found. */
    public getExpression(expressionId: string): TExpr | undefined {
        return this.expressions.get(expressionId)
    }

    /** Returns the children of the given parent, sorted by position. */
    public getChildExpressions(parentId: string | null): TExpr[] {
        const childIds = this.childExpressionIdsByParentId.get(parentId)
        if (!childIds || childIds.size === 0) {
            return []
        }

        const children: TExpr[] = []
        for (const childId of childIds) {
            const child = this.expressions.get(childId)
            if (child) {
                children.push(child)
            }
        }

        return children.sort((a, b) => a.position - b.position)
    }

    private loadInitialExpressions(
        initialExpressions: TExpressionInput<TExpr>[]
    ) {
        for (const expression of initialExpressions) {
            this.registerExpression(expression)
        }
    }

    /**
     * Simulates the collapse chain that would result from removing an expression.
     * Throws if any promotion would violate nesting or root-only rules.
     */
    private assertRemovalSafe(
        expressionId: string,
        deleteSubtree: boolean
    ): void {
        const target = this.expressions.get(expressionId)
        if (!target) return

        if (!deleteSubtree) {
            const children = this.getChildExpressions(expressionId)
            // >1 children: removeAndPromote throws before any mutation, no nesting concern.
            if (children.length === 1) {
                this.assertPromotionSafe(children[0], target.parentId)
                // Simulate post-promotion cascade (formula collapse after promotion).
                if (
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "collapseEmptyFormula"
                    )
                ) {
                    this.simulatePostPromotionCollapse(
                        target.parentId,
                        children[0]
                    )
                }
            }
            if (children.length === 0) {
                this.simulateCollapseChain(target.parentId, expressionId)
            }
            return
        }

        // deleteSubtree: entire subtree removed, then collapse runs on parent.
        this.simulateCollapseChain(target.parentId, expressionId)
    }

    /**
     * Checks whether promoting `child` into a slot with the given `newParentId`
     * would violate the nesting rule or root-only rule.
     */
    private assertPromotionSafe(
        child: TExpr,
        newParentId: string | null
    ): void {
        if (child.type !== "operator") return

        // Root-only check — always enforced
        if (
            (child.operator === "implies" || child.operator === "iff") &&
            newParentId !== null
        ) {
            throw new Error(
                `Cannot remove expression — would promote a root-only operator ("${child.operator}") to a non-root position`
            )
        }

        // Nesting check — grammar-configurable
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            if (child.operator !== "not" && newParentId !== null) {
                const newParent = this.expressions.get(newParentId)
                if (newParent && newParent.type === "operator") {
                    throw new Error(
                        `Cannot remove expression — would promote a non-not operator as a direct child of another operator`
                    )
                }
            }
        }
    }

    /**
     * Walks the collapse chain starting from `operatorId` after `removedChildId`
     * is removed. At each level: if 0 remaining children, operator/formula is deleted
     * and chain continues up. If 1 remaining child, check promotion safety.
     */
    private simulateCollapseChain(
        operatorId: string | null,
        removedChildId: string
    ): void {
        if (!resolveAutoNormalize(this.grammarConfig, "collapseEmptyFormula"))
            return
        if (operatorId === null) return

        const operator = this.expressions.get(operatorId)
        if (!operator) return

        if (operator.type !== "operator" && operator.type !== "formula") return

        const children = this.getChildExpressions(operatorId)
        const remainingChildren = children.filter(
            (c) => c.id !== removedChildId
        )

        if (operator.type === "formula") {
            if (remainingChildren.length === 0) {
                this.simulateCollapseChain(operator.parentId, operatorId)
            } else if (
                remainingChildren.length === 1 &&
                !this.hasBinaryOperatorInBoundedSubtree(remainingChildren[0].id)
            ) {
                // Formula would collapse — child promoted.
                // Formula collapse promotion is always safe (child is variable, not, or formula).
                this.simulateCollapseChain(operator.parentId, operatorId)
            }
            return
        }

        // operator.type === "operator"
        if (remainingChildren.length === 0) {
            this.simulateCollapseChain(operator.parentId, operatorId)
        } else if (remainingChildren.length === 1) {
            this.assertPromotionSafe(remainingChildren[0], operator.parentId)
            // After promotion, simulate further collapse on grandparent.
            this.simulatePostPromotionCollapse(
                operator.parentId,
                remainingChildren[0]
            )
        }
    }

    /**
     * After an operator promotion places `promotedChild` into `parentId`'s child set,
     * check whether the parent (if a formula) would itself collapse. Formula collapse
     * promotion is always safe (the child can't be a binary operator or root-only operator),
     * but we need to continue the simulation chain.
     */
    private simulatePostPromotionCollapse(
        parentId: string | null,
        promotedChild: TExpr
    ): void {
        if (parentId === null) return
        const parent = this.expressions.get(parentId)
        if (!parent) return

        if (parent.type === "formula") {
            if (!this.hasBinaryOperatorInBoundedSubtree(promotedChild.id)) {
                // Formula would collapse. The promotedChild takes formula's slot.
                // This is always safe. Continue simulation from formula's parent.
                this.simulatePostPromotionCollapse(
                    parent.parentId,
                    promotedChild
                )
            }
        }
        // Operator parents: child count unchanged, no further collapse.
    }

    private assertChildLimit(
        operator: TCoreLogicalOperatorType,
        parentId: string
    ): void {
        const childCount =
            this.childExpressionIdsByParentId.get(parentId)?.size ?? 0

        if (operator === "not" && childCount >= 1) {
            throw new Error(
                `Operator expression "${parentId}" with "not" can only have one child.`
            )
        }
        if ((operator === "implies" || operator === "iff") && childCount >= 2) {
            throw new Error(
                `Operator expression "${parentId}" with "${operator}" can only have two children.`
            )
        }
    }

    private reparent(
        expressionId: string,
        newParentId: string | null,
        newPosition: number
    ): void {
        const expression = this.expressions.get(expressionId)!
        const oldParentId = expression.parentId

        // Detach from old parent.
        this.childExpressionIdsByParentId
            .get(expression.parentId)
            ?.delete(expressionId)
        this.childPositionsByParentId
            .get(expression.parentId)
            ?.delete(expression.position)

        // Replace the stored value (expressions are immutable value objects).
        const updated = this.attachChecksum({
            ...expression,
            parentId: newParentId,
            position: newPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(expressionId, updated)
        this.collector?.modifiedExpression({
            ...updated,
        } as unknown as TCorePropositionalExpression)

        // Attach to new parent.
        getOrCreate(
            this.childExpressionIdsByParentId,
            newParentId,
            () => new Set()
        ).add(expressionId)
        getOrCreate(
            this.childPositionsByParentId,
            newParentId,
            () => new Set()
        ).add(newPosition)

        // Mark both old and new parent chains dirty for hierarchical checksum recomputation.
        this.markExpressionDirty(expressionId)
        if (oldParentId !== null && oldParentId !== newParentId) {
            this.markExpressionDirty(oldParentId)
        }
    }

    /**
     * Inserts a new expression between existing nodes in the tree.
     *
     * The new expression inherits the tree slot of the anchor node
     * (`leftNodeId ?? rightNodeId`). The anchor and optional second node
     * become children of the new expression at positions 0 and 1.
     *
     * Right node is reparented before left node to handle the case where
     * the right node is a descendant of the left node's subtree.
     *
     * @throws If neither leftNodeId nor rightNodeId is provided.
     * @throws If the expression ID already exists.
     * @throws If leftNodeId and rightNodeId are the same.
     * @throws If either referenced node does not exist.
     * @throws If a unary operator/formula is given two children.
     * @throws If either child is an `implies`/`iff` operator (cannot be subordinated).
     * @throws If an `implies`/`iff` expression would be inserted at a non-root position.
     */
    public insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): void {
        // 1. At least one child node must be provided.
        if (leftNodeId === undefined && rightNodeId === undefined) {
            throw new Error(
                `insertExpression requires at least one of leftNodeId or rightNodeId.`
            )
        }

        // 2. The new expression's ID must not already exist.
        if (this.expressions.has(expression.id)) {
            throw new Error(
                `Expression with ID "${expression.id}" already exists.`
            )
        }

        // 3. An expression cannot be its own parent.
        if (expression.parentId === expression.id) {
            throw new Error(
                `Expression "${expression.id}" cannot be its own parent.`
            )
        }

        // 4. Left and right nodes must be distinct.
        if (
            leftNodeId !== undefined &&
            rightNodeId !== undefined &&
            leftNodeId === rightNodeId
        ) {
            throw new Error(`leftNodeId and rightNodeId must be different.`)
        }

        // 5. The left node must exist if provided.
        // Cast to base TExpressionInput for validation access — deferred conditional
        // types (TExpressionInput<TExpr>) cannot be narrowed by TS control flow.
        const leftNode: TExpressionInput | undefined =
            leftNodeId !== undefined
                ? (this.expressions.get(leftNodeId) as
                      | TExpressionInput
                      | undefined)
                : undefined
        if (leftNodeId !== undefined && !leftNode) {
            throw new Error(`Expression "${leftNodeId}" does not exist.`)
        }

        // 6. The right node must exist if provided.
        const rightNode: TExpressionInput | undefined =
            rightNodeId !== undefined
                ? (this.expressions.get(rightNodeId) as
                      | TExpressionInput
                      | undefined)
                : undefined
        if (rightNodeId !== undefined && !rightNode) {
            throw new Error(`Expression "${rightNodeId}" does not exist.`)
        }

        // 7a. A variable expression cannot have children.
        if (expression.type === "variable") {
            throw new Error(
                `Variable expression "${expression.id}" cannot have children.`
            )
        }

        // 7. The "not" operator is unary and cannot take two children.
        if (
            expression.type === "operator" &&
            expression.operator === "not" &&
            leftNodeId !== undefined &&
            rightNodeId !== undefined
        ) {
            throw new Error(
                `Operator expression "${expression.id}" with "not" can only have one child.`
            )
        }

        // 7b. A formula expression is also unary and cannot take two children.
        if (
            expression.type === "formula" &&
            leftNodeId !== undefined &&
            rightNodeId !== undefined
        ) {
            throw new Error(
                `Formula expression "${expression.id}" can only have one child.`
            )
        }

        // 8. The left node must not be an implies/iff expression (which must remain a root).
        if (
            leftNode?.type === "operator" &&
            (leftNode.operator === "implies" || leftNode.operator === "iff")
        ) {
            throw new Error(
                `Expression "${leftNodeId}" with "${leftNode.operator}" cannot be subordinated (it must remain a root expression).`
            )
        }

        // 9. The right node must not be an implies/iff expression (which must remain a root).
        if (
            rightNode?.type === "operator" &&
            (rightNode.operator === "implies" || rightNode.operator === "iff")
        ) {
            throw new Error(
                `Expression "${rightNodeId}" with "${rightNode.operator}" cannot be subordinated (it must remain a root expression).`
            )
        }

        // The anchor is the node whose current tree slot the new expression will inherit.
        const anchor = (leftNode ?? rightNode)!

        // 10. implies/iff expressions may only be inserted at the root of the tree.
        if (
            expression.type === "operator" &&
            (expression.operator === "implies" ||
                expression.operator === "iff") &&
            anchor.parentId !== null
        ) {
            throw new Error(
                `Operator expression "${expression.id}" with "${expression.operator}" must be a root expression (parentId must be null).`
            )
        }

        // 10a. Non-not operators cannot be direct children of operators.
        // Track which children need formula buffers (Site 2) for post-reparent insertion.
        let needsParentFormulaBuffer = false
        const childrenNeedingFormulaBuffer: string[] = []

        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            // Check 1 (Site 1): new expression as child of anchor's parent.
            if (
                anchor.parentId !== null &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
                const anchorParent = this.expressions.get(anchor.parentId)
                if (anchorParent && anchorParent.type === "operator") {
                    if (
                        resolveAutoNormalize(
                            this.grammarConfig,
                            "wrapInsertFormula"
                        )
                    ) {
                        needsParentFormulaBuffer = true
                    } else {
                        throw new Error(
                            `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                        )
                    }
                }
            }

            // Check 2 (Site 2): left/right nodes as children of the new expression.
            if (expression.type === "operator") {
                if (
                    leftNode?.type === "operator" &&
                    leftNode.operator !== "not"
                ) {
                    if (
                        resolveAutoNormalize(
                            this.grammarConfig,
                            "wrapInsertFormula"
                        )
                    ) {
                        childrenNeedingFormulaBuffer.push(leftNodeId!)
                    } else {
                        throw new Error(
                            `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                        )
                    }
                }
                if (
                    rightNode?.type === "operator" &&
                    rightNode.operator !== "not"
                ) {
                    if (
                        resolveAutoNormalize(
                            this.grammarConfig,
                            "wrapInsertFormula"
                        )
                    ) {
                        childrenNeedingFormulaBuffer.push(rightNodeId!)
                    } else {
                        throw new Error(
                            `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                        )
                    }
                }
            }
        }

        const anchorParentId = anchor.parentId
        const anchorPosition = anchor.position

        // Reparent rightNode first in case it is a descendant of leftNode.
        if (rightNodeId !== undefined) {
            this.reparent(rightNodeId, expression.id, 1)
        }
        if (leftNodeId !== undefined) {
            this.reparent(leftNodeId, expression.id, 0)
        }

        // Determine the slot for the new expression. If a parent formula buffer
        // is needed, the formula takes the anchor slot and the expression goes under it.
        let finalParentId = anchorParentId
        let finalPosition = anchorPosition

        if (needsParentFormulaBuffer) {
            const formulaId = this.registerFormulaBuffer(
                expression as unknown as TExpr,
                anchorParentId,
                anchorPosition
            )

            finalParentId = formulaId
            finalPosition = 0
        }

        // Store the new expression in its slot.
        const stored = this.attachChecksum({
            ...expression,
            parentId: finalParentId,
            position: finalPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(expression.id, stored)
        this.collector?.addedExpression({
            ...stored,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            finalParentId,
            () => new Set()
        ).add(expression.id)
        getOrCreate(
            this.childPositionsByParentId,
            finalParentId,
            () => new Set()
        ).add(finalPosition)

        // Site 2: auto-insert formula buffers between the new expression and
        // any offending operator children.
        for (const childId of childrenNeedingFormulaBuffer) {
            const child = this.expressions.get(childId)!
            const childPosition = child.position

            // Reparent the child under the formula first. This detaches the child
            // from expression.id's tracking (removing its position from the set).
            // registerFormulaBuffer then occupies the freed position.
            const formulaId = this.generateId()
            this.reparent(childId, formulaId, 0)
            this.registerFormulaBuffer(
                expression as unknown as TExpr,
                expression.id,
                childPosition,
                formulaId
            )
        }

        // Mark the new expression and its ancestors dirty for hierarchical checksum recomputation.
        // Note: reparent() already marks children dirty, so this propagates from the new expression up.
        this.markExpressionDirty(expression.id)
    }

    /**
     * Wraps an existing expression with a new operator and a new sibling.
     *
     * The operator takes the existing node's slot in the tree. Both the
     * existing node and the new sibling become children of the operator.
     *
     * Exactly one of `leftNodeId` / `rightNodeId` must be provided — it
     * identifies the existing node and which child slot (position 0 or 1)
     * it occupies. The new sibling fills the other slot.
     *
     * @throws If neither or both of leftNodeId/rightNodeId are provided.
     * @throws If the operator or sibling expression ID already exists.
     * @throws If operator and sibling IDs are the same.
     * @throws If the existing node does not exist.
     * @throws If the operator is not of type `"operator"`.
     * @throws If the operator is unary (`not`).
     * @throws If the operator is `implies`/`iff` and the existing node is not at root.
     * @throws If the existing node is an `implies`/`iff` operator (cannot be subordinated).
     * @throws If the new sibling is an `implies`/`iff` operator (cannot be subordinated).
     */
    public wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): void {
        // 1. Exactly one of leftNodeId / rightNodeId must be provided.
        if (leftNodeId === undefined && rightNodeId === undefined) {
            throw new Error(
                `wrapExpression requires exactly one of leftNodeId or rightNodeId.`
            )
        }
        if (leftNodeId !== undefined && rightNodeId !== undefined) {
            throw new Error(
                `wrapExpression requires exactly one of leftNodeId or rightNodeId, not both.`
            )
        }

        // 2. Operator expression ID must not already exist.
        if (this.expressions.has(operator.id)) {
            throw new Error(
                `Expression with ID "${operator.id}" already exists.`
            )
        }

        // 3. New sibling expression ID must not already exist.
        if (this.expressions.has(newSibling.id)) {
            throw new Error(
                `Expression with ID "${newSibling.id}" already exists.`
            )
        }

        // 4. Operator and sibling IDs must be different.
        if (operator.id === newSibling.id) {
            throw new Error(
                `Operator and sibling expression IDs must be different.`
            )
        }

        // 5. The existing node must exist.
        const existingNodeId = (leftNodeId ?? rightNodeId)!
        const existingNode: TExpressionInput | undefined = this.expressions.get(
            existingNodeId
        ) as TExpressionInput | undefined
        if (!existingNode) {
            throw new Error(`Expression "${existingNodeId}" does not exist.`)
        }

        // 6. Operator expression must have type "operator".
        if (operator.type !== "operator") {
            throw new Error(
                `Wrap operator expression "${operator.id}" must have type "operator", got "${operator.type}".`
            )
        }

        // 7. Operator must not be unary ("not").
        if (operator.operator === "not") {
            throw new Error(
                `Operator expression "${operator.id}" with "not" cannot wrap (it is unary and wrapping always produces two children).`
            )
        }

        // 8. implies/iff operator only allowed if existing node is at root.
        if (
            (operator.operator === "implies" || operator.operator === "iff") &&
            existingNode.parentId !== null
        ) {
            throw new Error(
                `Operator expression "${operator.id}" with "${operator.operator}" must be a root expression (parentId must be null).`
            )
        }

        // 9. Existing node must not be implies/iff (cannot be subordinated).
        if (
            existingNode.type === "operator" &&
            (existingNode.operator === "implies" ||
                existingNode.operator === "iff")
        ) {
            throw new Error(
                `Expression "${existingNodeId}" with "${existingNode.operator}" cannot be subordinated (it must remain a root expression).`
            )
        }

        // 10. New sibling must not be implies/iff (cannot be subordinated).
        if (
            newSibling.type === "operator" &&
            (newSibling.operator === "implies" || newSibling.operator === "iff")
        ) {
            throw new Error(
                `Sibling expression "${newSibling.id}" with "${newSibling.operator}" cannot be subordinated (it must remain a root expression).`
            )
        }

        // 10a. Non-not operators cannot be direct children of operators.
        // Track which sites need formula buffers for post-mutation insertion.
        let needsParentFormulaBuffer = false
        let existingNodeNeedsFormulaBuffer = false
        let siblingNeedsFormulaBuffer = false

        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            // Check 1 (Site 1): new operator as child of existing node's parent.
            // Note: step 7 already rejects `not`, so operator.operator is always non-not here.
            if (existingNode.parentId !== null) {
                const existingParent = this.expressions.get(
                    existingNode.parentId
                )
                if (existingParent && existingParent.type === "operator") {
                    if (
                        resolveAutoNormalize(
                            this.grammarConfig,
                            "wrapInsertFormula"
                        )
                    ) {
                        needsParentFormulaBuffer = true
                    } else {
                        throw new Error(
                            `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                        )
                    }
                }
            }

            // Check 2 (Site 2): existing node as child of new operator.
            if (
                existingNode.type === "operator" &&
                existingNode.operator !== "not"
            ) {
                if (
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "wrapInsertFormula"
                    )
                ) {
                    existingNodeNeedsFormulaBuffer = true
                } else {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
            }

            // Check 3 (Site 3): new sibling as child of new operator.
            if (
                newSibling.type === "operator" &&
                newSibling.operator !== "not"
            ) {
                if (
                    resolveAutoNormalize(
                        this.grammarConfig,
                        "wrapInsertFormula"
                    )
                ) {
                    siblingNeedsFormulaBuffer = true
                } else {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
            }
        }

        // Save the existing node's slot (the operator will inherit it).
        const anchorParentId = existingNode.parentId
        const anchorPosition = existingNode.position

        // Determine child positions (midpoint-spaced for future bisection).
        const existingPosition =
            leftNodeId !== undefined
                ? this.positionConfig.initial
                : midpoint(this.positionConfig.initial, this.positionConfig.max)
        const siblingPosition =
            leftNodeId !== undefined
                ? midpoint(this.positionConfig.initial, this.positionConfig.max)
                : this.positionConfig.initial

        // Reparent existing node under operator.
        this.reparent(existingNodeId, operator.id, existingPosition)

        // Store new sibling under operator.
        const storedSibling = this.attachChecksum({
            ...newSibling,
            parentId: operator.id,
            position: siblingPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(newSibling.id, storedSibling)
        this.collector?.addedExpression({
            ...storedSibling,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            operator.id,
            () => new Set()
        ).add(newSibling.id)
        getOrCreate(
            this.childPositionsByParentId,
            operator.id,
            () => new Set()
        ).add(siblingPosition)

        // Determine the operator's slot. If a parent formula buffer is needed,
        // the formula takes the anchor slot and the operator goes under it.
        let operatorParentId = anchorParentId
        let operatorPosition = anchorPosition

        if (needsParentFormulaBuffer) {
            const formulaId = this.registerFormulaBuffer(
                operator as unknown as TExpr,
                anchorParentId,
                anchorPosition
            )

            operatorParentId = formulaId
            operatorPosition = 0
        }

        // Store operator in its slot.
        const storedOperator = this.attachChecksum({
            ...operator,
            parentId: operatorParentId,
            position: operatorPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(operator.id, storedOperator)
        this.collector?.addedExpression({
            ...storedOperator,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            operatorParentId,
            () => new Set()
        ).add(operator.id)
        getOrCreate(
            this.childPositionsByParentId,
            operatorParentId,
            () => new Set()
        ).add(operatorPosition)

        // Site 2: auto-insert formula buffer between operator and existing node.
        if (existingNodeNeedsFormulaBuffer) {
            const existingChild = this.expressions.get(existingNodeId)!
            const childPosition = existingChild.position
            const formulaId = this.generateId()

            // Reparent existing node under formula first (frees position in operator's tracking).
            // registerFormulaBuffer then occupies the freed position.
            this.reparent(existingNodeId, formulaId, 0)
            this.registerFormulaBuffer(
                operator as unknown as TExpr,
                operator.id,
                childPosition,
                formulaId
            )
        }

        // Site 3: auto-insert formula buffer between operator and new sibling.
        if (siblingNeedsFormulaBuffer) {
            const siblingChild = this.expressions.get(newSibling.id)!
            const childPosition = siblingChild.position
            const formulaId = this.generateId()

            // Reparent sibling under formula first (frees position in operator's tracking).
            // registerFormulaBuffer then occupies the freed position.
            this.reparent(newSibling.id, formulaId, 0)
            this.registerFormulaBuffer(
                operator as unknown as TExpr,
                operator.id,
                childPosition,
                formulaId
            )
        }

        // Mark the new operator (and ancestors), the new sibling, and the reparented existing node dirty.
        // reparent() already marks the existing node dirty; mark the operator and sibling as well.
        this.markExpressionDirty(newSibling.id)
        this.markExpressionDirty(operator.id)
    }

    /**
     * Reparents an expression to a new parent at a given position.
     */
    public reparentExpression(
        expressionId: string,
        newParentId: string | null,
        newPosition: number
    ): void {
        const expression = this.expressions.get(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" does not exist.`)
        }
        this.reparent(expressionId, newParentId, newPosition)
    }

    /**
     * Deletes a single expression that has no children.
     * Does NOT trigger operator collapse. Caller must ensure children
     * have been reparented away first.
     */
    public deleteExpression(expressionId: string): TExpr | undefined {
        const expression = this.expressions.get(expressionId)
        if (!expression) return undefined

        const children = this.getChildExpressions(expressionId)
        if (children.length > 0) {
            throw new Error(
                `Cannot delete expression "${expressionId}" — it still has ${children.length} children. Reparent them first.`
            )
        }

        this.detachExpression(expressionId, expression)

        // Notify collector
        this.collector?.removedExpression({
            ...expression,
        } as unknown as TCorePropositionalExpression)

        // Clean up dirty set and mark parent dirty
        this.dirtyExpressionIds.delete(expressionId)
        if (expression.parentId !== null) {
            this.markExpressionDirty(expression.parentId)
        }

        return expression
    }

    /**
     * Changes the operator type of an operator expression without the swap
     * restriction enforced by {@link updateExpression}. Only validates that
     * the target expression is an operator, the new operator is not `"not"`,
     * and root-only constraints are satisfied.
     */
    public changeOperatorType(
        expressionId: string,
        newOperator: TCoreLogicalOperatorType
    ): TExpr {
        const expression = this.expressions.get(expressionId)
        if (!expression) {
            throw new Error(`Expression "${expressionId}" does not exist.`)
        }
        if (expression.type !== "operator") {
            throw new Error(
                `Expression "${expressionId}" is not an operator (type: "${expression.type}").`
            )
        }
        if (newOperator === "not") {
            throw new Error(
                `Cannot change operator to "not". Use toggleNegation instead.`
            )
        }
        // Root-only: implies/iff must be at root
        if (
            (newOperator === "implies" || newOperator === "iff") &&
            expression.parentId !== null
        ) {
            throw new Error(
                `Operator "${newOperator}" must be a root expression (parentId must be null).`
            )
        }

        const updated = this.attachChecksum({
            ...expression,
            operator: newOperator,
        } as TExpressionInput<TExpr>)
        this.expressions.set(expressionId, updated)
        this.collector?.modifiedExpression({
            ...updated,
        } as unknown as TCorePropositionalExpression)
        this.markExpressionDirty(expressionId)
        return updated
    }

    /**
     * Loads expressions in BFS order, respecting the current grammar config.
     * Used by restoration paths (fromData, rollback) that load existing data.
     */
    public loadExpressions(expressions: TExpressionInput<TExpr>[]): void {
        this.loadInitialExpressions(expressions)
    }

    /**
     * Performs a comprehensive validation sweep on all managed expressions.
     *
     * Collects ALL violations rather than failing on the first one. Checks:
     * schema validity, duplicate IDs, self-referential parents, parent
     * existence, parent container type, root-only operators, formula-between-
     * operators (when enabled), child limits, position uniqueness, and
     * checksum integrity.
     */
    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        const seenIds = new Set<string>()

        // ── 1. Save pre-flush checksums for later comparison ──
        const preFlushChecksums = new Map<
            string,
            {
                checksum: string
                descendantChecksum: string | null
                combinedChecksum: string
            }
        >()
        for (const [id, expr] of this.expressions) {
            if (expr.checksum != null) {
                preFlushChecksums.set(id, {
                    checksum: expr.checksum,
                    descendantChecksum: expr.descendantChecksum,
                    combinedChecksum: expr.combinedChecksum,
                })
            }
        }

        // ── 2. Flush checksums to get fresh values ──
        // Mark all expressions dirty so flush recomputes everything
        for (const id of this.expressions.keys()) {
            this.dirtyExpressionIds.add(id)
        }
        this.flushExpressionChecksums()

        // ── 3. Per-expression checks ──
        // Build a sibling-position map for position uniqueness checks
        const positionsByParent = new Map<
            string | null,
            Map<number, string[]>
        >()

        for (const [id, expr] of this.expressions) {
            // 3a. Schema check
            if (
                !Value.Check(
                    CorePropositionalExpressionSchema,
                    expr as unknown as TCorePropositionalExpression
                )
            ) {
                violations.push({
                    code: EXPR_SCHEMA_INVALID,
                    message: `Expression "${id}" does not conform to CorePropositionalExpressionSchema.`,
                    entityType: "expression",
                    entityId: id,
                })
            }

            // 3b. Duplicate ID
            if (seenIds.has(id)) {
                violations.push({
                    code: EXPR_DUPLICATE_ID,
                    message: `Duplicate expression ID "${id}".`,
                    entityType: "expression",
                    entityId: id,
                })
            }
            seenIds.add(id)

            // 3c. Self-referential parent
            if (expr.parentId === id) {
                violations.push({
                    code: EXPR_SELF_REFERENTIAL_PARENT,
                    message: `Expression "${id}" references itself as parent.`,
                    entityType: "expression",
                    entityId: id,
                })
            }

            // 3d. Parent existence
            if (
                expr.parentId !== null &&
                !this.expressions.has(expr.parentId)
            ) {
                violations.push({
                    code: EXPR_PARENT_NOT_FOUND,
                    message: `Expression "${id}" references non-existent parent "${expr.parentId}".`,
                    entityType: "expression",
                    entityId: id,
                })
            }

            // 3e. Parent is container (operator or formula)
            if (expr.parentId !== null && this.expressions.has(expr.parentId)) {
                const parent = this.expressions.get(expr.parentId)!
                if (parent.type !== "operator" && parent.type !== "formula") {
                    violations.push({
                        code: EXPR_PARENT_NOT_CONTAINER,
                        message: `Expression "${id}" has parent "${expr.parentId}" of type "${parent.type}" (expected operator or formula).`,
                        entityType: "expression",
                        entityId: id,
                    })
                }
            }

            // 3f. Root-only: implies/iff must have parentId === null
            if (
                expr.type === "operator" &&
                (expr.operator === "implies" || expr.operator === "iff") &&
                expr.parentId !== null
            ) {
                violations.push({
                    code: EXPR_ROOT_ONLY_VIOLATED,
                    message: `Root-only operator "${expr.operator}" expression "${id}" has non-null parentId "${expr.parentId}".`,
                    entityType: "expression",
                    entityId: id,
                })
            }

            // 3g. Formula-between-operators
            if (
                this.grammarConfig.enforceFormulaBetweenOperators &&
                expr.parentId !== null &&
                expr.type === "operator" &&
                expr.operator !== "not"
            ) {
                const parent = this.expressions.get(expr.parentId)
                if (parent && parent.type === "operator") {
                    violations.push({
                        code: EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED,
                        message: `Non-not operator "${expr.operator}" expression "${id}" is a direct child of operator "${expr.parentId}".`,
                        entityType: "expression",
                        entityId: id,
                    })
                }
            }

            // Collect positions for uniqueness check
            const parentKey = expr.parentId
            let parentPositions = positionsByParent.get(parentKey)
            if (!parentPositions) {
                parentPositions = new Map()
                positionsByParent.set(parentKey, parentPositions)
            }
            const idsAtPosition = parentPositions.get(expr.position)
            if (idsAtPosition) {
                idsAtPosition.push(id)
            } else {
                parentPositions.set(expr.position, [id])
            }

            // 3j. Checksum comparison
            const pre = preFlushChecksums.get(id)
            if (pre) {
                const fresh = this.expressions.get(id)!
                if (
                    pre.checksum !== fresh.checksum ||
                    pre.descendantChecksum !== fresh.descendantChecksum ||
                    pre.combinedChecksum !== fresh.combinedChecksum
                ) {
                    violations.push({
                        code: EXPR_CHECKSUM_MISMATCH,
                        message: `Expression "${id}" checksum mismatch: stored does not match recomputed.`,
                        entityType: "expression",
                        entityId: id,
                    })
                }
            }
        }

        // ── 4. Child limit checks (not/formula: max 1 child) ──
        for (const [id, expr] of this.expressions) {
            if (
                (expr.type === "operator" && expr.operator === "not") ||
                expr.type === "formula"
            ) {
                const childIds = this.childExpressionIdsByParentId.get(id)
                const childCount = childIds?.size ?? 0
                if (childCount > 1) {
                    const label =
                        expr.type === "formula" ? "Formula" : `Operator "not"`
                    violations.push({
                        code: EXPR_CHILD_LIMIT_EXCEEDED,
                        message: `${label} expression "${id}" has ${childCount} children (max 1).`,
                        entityType: "expression",
                        entityId: id,
                    })
                }
            }
        }

        // ── 5. Position uniqueness ──
        for (const [, posMap] of positionsByParent) {
            for (const [position, ids] of posMap) {
                if (ids.length > 1) {
                    for (const id of ids) {
                        violations.push({
                            code: EXPR_POSITION_DUPLICATE,
                            message: `Position ${position} is shared by expressions [${ids.join(", ")}].`,
                            entityType: "expression",
                            entityId: id,
                        })
                    }
                }
            }
        }

        return {
            ok: violations.length === 0,
            violations,
        }
    }

    /** Returns a serializable snapshot of the current state. */
    public snapshot(): TExpressionManagerSnapshot<TExpr> {
        return {
            expressions: this.toArray(),
            config: this.config
                ? ({
                      ...this.config,
                      checksumConfig: serializeChecksumConfig(
                          this.config.checksumConfig
                      ),
                  } as TLogicEngineOptions)
                : this.config,
        }
    }

    /** Creates a new ExpressionManager from a previously captured snapshot. */
    public static fromSnapshot<
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    >(
        snapshot: TExpressionManagerSnapshot<TExpr>,
        grammarConfig?: TGrammarConfig,
        generateId?: () => string
    ): ExpressionManager<TExpr> {
        // Normalize checksumConfig in case the snapshot went through a JSON
        // round-trip that converted Sets to arrays or empty objects.
        const normalizedChecksumConfig = normalizeChecksumConfig(
            snapshot.config?.checksumConfig
        )
        const normalizedConfig: TLogicEngineOptions | undefined =
            snapshot.config
                ? {
                      ...snapshot.config,
                      checksumConfig: normalizedChecksumConfig,
                  }
                : undefined
        // During loading: use explicit grammarConfig, falling back to snapshot's config
        const loadingConfig: TLogicEngineOptions = {
            ...normalizedConfig,
            grammarConfig: grammarConfig ?? normalizedConfig?.grammarConfig,
            generateId: generateId ?? normalizedConfig?.generateId,
        }
        const em = new ExpressionManager<TExpr>(loadingConfig)
        em.loadInitialExpressions(
            snapshot.expressions as unknown as TExpressionInput<TExpr>[]
        )
        // After loading: restore the normalized config for ongoing mutations
        // (generateId is preserved via the em.generateId field set in constructor)
        em.config = normalizedConfig
        return em
    }
}
