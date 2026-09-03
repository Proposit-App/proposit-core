import type { TCorePropositionalExpression } from "../schemata/index.js"
import type { TCorePositionConfig } from "../utils/position.js"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./expression-manager.js"

// Operators are grouped by the arity they impose on their children.
// A swap is permitted exactly when both operators sit in the same group,
// because only then does the existing child set remain legal without
// being rewritten. `not` is unary and sits in no group: it is neither a
// swap source nor a swap target (use `toggleNegation`).
//
// Kept as `string[]` rather than the narrow operator union so
// `.includes(...)` accepts a widened value read from runtime data.
const VARIADIC_OPERATORS: string[] = ["and", "or", "xor"]
const BINARY_OPERATORS: string[] = ["implies", "iff"]

/**
 * Whether `updateExpression` may change an operator expression from
 * `fromOperator` to `toOperator` — true iff both belong to the same
 * arity class.
 */
function isPermittedOperatorSwap(
    fromOperator: string,
    toOperator: string
): boolean {
    return (
        (VARIADIC_OPERATORS.includes(fromOperator) &&
            VARIADIC_OPERATORS.includes(toOperator)) ||
        (BINARY_OPERATORS.includes(fromOperator) &&
            BINARY_OPERATORS.includes(toOperator))
    )
}

/**
 * Validates the preconditions for `ExpressionManager.insertExpression`
 * (existence, arity, and root-only-operator rules) and returns the anchor
 * slot the new expression inherits.
 *
 * @throws Under the same conditions documented on `insertExpression`.
 */
export function validateInsertExpression<
    TExpr extends TCorePropositionalExpression,
>(
    expression: TExpressionInput<TExpr>,
    leftNodeId: string | undefined,
    rightNodeId: string | undefined,
    expressions: Map<string, TExpr>
): { anchorParentId: string | null; anchorPosition: number } {
    // 1. At least one child node must be provided.
    if (leftNodeId === undefined && rightNodeId === undefined) {
        throw new Error(
            `insertExpression requires at least one of leftNodeId or rightNodeId.`
        )
    }

    // 2. The new expression's ID must not already exist.
    if (expressions.has(expression.id)) {
        throw new Error(`Expression with ID "${expression.id}" already exists.`)
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
            ? (expressions.get(leftNodeId) as TExpressionInput | undefined)
            : undefined
    if (leftNodeId !== undefined && !leftNode) {
        throw new Error(`Expression "${leftNodeId}" does not exist.`)
    }

    // 6. The right node must exist if provided.
    const rightNode: TExpressionInput | undefined =
        rightNodeId !== undefined
            ? (expressions.get(rightNodeId) as TExpressionInput | undefined)
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
        (expression.operator === "implies" || expression.operator === "iff") &&
        anchor.parentId !== null
    ) {
        throw new Error(
            `Operator expression "${expression.id}" with "${expression.operator}" must be a root expression (parentId must be null).`
        )
    }

    // The pre-v1.0 P-1 inline buffer-insertion / throw branches
    // (gated on `grammarConfig.enforceFormulaBetweenOperators` +
    // `resolveAutoNormalize(_, 'wrapInsertFormula')`) for three
    // sites — (1) new expression as child of anchor's parent;
    // (2) left node as child of new expression; (3) right node as
    // child of new expression — were deleted. AN-1 (post-mutation
    // hook in assistive mode) inserts the buffer when any of these
    // sites produces a non-not operator under operator;
    // permissive mode leaves the un-buffered state and
    // `validate('presentable')` flags it.

    return { anchorParentId: anchor.parentId, anchorPosition: anchor.position }
}

/**
 * Validates the preconditions for `ExpressionManager.wrapExpression`
 * (existence, arity, and root-only-operator rules) and returns the existing
 * node's ID plus the anchor slot the operator inherits.
 *
 * @throws Under the same conditions documented on `wrapExpression`.
 */
export function validateWrapExpression<
    TExpr extends TCorePropositionalExpression,
