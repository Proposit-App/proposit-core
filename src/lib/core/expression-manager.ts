import { randomUUID } from "node:crypto"
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
import type { TLogicEngineOptions } from "./argument-engine.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import {
    DEFAULT_GRAMMAR_CONFIG,
    type TGrammarConfig,
} from "../types/grammar.js"

// Distribute Omit across the union to preserve discriminated-union narrowing.
export type TExpressionInput<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TCorePropositionalExpression
        ? Omit<U, "checksum">
        : never
    : never

export type TExpressionWithoutPosition<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TCorePropositionalExpression
        ? Omit<U, "position" | "checksum">
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
    private collector: ChangeCollector | null = null

    setCollector(collector: ChangeCollector | null): void {
        this.collector = collector
    }

    constructor(config?: TLogicEngineOptions) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()
        this.positionConfig = config?.positionConfig ?? DEFAULT_POSITION_CONFIG
        this.config = config
    }

    private get grammarConfig(): TGrammarConfig {
        return this.config?.grammarConfig ?? DEFAULT_GRAMMAR_CONFIG
    }

    private attachChecksum(expr: TExpressionInput<TExpr>): TExpr {
        const fields =
            this.config?.checksumConfig?.expressionFields ??
            DEFAULT_CHECKSUM_CONFIG.expressionFields!
        return {
            ...expr,
            checksum: entityChecksum(
                expr as unknown as Record<string, unknown>,
                fields
            ),
        } as TExpr
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
                if (this.grammarConfig.autoNormalize) {
                    // Check original parent can accept the formula as a new child.
                    this.assertChildLimit(parent.operator, expression.parentId)

                    // Auto-insert a formula buffer between parent and expression.
                    const formulaId = randomUUID()
                    const formulaExpr = this.attachChecksum({
                        id: formulaId,
                        type: "formula",
                        argumentId: expression.argumentId,
                        argumentVersion: expression.argumentVersion,
                        premiseId: (
                            expression as unknown as { premiseId: string }
                        ).premiseId,
                        parentId: expression.parentId,
                        position: expression.position,
                    } as TExpressionInput<TExpr>)

                    // Register formula directly in stores.
                    this.expressions.set(formulaId, formulaExpr)
                    this.collector?.addedExpression({
                        ...formulaExpr,
                    } as unknown as TCorePropositionalExpression)
                    getOrCreate(
                        this.childExpressionIdsByParentId,
                        expression.parentId,
                        () => new Set()
                    ).add(formulaId)
                    getOrCreate(
                        this.childPositionsByParentId,
                        expression.parentId,
                        () => new Set()
                    ).add(expression.position)

                    // Rewrite expression to be child of formula.
                    expression = {
                        ...expression,
                        parentId: formulaId,
                        position: 0,
                    } as TExpressionInput<TExpr>

                    // Update parent reference for subsequent checks.
                    parent = formulaExpr
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
        occupiedPositions.add(expression.position)

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
        } else {
            const nextPosition =
                siblingIndex < children.length - 1
                    ? children[siblingIndex + 1].position
                    : this.positionConfig.max
            position = midpoint(sibling.position, nextPosition)
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
            this.expressions.delete(id)
            this.childExpressionIdsByParentId
                .get(expression.parentId)
                ?.delete(id)

            this.childPositionsByParentId
                .get(expression.parentId)
                ?.delete(expression.position)

            this.childExpressionIdsByParentId.delete(id)
            this.childPositionsByParentId.delete(id)
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
            this.expressions.delete(expressionId)
            this.childExpressionIdsByParentId
                .get(parentId)
                ?.delete(expressionId)
            this.childPositionsByParentId.get(parentId)?.delete(target.position)
            this.childExpressionIdsByParentId.delete(expressionId)
            this.childPositionsByParentId.delete(expressionId)

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

        // No collapseIfNeeded after promotion.

        return target
    }

    private collapseIfNeeded(operatorId: string | null): void {
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
                this.expressions.delete(operatorId)
                this.childExpressionIdsByParentId
                    .get(grandparentId)
                    ?.delete(operatorId)
                this.childPositionsByParentId
                    .get(grandparentId)
                    ?.delete(operator.position)
                this.childExpressionIdsByParentId.delete(operatorId)
                this.childPositionsByParentId.delete(operatorId)
                this.collapseIfNeeded(grandparentId)
            }
            return
        }

        if (operator.type !== "operator") return

        const children = this.getChildExpressions(operatorId)

        if (children.length === 0) {
            const grandparentId = operator.parentId
            const grandparentPosition = operator.position

            this.collector?.removedExpression({
                ...operator,
            } as unknown as TCorePropositionalExpression)
            this.expressions.delete(operatorId)
            this.childExpressionIdsByParentId
                .get(grandparentId)
                ?.delete(operatorId)
            this.childPositionsByParentId
                .get(grandparentId)
                ?.delete(grandparentPosition)
            this.childExpressionIdsByParentId.delete(operatorId)
            this.childPositionsByParentId.delete(operatorId)

            this.collapseIfNeeded(grandparentId)
        } else if (children.length === 1) {
            const child = children[0]
            const grandparentId = operator.parentId
            const grandparentPosition = operator.position

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

            // Promote the surviving child into the operator's slot in the grandparent.
            const promoted = this.attachChecksum({
                ...child,
                parentId: grandparentId,
                position: grandparentPosition,
            } as TExpressionInput<TExpr>)
            this.expressions.set(child.id, promoted)
            this.collector?.modifiedExpression({
                ...promoted,
            } as unknown as TCorePropositionalExpression)

            // Replace the operator with the promoted child in the grandparent's child-id set.
            this.childExpressionIdsByParentId
                .get(grandparentId)
                ?.delete(operatorId)
            getOrCreate(
                this.childExpressionIdsByParentId,
                grandparentId,
                () => new Set()
            ).add(child.id)

            // The grandparent's position set is unchanged: grandparentPosition was
            // already tracked for the operator and continues to be occupied by the
            // promoted child.

            // Remove the operator's own tracking entries.
            this.childExpressionIdsByParentId.delete(operatorId)
            this.childPositionsByParentId.delete(operatorId)
            this.collector?.removedExpression({
                ...operator,
            } as unknown as TCorePropositionalExpression)
            this.expressions.delete(operatorId)

            // The grandparent's child count is unchanged; no further recursion needed.
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
        if (initialExpressions.length === 0) {
            return
        }

        const pending = new Map<string, TExpressionInput<TExpr>>(
            initialExpressions.map((expression) => [expression.id, expression])
        )

        let progressed = true
        while (pending.size > 0 && progressed) {
            progressed = false

            for (const [id, expression] of Array.from(pending.entries())) {
                if (
                    expression.parentId !== null &&
                    !this.expressions.has(expression.parentId)
                ) {
                    continue
                }

                this.addExpression(expression)
                pending.delete(id)
                progressed = true
            }
        }

        if (pending.size > 0) {
            const unresolved = Array.from(pending.keys()).join(", ")
            throw new Error(
                `Could not resolve parent relationships for expressions: ${unresolved}.`
            )
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
        if (operatorId === null) return

        const operator = this.expressions.get(operatorId)
        if (!operator) return

        if (operator.type !== "operator" && operator.type !== "formula") return

        const children = this.getChildExpressions(operatorId)
        const remainingChildren = children.filter(
            (c) => c.id !== removedChildId
        )

        if (operator.type === "formula") {
            // Formula: 0 children → deleted, recurse up.
            if (remainingChildren.length === 0) {
                this.simulateCollapseChain(operator.parentId, operatorId)
            }
            return
        }

        // operator.type === "operator"
        if (remainingChildren.length === 0) {
            this.simulateCollapseChain(operator.parentId, operatorId)
        } else if (remainingChildren.length === 1) {
            this.assertPromotionSafe(remainingChildren[0], operator.parentId)
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
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            // Check 1: new expression as child of anchor's parent.
            if (
                anchor.parentId !== null &&
                expression.type === "operator" &&
                expression.operator !== "not"
            ) {
                const anchorParent = this.expressions.get(anchor.parentId)
                if (anchorParent && anchorParent.type === "operator") {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
            }

            // Check 2: left/right nodes as children of the new expression.
            if (expression.type === "operator") {
                if (
                    leftNode?.type === "operator" &&
                    leftNode.operator !== "not"
                ) {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
                if (
                    rightNode?.type === "operator" &&
                    rightNode.operator !== "not"
                ) {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
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

        // Store the new expression in the freed anchor slot.
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
        if (this.grammarConfig.enforceFormulaBetweenOperators) {
            // Check 1: new operator as child of existing node's parent.
            // Note: step 7 already rejects `not`, so operator.operator is always non-not here.
            if (existingNode.parentId !== null) {
                const existingParent = this.expressions.get(
                    existingNode.parentId
                )
                if (existingParent && existingParent.type === "operator") {
                    throw new Error(
                        `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                    )
                }
            }

            // Check 2: existing node and new sibling as children of the new operator.
            if (
                existingNode.type === "operator" &&
                existingNode.operator !== "not"
            ) {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
            if (
                newSibling.type === "operator" &&
                newSibling.operator !== "not"
            ) {
                throw new Error(
                    `Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node`
                )
            }
        }

        // Save the existing node's slot (the operator will inherit it).
        const anchorParentId = existingNode.parentId
        const anchorPosition = existingNode.position

        // Determine child positions.
        const existingPosition = leftNodeId !== undefined ? 0 : 1
        const siblingPosition = leftNodeId !== undefined ? 1 : 0

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

        // Store operator in the existing node's former slot.
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
    }

    /**
     * Loads expressions in BFS order, respecting the current grammar config.
     * Used by restoration paths (fromData, rollback) that load existing data.
     */
    public loadExpressions(expressions: TExpressionInput<TExpr>[]): void {
        this.loadInitialExpressions(expressions)
    }

    /** Returns a serializable snapshot of the current state. */
    public snapshot(): TExpressionManagerSnapshot<TExpr> {
        return {
            expressions: this.toArray(),
            config: this.config,
        }
    }

    /** Creates a new ExpressionManager from a previously captured snapshot. */
    public static fromSnapshot<
        TExpr extends TCorePropositionalExpression =
            TCorePropositionalExpression,
    >(snapshot: TExpressionManagerSnapshot<TExpr>): ExpressionManager<TExpr> {
        const em = new ExpressionManager<TExpr>(snapshot.config)
        em.loadInitialExpressions(
            snapshot.expressions as unknown as TExpressionInput<TExpr>[]
        )
        return em
    }
}
