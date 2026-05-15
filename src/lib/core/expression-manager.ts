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
    EXPR_CHILD_LIMIT_EXCEEDED,
    EXPR_POSITION_DUPLICATE,
    EXPR_CHECKSUM_MISMATCH,
} from "../types/validation.js"
// `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED` import deleted in D2 —
// P-1 is now surfaced via the grammar-tier validators.

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

    constructor(config?: TLogicEngineOptions) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()
        this.positionConfig = config?.positionConfig ?? DEFAULT_POSITION_CONFIG
        this.config = config
        this.generateId = config?.generateId ?? defaultGenerateId
    }

    /**
     * Returns the position config in effect for this expression manager.
     * Used by in-package helpers (e.g. native AN-4 in
     * `src/lib/grammar/an-rules.ts`) that need the position range
     * boundaries (`min`/`max`) for spacing-algorithm fallbacks when a
     * formula sits at the leftmost or rightmost slot under its parent.
     *
     * @internal
     */
    public getPositionConfig(): TCorePositionConfig {
        return this.positionConfig
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
     * As of v1.0 the legacy per-mutation P-1 buffer-insertion branches
     * (`addExpression`/`insertExpression`/`wrapExpression`) are gone —
     * AN-1 (post-mutation hook in assistive mode, see
     * `src/lib/grammar/an-rules.ts`) is the sole formula-buffer
     * insertion path. This helper is invoked from `wrapInFormula` (the
     * public AN-1 primitive on `PremiseEngine`) which calls it once per
     * buffer insertion to materialize the formula node.
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
        const expression = input

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
            const parent = this.expressions.get(expression.parentId)
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

            // D2: P-1 (non-not operator under operator) is no longer
            // enforced at mutation time. Assistive mode inserts the
            // formula buffer via AN-1 post-hook; permissive mode
            // leaves the un-buffered state and `validate('presentable')`
            // flags it. The pre-v1.0 inline buffer-insertion fallback +
            // throw both lived here under `grammarConfig.enforceFormula
            // BetweenOperators` — deleted in D2.

            if (parent.type === "operator") {
                this.assertChildLimit(parent.operator, expression.parentId)
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
        if (children.length === 0) {
            this.addExpression({
                ...expression,
                parentId,
                position: this.positionConfig.initial,
            } as TExpressionInput<TExpr>)
            return
        }

        const lastChild = children[children.length - 1]
        let position = midpoint(lastChild.position, this.positionConfig.max)

        if (position === lastChild.position) {
            // Composite-mutation behavior (spec §8 / S-9): always shift
            // colliding siblings as part of the bundled op. The pre-v1.0
            // `repositionOnCollision` flag gating is gone in D2 — composites
            // never leave a Structural violation by design.
            this.repositionSiblings(
                parentId,
                lastChild.position,
                this.positionConfig.max
            )
            const updated = this.getChildExpressions(parentId)
            const newLast = updated[updated.length - 1]
            position = midpoint(newLast.position, this.positionConfig.max)
        }

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
                // Composite-mutation behavior (spec §8 / S-9): always shift
                // colliding siblings as part of the bundled op. The
                // pre-v1.0 `repositionOnCollision` flag gating is gone in
                // D2.
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
                position = midpoint(newPrevPos, updated[newSiblingIdx].position)
            }
        } else {
            const nextPosition =
                siblingIndex < children.length - 1
                    ? children[siblingIndex + 1].position
                    : this.positionConfig.max
            position = midpoint(sibling.position, nextPosition)

            if (position === sibling.position || position === nextPosition) {
                // Composite-mutation behavior (spec §8 / S-9): always
                // shift colliding siblings as part of the bundled op.
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
                position = midpoint(updated[newSiblingIdx].position, newNextPos)
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

        // D2: the pre-v1.0 same-operator absorption inline cascade
        // (gated on `absorbSameOperator`) is gone. AN-4 (post-mutation
        // hook in assistive mode) handles same-operator absorption
        // through a formula buffer.

        return this.expressions.get(expressionId) ?? updated
    }

    /**
     * Removes an expression from the tree.
     *
     * When `deleteSubtree` is `true`, the expression and its entire descendant
     * subtree are removed.
     *
     * When `deleteSubtree` is `false`, the expression is removed but its single
     * child (if any) is promoted into the removed expression's slot. If the
     * expression has more than one child, an error is thrown.
     *
     * As of v1.0 the pre-removal collapse-cascade (the legacy
     * `collapseIfNeeded` / `simulateCollapseChain`) is gone — AN-3
     * (post-mutation hook in assistive mode) handles 0/1-child
     * operator/formula collapse on the surviving parent.
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

        // D2: the pre-v1.0 `collapseIfNeeded(parentId)` inline cascade
        // (gated on `collapseEmptyFormula`) is gone. AN-3 (post-mutation
        // hook in assistive mode) handles 0/1-child operator/formula
        // collapse.

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
            // Leaf removal.
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

            // D2: AN-3 (post-mutation hook in assistive mode) handles
            // 0/1-child operator/formula collapse on the parent.

            return target
        }

        // Exactly 1 child — promote it into the target's slot.
        const child = children[0]

        // D2: the P-1 promote-on-remove enforcement throw lived here under
        // `grammarConfig.enforceFormulaBetweenOperators`. AN-1 (post-mutation
        // hook in assistive mode) now inserts the buffer if the promotion
        // produced a non-not operator under operator; permissive mode leaves
        // the un-buffered state and `validate('presentable')` flags it.

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

        // D2: AN-3 (post-mutation hook in assistive mode) handles
        // formula collapse on the target's parent if the promoted child
        // makes the formula unjustified.

        return target
    }

    // D2 — `promoteChild` was the helper for the pre-v1.0 inline
    // collapse cascade (`collapseIfNeeded`) and the legacy
    // `ExpressionManager.normalize()` sweep, both of which are gone in
    // D2 (replaced by AN-3 / AN-4 / AN-2 / AN-1 post-mutation hooks in
    // `src/lib/grammar/an-rules.ts`). The remaining
    // `removeAndPromote` 1-child branch in `removeExpression` writes
    // the promoted child directly (no shared helper is needed).

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

    // D2 — the inline AN cascades (`collapseIfNeeded` /
    // `absorbSameOperatorIfNeeded` / `absorbSameOperator`), the legacy
    // `ExpressionManager.normalize()` 5-pass sweep, the
    // `promoteChild` helper, and the private
    // `hasBinaryOperatorInBoundedSubtree` were all deleted here. The
    // first three were gated on the legacy `collapseEmptyFormula` /
    // `absorbSameOperator` flags and ran inline from
    // `removeExpression` / `updateExpression`. The `normalize()` sweep
    // was the underlying engine for `pe.normalizeExpressions()` /
    // `engine.normalizeAllExpressions()`. All of these are subsumed by
    // the four native AN passes in `src/lib/grammar/an-rules.ts`
    // (AN-1..AN-4 — assistive-mode post-mutation hook +
    // `engine.normalize(tier?)`'s explicit pass). The AN-3 module
    // uses its own bounded-subtree helper bound to
    // `pe.getChildExpressions` (see `src/lib/grammar/bounded-subtree.ts`).

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
     * Pre-flight before {@link removeExpression} mutates state. As of v1.0
     * the only structural failure mode for `removeAndPromote`'s 1-child
     * branch is the root-only-operator promotion rule (S-5): an
     * `implies`/`iff` child cannot be promoted into a non-root slot. The
     * pre-v1.0 P-1 promote-on-remove check was deleted in D2 along with
     * the rest of the `grammarConfig.enforceFormulaBetweenOperators`
     * machinery; the legacy `collapseEmptyFormula` cascade simulation
     * (`simulateCollapseChain` / `simulatePostPromotionCollapse`) was
     * deleted in lockstep — AN-3 (post-mutation hook in assistive mode)
     * handles every collapse case.
     */
    private assertRemovalSafe(
        expressionId: string,
        deleteSubtree: boolean
    ): void {
        if (deleteSubtree) return

        const target = this.expressions.get(expressionId)
        if (!target) return

        const children = this.getChildExpressions(expressionId)
        if (children.length === 1) {
            this.assertPromotionSafe(children[0], target.parentId)
        }
    }

    /**
     * Checks whether promoting `child` into a slot with the given `newParentId`
     * would violate the root-only rule (S-5). The pre-v1.0 nesting check
     * (P-1 / `enforceFormulaBetweenOperators`) was deleted in D2.
     */
    private assertPromotionSafe(
        child: TExpr,
        newParentId: string | null
    ): void {
        if (child.type !== "operator") return

        // Root-only check — always enforced (S-5)
        if (
            (child.operator === "implies" || child.operator === "iff") &&
            newParentId !== null
        ) {
            throw new Error(
                `Cannot remove expression — would promote a root-only operator ("${child.operator}") to a non-root position`
            )
        }
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
     * become children of the new expression at midpoint-spaced positions
     * (`POSITION_INITIAL` and `midpoint(POSITION_INITIAL, POSITION_MAX)`).
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

        // D2: the pre-v1.0 P-1 inline buffer-insertion / throw branches
        // (gated on `grammarConfig.enforceFormulaBetweenOperators` +
        // `resolveAutoNormalize(_, 'wrapInsertFormula')`) for three
        // sites — (1) new expression as child of anchor's parent;
        // (2) left node as child of new expression; (3) right node as
        // child of new expression — were deleted. AN-1 (post-mutation
        // hook in assistive mode) inserts the buffer when any of these
        // sites produces a non-not operator under operator;
        // permissive mode leaves the un-buffered state and
        // `validate('presentable')` flags it.

        const anchorParentId = anchor.parentId
        const anchorPosition = anchor.position

        // Compute child positions (midpoint-spaced for future bisection),
        // matching the pattern used by wrapExpression.
        let leftPosition: number
        let rightPosition: number
        if (leftNodeId !== undefined && rightNodeId !== undefined) {
            leftPosition = this.positionConfig.initial
            rightPosition = midpoint(
                this.positionConfig.initial,
                this.positionConfig.max
            )
        } else if (leftNodeId !== undefined) {
            leftPosition = this.positionConfig.initial
            rightPosition = this.positionConfig.initial // unused
        } else {
            leftPosition = this.positionConfig.initial // unused
            rightPosition = this.positionConfig.initial
        }

        // Reparent rightNode first in case it is a descendant of leftNode.
        if (rightNodeId !== undefined) {
            this.reparent(rightNodeId, expression.id, rightPosition)
        }
        if (leftNodeId !== undefined) {
            this.reparent(leftNodeId, expression.id, leftPosition)
        }

        // Store the new expression in the anchor's slot.
        const stored = this.attachChecksum({
            ...expression,
            parentId: anchorParentId,
            position: anchorPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(expression.id, stored)
        this.collector?.addedExpression({
            ...stored,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            anchorParentId,
            () => new Set()
        ).add(expression.id)
        getOrCreate(
            this.childPositionsByParentId,
            anchorParentId,
            () => new Set()
        ).add(anchorPosition)

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

        // D2: the pre-v1.0 P-1 inline buffer-insertion / throw branches
        // (gated on `grammarConfig.enforceFormulaBetweenOperators` +
        // `resolveAutoNormalize(_, 'wrapInsertFormula')`) for three
        // sites — (1) new operator as child of existing node's parent;
        // (2) existing node as child of new operator;
        // (3) new sibling as child of new operator — were deleted.
        // AN-1 (post-mutation hook in assistive mode) inserts the
        // buffer when any of these sites produces a non-not operator
        // under operator; permissive mode leaves the un-buffered state
        // and `validate('presentable')` flags it.

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

        // Store operator in the anchor slot.
        const storedOperator = this.attachChecksum({
            ...operator,
            parentId: anchorParentId,
            position: anchorPosition,
        } as TExpressionInput<TExpr>)
        this.expressions.set(operator.id, storedOperator)
        this.collector?.addedExpression({
            ...storedOperator,
        } as unknown as TCorePropositionalExpression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            anchorParentId,
            () => new Set()
        ).add(operator.id)
        getOrCreate(
            this.childPositionsByParentId,
            anchorParentId,
            () => new Set()
        ).add(anchorPosition)

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
     * Inserts a new `formula` node between an existing expression and
     * its current parent atomically. The formula takes the child's
     * original slot (parentId + position); the child becomes the
     * formula's sole child at position 0.
     *
     * Used by the native AN-1 (formula-buffer insertion) pass in
     * `src/lib/grammar/an-rules.ts` per spec §5.1. Composing this from
     * `addExpression` + `reparentExpression` is not possible without
     * trip-wires: `addExpression(formula, parent, childPosition)` would
     * throw S-9 (child still occupies that slot), and `assertChildLimit`
     * would reject the extra child under unary `not` parents and binary
     * `implies`/`iff` parents even transiently. This primitive sidesteps
     * both: the net child count of the parent is unchanged by the wrap
     * (the formula displaces the child), so the limit isn't actually
     * violated, just transiently if expressed via two atomic mutations.
     *
     * Generates the formula's id via the caller-supplied `formulaId`
     * parameter so the caller (PE) can plug in the engine's
     * `idGenerator` rather than this manager minting one internally —
     * keeps id provenance explicit at the PE boundary.
     *
     * The new formula inherits the source child's `argumentId`,
     * `argumentVersion`, and `premiseId` automatically.
     *
     * @throws If `childId` does not exist.
     * @throws If `childId` is at the root (`parentId === null`) — there
     *         is no operator parent to insert a buffer beneath.
     */
    public wrapInFormula(childId: string, formulaId: string): void {
        const child = this.expressions.get(childId)
        if (!child) {
            throw new Error(`Expression "${childId}" does not exist.`)
        }
        if (child.parentId === null) {
            throw new Error(
                `Cannot wrap root expression "${childId}" in a formula — no parent operator above it.`
            )
        }
        // S-10 entity-ID uniqueness: refuse to mint a formula at an id
        // that already exists in this premise. Without this check
        // `registerFormulaBuffer` would silently overwrite the prior
        // expression via `this.expressions.set`. Today's AN-1 caller
        // mints via `engine.idGenerator` (crypto UUID v4) so collision
        // is astronomically unlikely, but `wrapInFormula` is a public
        // bundled-composite primitive — the API surface promises S-10
        // enforcement regardless of immediate caller.
        if (this.expressions.has(formulaId)) {
            throw new Error(
                `S-10: formulaId "${formulaId}" already exists in this premise.`
            )
        }
        const childParentId = child.parentId
        const childPosition = child.position

        // Register the formula at the child's old slot. Bypasses the
        // S-9 check via direct map insertion — at this transient point
        // the child still nominally occupies childPosition (its
        // parentId/position fields are unchanged), but the position
        // *set* under childParentId already contains childPosition (it
        // was added when the child was inserted), and Set.add is
        // idempotent, so re-adding it for the formula is safe. The
        // very next reparent call moves the child to (formulaId, 0),
        // freeing childPosition from the child's tracking and leaving
        // it owned by the formula alone.
        this.registerFormulaBuffer(
            child as unknown as TExpr,
            childParentId,
            childPosition,
            formulaId
        )

        // Move the child under the new formula at position 0. The
        // child's old slot under childParentId is freed by `reparent`,
        // then the formula's `add(childPosition)` we did above keeps
        // childPosition owned by the formula. Result: a single formula
        // sits where the child was, the child is the formula's only
        // descendant at position 0.
        this.reparent(childId, formulaId, 0)

        // Mark the formula dirty so its descendant/combined checksums
        // recompute (it now has a child).
        this.markExpressionDirty(formulaId)
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

        // D2: AN-4 (post-mutation hook in assistive mode) handles
        // same-operator absorption through a formula buffer if this
        // operator change produced one.

        return this.expressions.get(expressionId) ?? updated
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

            // D2: the pre-v1.0 3g `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED`
            // legacy-validate() check (gated on
            // `grammarConfig.enforceFormulaBetweenOperators`) is gone.
            // P-1 is now surfaced via the grammar-tier validators —
            // call `engine.validate('presentable')` and look for the
            // `P-1` code. The `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED`
            // engine-error constant was deleted in lockstep.

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
        const loadingConfig: TLogicEngineOptions = {
            ...normalizedConfig,
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
