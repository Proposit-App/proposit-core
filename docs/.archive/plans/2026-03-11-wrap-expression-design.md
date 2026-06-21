# Wrap Expression Design

## Overview

New `wrapExpression` method across all three layers (`ExpressionManager`, `PremiseEngine`, `ArgumentEngine`) that atomically wraps an existing expression with a new operator and a new sibling expression.

Given a premise with just variable `P`, calling `wrapExpression` with an `implies` operator and a new variable `F` produces `F implies P` in one operation. The operator takes the existing node's slot in the tree, and both the existing node and new sibling become children of the operator.

## API

```typescript
// ExpressionManager (low-level, no changeset return)
wrapExpression(
  operator: TExpressionWithoutPosition<TExpr>,
  newSibling: TExpressionWithoutPosition<TExpr>,
  leftNodeId?: string,
  rightNodeId?: string
): void

// PremiseEngine (premise-scoped, returns mutation result)
wrapExpression(
  operator: TExpressionWithoutPosition<TExpr>,
  newSibling: TExpressionWithoutPosition<TExpr>,
  leftNodeId?: string,
  rightNodeId?: string
): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>

// ArgumentEngine (argument-scoped, delegates to PremiseEngine)
wrapExpression(
  premiseId: string,
  operator: TExpressionWithoutPosition<TExpr>,
  newSibling: TExpressionWithoutPosition<TExpr>,
  leftNodeId?: string,
  rightNodeId?: string
): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
```

### Parameter semantics

- **`operator`**: The new operator expression to insert. Position and parentId are derived.
- **`newSibling`**: The new expression to add as the other child. Any expression type. Position and parentId are derived.
- **`leftNodeId`**: ID of the existing expression to place at position 0 (left child).
- **`rightNodeId`**: ID of the existing expression to place at position 1 (right child).

Exactly one of `leftNodeId` / `rightNodeId` must be provided. It identifies the existing node and which child slot it occupies. The new sibling fills the other slot.

### Return value

Returns the stored operator expression as `result` (consistent with `insertExpression`). Both the operator and new sibling appear in the changeset's added expressions; the reparented existing node appears in modified expressions.

## Validation

Checked in order, mirroring `insertExpression` where applicable:

1. Exactly one of `leftNodeId` / `rightNodeId` must be provided (not both, not neither)
2. Operator expression ID must not already exist
3. New sibling expression ID must not already exist
4. Operator and sibling IDs must be different
5. The existing node (referenced by `leftNodeId` or `rightNodeId`) must exist
6. Operator expression must have `type: "operator"`
7. Operator must not be unary (`not`) — wrapping always produces two children
8. `implies`/`iff` operator only allowed if existing node is currently at root (`parentId === null`)
9. Existing node must not be an `implies`/`iff` operator (cannot be subordinated)
10. New sibling must not be an `implies`/`iff` operator (cannot be subordinated)
11. PremiseEngine layer: variable references (on new sibling, if type `"variable"`) must exist in `VariableManager`

## Mutation steps (ExpressionManager)

1. Run all validation checks
2. Save existing node's `parentId` and `position` (the slot the operator will inherit)
3. Determine child positions: existing node gets position 0 if passed as `leftNodeId`, position 1 if passed as `rightNodeId`; new sibling gets the other position
4. Reparent existing node under operator at its assigned position (update parentId, position; notify collector as modified)
5. Store new sibling under operator at its assigned position (set parentId to operator's ID; notify collector as added)
6. Store operator in the existing node's former slot (inherits saved parentId and position; notify collector as added)

### PremiseEngine layer

1. Assert expression belongs to this argument (argumentId/argumentVersion check on both expressions)
2. Validate variable references exist in `VariableManager`
3. Create `ChangeCollector`, set on `ExpressionManager`
4. Delegate to `ExpressionManager.wrapExpression`
5. If new sibling is type `"variable"`: update `expressionsByVariableId` index
6. Call `syncRootExpressionId()` (operator may become new root)
7. Mark checksum dirty
8. Sync expression index from changeset
9. Fire `onMutate` callback
10. Return `TCoreMutationResult` with stored operator as `result`

### ArgumentEngine layer

Follows the standard delegation pattern: look up `PremiseEngine` by `premiseId`, delegate, return result.

## Testing

New `describe("wrapExpression")` block at the bottom of `test/core.test.ts`. All tests build fixtures inline (no shared state).

### Happy paths

- Wrap root variable with binary operator (`and`, `or`) + new variable sibling, existing as left child
- Wrap root variable with binary operator + new variable sibling, existing as right child
- Wrap root variable with `implies` / `iff` + new sibling (valid because existing is at root)
- Wrap non-root node (child of an `and`) with new operator + sibling
- New sibling is an operator expression (e.g., wrap `P` to get `(Q and R) implies P`)
- New sibling is a formula expression

### Validation errors

- Neither `leftNodeId` nor `rightNodeId` provided
- Both `leftNodeId` and `rightNodeId` provided
- Operator expression ID already exists
- Sibling expression ID already exists
- Existing node does not exist
- Operator type is `not` (unary, cannot wrap with two children)
- Operator type is not `"operator"` (e.g., variable or formula passed as operator)
- `implies`/`iff` operator on non-root existing node
- Existing node is `implies`/`iff` (cannot be subordinated)
- New sibling is `implies`/`iff` (cannot be subordinated)
- Variable reference does not exist in `VariableManager`

### Changeset correctness

- Operator and sibling appear in added expressions
- Existing node appears in modified expressions (reparented)
- Root expression ID updated when wrapping a root node

### Integration

- Wrap then evaluate (truth table still works)
- Wrap then remove operator (collapse promotes children back)

## Design decisions

- **`TExpressionWithoutPosition` for both inputs**: Consistent with `appendExpression` and `addExpressionRelative`. Both positions are fully derived, so requiring the caller to provide them would be misleading.
- **Returns operator as result**: Consistent with `insertExpression`, which returns the newly inserted expression.
- **No `formula` or `not` as operator**: `formula` is not an operator type. `not` is unary and cannot have two children. Wrapping with `not` should use `insertExpression` with a single child instead.
- **Exactly one existing node**: Unlike `insertExpression` which accepts one or two existing nodes, `wrapExpression` always has exactly one existing node and one new node. Passing both as existing would just be `insertExpression`.