>(
    operator: TExpressionWithoutPosition<TExpr>,
    newSibling: TExpressionWithoutPosition<TExpr>,
    leftNodeId: string | undefined,
    rightNodeId: string | undefined,
    expressions: Map<string, TExpr>
): {
    existingNodeId: string
    anchorParentId: string | null
    anchorPosition: number
} {
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
    if (expressions.has(operator.id)) {
        throw new Error(`Expression with ID "${operator.id}" already exists.`)
    }

    // 3. New sibling expression ID must not already exist.
    if (expressions.has(newSibling.id)) {
        throw new Error(`Expression with ID "${newSibling.id}" already exists.`)
    }

    // 4. Operator and sibling IDs must be different.
    if (operator.id === newSibling.id) {
        throw new Error(
            `Operator and sibling expression IDs must be different.`
        )
    }

    // 5. The existing node must exist.
    const existingNodeId = (leftNodeId ?? rightNodeId)!
    const existingNode: TExpressionInput | undefined = expressions.get(
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
        (existingNode.operator === "implies" || existingNode.operator === "iff")
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

    // The pre-v1.0 P-1 inline buffer-insertion / throw branches
    // (gated on `grammarConfig.enforceFormulaBetweenOperators` +
    // `resolveAutoNormalize(_, 'wrapInsertFormula')`) for three
    // sites — (1) new operator as child of existing node's parent;
    // (2) existing node as child of new operator;
    // (3) new sibling as child of new operator — were deleted.
    // AN-1 (post-mutation hook in assistive mode) inserts the
    // buffer when any of these sites produces a non-not operator
    // under operator; permissive mode leaves the un-buffered state
    // and `validate('presentable')` flags it.

    return {
        existingNodeId,
        anchorParentId: existingNode.parentId,
        anchorPosition: existingNode.position,
    }
}

/**
 * Computes the sibling-position redistribution range for
 * `ExpressionManager.repositionSiblings`: which contiguous run of
 * `children` to shift, and the bounds to spread them across.
 *
 * @throws If neither direction has enough space to redistribute into.
 */
export function validateRepositionSiblings<
    TExpr extends TCorePropositionalExpression,
>(
    children: TExpr[],
    leftPos: number,
    rightPos: number,
    positionConfig: TCorePositionConfig
): {
    startIdx: number
    endIdx: number
    lowerBound: number
    upperBound: number
    count: number
} {
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
        leftBound = scanLeft > 0 ? positions[scanLeft - 1] : positionConfig.min
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
                : positionConfig.max
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

    return { startIdx, endIdx, lowerBound, upperBound, count }
}

/**
 * Validates the preconditions for `ExpressionManager.updateExpression`
 * and, when the update includes a position change, performs the sibling
 * position-set swap (delete old position, reject or accept the new one).
 *
 * Mutates `childPositionsByParentId` in place when a position update is
 * accepted — this is the one check in this module that isn't a pure
 * throw-or-void helper, since the swap must happen atomically with the
 * collision check to avoid leaving the position set inconsistent.
 *
 * @throws Under the same conditions documented on `updateExpression`.
 */
export function validateUpdateExpression<
    TExpr extends TCorePropositionalExpression,
>(
    expressionId: string,
    expression: TExpr,
    updates: TExpressionUpdate,
    childPositionsByParentId: Map<string | null, Set<number>>
): void {
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

    // Validate operator change.
    if (updates.operator !== undefined) {
        if (expression.type !== "operator") {
            throw new Error(
                `Expression "${expressionId}" is not an operator expression; cannot update operator.`
            )
        }
        if (!isPermittedOperatorSwap(expression.operator, updates.operator)) {
            throw new Error(
                `Changing operator from "${expression.operator}" to "${updates.operator}" is not a permitted operator change. An operator may only be changed within its arity class: variadic (${VARIADIC_OPERATORS.join(", ")}) or binary (${BINARY_OPERATORS.join(", ")}). "not" is unary and belongs to neither.`
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
        const positionSet = childPositionsByParentId.get(expression.parentId)
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
}

/**
 * Validates the preconditions for the single-child-promotion branch of
 * `ExpressionManager.removeAndPromote` and returns which of the two
 * branches applies.
 *
 * @throws If `target` has more than one child.
 * @throws If the single child is a root-only operator (`implies`/`iff`)
 *   that would be placed in a non-root position.
 * @returns The child to promote, or `undefined` for a plain leaf removal.
 */
export function validateRemoveAndPromote<
    TExpr extends TCorePropositionalExpression,
>(expressionId: string, target: TExpr, children: TExpr[]): TExpr | undefined {
    if (children.length > 1) {
        throw new Error(
            `Cannot promote: expression "${expressionId}" has multiple children (${children.length}). Use deleteSubtree: true or remove children first.`
        )
    }

    if (children.length === 0) {
        return undefined
    }

    // Exactly 1 child — promote it into the target's slot.
    const child = children[0]

    // The P-1 promote-on-remove enforcement throw lived here under
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

    return child
}

/**
 * Validates the preconditions for
 * `ExpressionManager.addExpressionRelative` and returns the sibling
 * looked up by ID.
 *
 * @throws If the sibling does not exist.
 */
export function validateAddExpressionRelative<
    TExpr extends TCorePropositionalExpression,
>(siblingId: string, expressions: Map<string, TExpr>): TExpr {
    const sibling = expressions.get(siblingId)
    if (!sibling) {
        throw new Error(`Expression "${siblingId}" not found.`)
    }
    return sibling
}
