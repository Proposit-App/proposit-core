import type {
    TCoreLogicalOperatorType,
    TCorePropositionalExpression,
} from "../schemata/index.js"
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
import { entityChecksum } from "./checksum.js"
import {
    markExpressionDirty,
    flushExpressionChecksums,
    pruneDeletedFromDirtySet,
} from "./expression-manager-dirty-set.js"
import { validateExpressionManagerInvariants } from "./expression-manager-invariants.js"
import {
    validateInsertExpression,
    validateWrapExpression,
    validateRepositionSiblings,
    validateUpdateExpression,
    validateRemoveAndPromote,
    validateAddExpressionRelative,
} from "./expression-manager-checks.js"
import type { TInvariantValidationResult } from "../types/validation.js"

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
        markExpressionDirty(exprId, this.dirtyExpressionIds, this.expressions)
    }

    /**
     * Recomputes `descendantChecksum` and `combinedChecksum` for all dirty
     * expressions, processing bottom-up (deepest first) so that children
     * are up-to-date before their parents are computed.
     */
    public flushExpressionChecksums(): void {
        flushExpressionChecksums(
            this.dirtyExpressionIds,
            this.expressions,
            this.childExpressionIdsByParentId,
            this.config,
            this.collector
        )
    }

    /**
     * Removes deleted expression IDs from the dirty set so that flush
     * doesn't attempt to process expressions that no longer exist.
     */
    public pruneDeletedFromDirtySet(deletedIds: Set<string>): void {
        pruneDeletedFromDirtySet(deletedIds, this.dirtyExpressionIds)
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

            // P-1 (non-not operator under operator) is no longer
            // enforced at mutation time. Assistive mode inserts the
            // formula buffer via AN-1 post-hook; permissive mode
            // leaves the un-buffered state and `validate('presentable')`
            // flags it. The pre-v1.0 inline buffer-insertion fallback +
            // throw both lived here under `grammarConfig.enforceFormula
            // BetweenOperators` and are gone.

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
            // `repositionOnCollision` flag gating is gone — composites
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
        const sibling = validateAddExpressionRelative(
            siblingId,
            this.expressions
        )

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
                // pre-v1.0 `repositionOnCollision` flag gating is gone.
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

        validateUpdateExpression(
            expressionId,
            expression,
            updates,
            this.childPositionsByParentId
        )

        // If no actual mutable fields are set, return the expression as-is.
        if (
            updates.position === undefined &&
            updates.variableId === undefined &&
            updates.operator === undefined
        ) {
            return expression
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

        // The pre-v1.0 same-operator absorption inline cascade
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

        // The pre-v1.0 `collapseIfNeeded(parentId)` inline cascade
        // (gated on `collapseEmptyFormula`) is gone. AN-3 (post-mutation
        // hook in assistive mode) handles 0/1-child operator/formula
        // collapse.

        return target
    }

    private removeAndPromote(expressionId: string, target: TExpr): TExpr {
        const children = this.getChildExpressions(expressionId)
        const child = validateRemoveAndPromote(expressionId, target, children)

        if (child === undefined) {
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

            // AN-3 (post-mutation hook in assistive mode) handles
            // 0/1-child operator/formula collapse on the parent.

            return target
        }

        // Exactly 1 child — promote it into the target's slot.

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

        // AN-3 (post-mutation hook in assistive mode) handles
        // formula collapse on the target's parent if the promoted child
        // makes the formula unjustified.

        return target
    }

    // There is no shared `promoteChild` helper: the inline collapse
    // cascade (`collapseIfNeeded`) and the legacy
    // `ExpressionManager.normalize()` sweep it once served are gone,
    // replaced by the AN-1..AN-4 post-mutation hooks in
    // `src/lib/grammar/an-rules.ts`. The `removeAndPromote` 1-child
    // branch in `removeExpression` writes the promoted child directly.

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

        const { startIdx, endIdx, lowerBound, upperBound, count } =
            validateRepositionSiblings(
                children,
                leftPos,
                rightPos,
                this.positionConfig
            )

        const modified: TExpr[] = []

        const positionSet = this.childPositionsByParentId.get(parentId)
        for (let i = startIdx; i <= endIdx; i++) {
            positionSet?.delete(children[i].position)
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

    // ExpressionManager carries no inline AN behavior: there are no
    // `collapseIfNeeded` / `absorbSameOperatorIfNeeded` /
    // `absorbSameOperator` cascades, no `ExpressionManager.normalize()`
    // 5-pass sweep, no `promoteChild` helper, and no private
    // `hasBinaryOperatorInBoundedSubtree`. All of that normalization
    // behavior is subsumed by the four native AN passes in
    // `src/lib/grammar/an-rules.ts` (AN-1..AN-4 — assistive-mode
    // post-mutation hook + `engine.normalize(tier?)`'s explicit pass).
    // The AN-3 module uses its own bounded-subtree helper bound to
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
     * pre-v1.0 P-1 promote-on-remove check is gone, along with the rest
     * of the `grammarConfig.enforceFormulaBetweenOperators` machinery;
     * the legacy `collapseEmptyFormula` cascade simulation
     * (`simulateCollapseChain` / `simulatePostPromotionCollapse`) is
     * gone in lockstep — AN-3 (post-mutation hook in assistive mode)
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
     * (P-1 / `enforceFormulaBetweenOperators`) is gone.
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
        const { anchorParentId, anchorPosition } = validateInsertExpression(
            expression,
            leftNodeId,
            rightNodeId,
            this.expressions
        )

        // Compute child positions (midpoint-spaced for future bisection),
        // matching the pattern used by wrapExpression. As of core 1.0.2
        // S-8 is arity-only — `implies`/`iff` siblings may sit at any
        // `[a, b]` with `a < b` (S-9 still guards uniqueness), so no
        // operator-specific branching is needed here.
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
        const { existingNodeId, anchorParentId, anchorPosition } =
            validateWrapExpression(
                operator,
                newSibling,
                leftNodeId,
                rightNodeId,
                this.expressions
            )

        // Determine child positions (midpoint-spaced for future bisection).
        // As of core 1.0.2 S-8 is arity-only — `implies`/`iff` siblings
        // may sit at any `[a, b]` with `a < b` (S-9 still guards
        // uniqueness), so the same midpoint pattern used for `and`/`or`
        // applies to all binary wraps.
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
        // `child` is already typed `TExpr` from `this.expressions.get`,
        // so no cast is needed at this call site.
        this.registerFormulaBuffer(
            child,
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

        // AN-4 (post-mutation hook in assistive mode) handles
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
     * existence, parent container type, root-only operators, child limits,
     * position uniqueness, and checksum integrity.
     */
    public validate(): TInvariantValidationResult {
        return validateExpressionManagerInvariants(
            this.expressions,
            this.childExpressionIdsByParentId,
            this.dirtyExpressionIds,
            this.config,
            this.collector
        )
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
