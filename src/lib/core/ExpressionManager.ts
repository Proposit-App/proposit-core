import type {
    TCoreLogicalOperatorType,
    TCorePropositionalExpression,
} from "../schemata/index.js"
import { getOrCreate } from "../utils/collections.js"

/**
 * Low-level manager for a flat-stored expression tree.
 *
 * Expressions are immutable value objects stored in three maps: the main
 * expression store, a parent-to-children ID index, and a parent-to-positions
 * index. Structural invariants (child limits, root-only operators, position
 * uniqueness) are enforced on every mutation.
 *
 * This class is an internal building block used by {@link PremiseManager}
 * and is not part of the public API.
 */
export class ExpressionManager {
    private expressions: Map<string, TCorePropositionalExpression>
    private childExpressionIdsByParentId: Map<string | null, Set<string>>
    private childPositionsByParentId: Map<string | null, Set<number>>

    constructor(initialExpressions: TCorePropositionalExpression[] = []) {
        this.expressions = new Map()
        this.childExpressionIdsByParentId = new Map()
        this.childPositionsByParentId = new Map()

        this.loadInitialExpressions(initialExpressions)
    }

    /** Returns all expressions as an unordered array. */
    public toArray(): TCorePropositionalExpression[] {
        return Array.from(this.expressions.values())
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
    public addExpression(expression: TCorePropositionalExpression) {
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
        occupiedPositions.add(expression.position)

        this.expressions.set(expression.id, expression)
        getOrCreate(
            this.childExpressionIdsByParentId,
            expression.parentId,
            () => new Set()
        ).add(expression.id)
    }

    /**
     * Removes an expression and its entire descendant subtree.
     *
     * After removal, {@link collapseIfNeeded} runs on the parent:
     * - 0 children remaining: the parent operator/formula is deleted (recurses to grandparent).
     * - 1 child remaining: the parent is deleted and the surviving child is promoted into its slot.
     *
     * @returns The removed expression, or `undefined` if not found.
     */
    public removeExpression(expressionId: string) {
        const target = this.expressions.get(expressionId)
        if (!target) {
            return undefined
        }

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

    private collapseIfNeeded(operatorId: string | null): void {
        if (operatorId === null) return

        const operator = this.expressions.get(operatorId)
        if (!operator) return

        if (operator.type === "formula") {
            const children = this.getChildExpressions(operatorId)
            if (children.length === 0) {
                const grandparentId = operator.parentId
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

            // Promote the surviving child into the operator's slot in the grandparent.
            const promoted = {
                ...child,
                parentId: grandparentId,
                position: grandparentPosition,
            } as TCorePropositionalExpression
            this.expressions.set(child.id, promoted)

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
    public getExpression(
        expressionId: string
    ): TCorePropositionalExpression | undefined {
        return this.expressions.get(expressionId)
    }

    /** Returns the children of the given parent, sorted by position. */
    public getChildExpressions(
        parentId: string | null
    ): TCorePropositionalExpression[] {
        const childIds = this.childExpressionIdsByParentId.get(parentId)
        if (!childIds || childIds.size === 0) {
            return []
        }

        const children: TCorePropositionalExpression[] = []
        for (const childId of childIds) {
            const child = this.expressions.get(childId)
            if (child) {
                children.push(child)
            }
        }

        return children.sort((a, b) => a.position - b.position)
    }

    private loadInitialExpressions(
        initialExpressions: TCorePropositionalExpression[]
    ) {
        if (initialExpressions.length === 0) {
            return
        }

        const pending = new Map<string, TCorePropositionalExpression>(
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
        const updated = {
            ...expression,
            parentId: newParentId,
            position: newPosition,
        } as TCorePropositionalExpression
        this.expressions.set(expressionId, updated)

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
        expression: TCorePropositionalExpression,
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
        const leftNode =
            leftNodeId !== undefined
                ? this.expressions.get(leftNodeId)
                : undefined
        if (leftNodeId !== undefined && !leftNode) {
            throw new Error(`Expression "${leftNodeId}" does not exist.`)
        }

        // 6. The right node must exist if provided.
        const rightNode =
            rightNodeId !== undefined
                ? this.expressions.get(rightNodeId)
                : undefined
        if (rightNodeId !== undefined && !rightNode) {
            throw new Error(`Expression "${rightNodeId}" does not exist.`)
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
        const stored = {
            ...expression,
            parentId: anchorParentId,
            position: anchorPosition,
        } as TCorePropositionalExpression
        this.expressions.set(expression.id, stored)
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
}
