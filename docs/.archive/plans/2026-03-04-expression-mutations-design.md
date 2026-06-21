# Expression Mutations Design

## Overview

Two changes to the expression mutation API:

1. **`updateExpression`** — new method to modify an expression's fields in place
2. **`removeExpression`** — extended with a `deleteSubtree` boolean parameter to control whether children are deleted or promoted

## `updateExpression`

### API

```typescript
// ExpressionManager (low-level, no changeset)
updateExpression(
  expressionId: string,
  updates: Partial<Pick<TExpressionInput, 'position' | 'variableId' | 'operator'>>
): TExpressionInput | undefined

// PremiseManager (premise-scoped, returns mutation result)
updateExpression(
  expressionId: string,
  updates: Partial<Pick<TExpressionInput, 'position' | 'variableId' | 'operator'>>
): TCoreMutationResult<TCorePropositionalExpression>
```

Not exposed directly on `ArgumentEngine` — callers access via `getPremise(id).updateExpression(...)`.

### Update type

The updates parameter accepts only `position`, `variableId`, and `operator`. A TypeScript type alias should be created for this (e.g. `TExpressionUpdate`).

### Field rules

| Field             | Allowed | Validation                                                                                    |
| ----------------- | ------- | --------------------------------------------------------------------------------------------- |
| `position`        | Yes     | Must not collide with existing sibling positions under the same parent                        |
| `variableId`      | Yes     | Expression must be type `"variable"`. New variable must exist in `VariableManager`            |
| `operator`        | Yes     | Expression must be type `"operator"`. Only `and <-> or` and `implies <-> iff` swaps permitted |
| `id`              | No      | Throw if present                                                                              |
| `argumentId`      | No      | Throw if present                                                                              |
| `argumentVersion` | No      | Throw if present                                                                              |
| `checksum`        | No      | Throw if present                                                                              |
| `parentId`        | No      | Throw if present (use delete + re-create for reparenting)                                     |
| `type`            | No      | Throw if present                                                                              |

### ExpressionManager behavior

1. Look up expression by ID, throw if not found
2. Reject any forbidden fields present in the updates object
3. If `operator` in updates:
    - Validate expression is type `"operator"`
    - Validate swap is permitted: `and <-> or`, `implies <-> iff`. All other changes throw.
4. If `variableId` in updates:
    - Validate expression is type `"variable"`
5. If `position` in updates:
    - Remove old position from `childPositionsByParentId`
    - Validate new position doesn't collide with siblings
    - Add new position to `childPositionsByParentId`
6. Apply updates to stored expression object (mutate in place)
7. Notify collector via `modifiedExpression(updatedExpression)`
8. Return updated expression

### PremiseManager behavior

1. Validate expression exists in this premise
2. If `variableId` changing: validate new variable exists in shared `VariableManager`
3. Create `ChangeCollector`, set on `ExpressionManager`
4. Delegate to `ExpressionManager.updateExpression`
5. If `variableId` changed: update `expressionsByVariableId` index (remove old mapping, add new)
6. Mark checksum dirty
7. Attach checksums to result and changeset
8. Return `TCoreMutationResult<TCorePropositionalExpression>`

### Changeset

Contains only the modified expression. No premise-level or role-level changes emitted (permitted swaps don't change structural invariants).

## `removeExpression` with `deleteSubtree` parameter

### API

```typescript
// ExpressionManager
removeExpression(
  expressionId: string,
  deleteSubtree: boolean
): TExpressionInput | undefined

// PremiseManager
removeExpression(
  expressionId: string,
  deleteSubtree: boolean
): TCoreMutationResult<TCorePropositionalExpression | undefined>
```

### `deleteSubtree: true` (current behavior, unchanged)

1. DFS collect target + all descendants into `toRemove` set
2. Remove all from maps, notify collector for each removal
3. Call `collapseIfNeeded(parentId)` on parent

### `deleteSubtree: false` (promote single child)

1. Look up expression, return `undefined` if not found
2. Get children of the expression
3. **>1 child**: throw error — "Cannot promote: expression has multiple children. Use deleteSubtree: true or remove children first."
4. **0 children** (leaf node): remove expression from maps, then call `collapseIfNeeded(parentId)` on parent (same as current leaf removal behavior)
5. **Exactly 1 child**:
   a. Validate: if child is `implies`/`iff` operator and the deleted expression's `parentId` is not `null`, throw — "Cannot promote: child is a root-only operator and would be placed in a non-root position."
   b. Promote child into deleted expression's slot (child inherits deleted expression's `parentId` and `position`)
   c. Remove deleted expression from all maps
   d. Notify collector: `removedExpression` for deleted, `modifiedExpression` for promoted child
   e. Update `childExpressionIdsByParentId`: replace deleted expression with child in parent's child set; remove deleted expression's own child tracking entry
   f. Update `childPositionsByParentId`: clean up old entries
   g. **No `collapseIfNeeded`** after promote

### PremiseManager layer

- Same changeset wrapping as current `removeExpression`
- When `deleteSubtree: false` and child promoted: only clean up `expressionsByVariableId` for the removed expression (surviving subtree is untouched)
- `syncRootExpressionId()` called after mutation (promotion may change root)

### Edge cases

- Removing a root `implies` with `deleteSubtree: false` and 1 child: child promoted to root. Valid since non-root-only operators are allowed at root.
- Removing a `not` with 1 child where child is `implies`: if `not` was at root (`parentId: null`), promotion is valid (child becomes root). If `not` was nested, throw because `implies` can't be non-root.
- `collapseIfNeeded` in `deleteSubtree: true` mode may itself promote children — this is existing behavior and remains unchanged.

## Design decisions

- **No reparenting via update**: parentId changes are forbidden. Users delete and re-create.
- **No type changes**: could create invalid trees (e.g. formula→variable with existing children).
- **Restricted operator swaps**: only within arity-compatible groups (`and/or` are variadic, `implies/iff` are binary root-only). `not` cannot be changed.
- **No collapse after promote**: when `deleteSubtree: false` promotes a child, collapse is not run. The caller chose to preserve the child, so the tree structure is intentional.
- **Collapse still runs on leaf removal**: when `deleteSubtree: false` removes a childless expression, collapse runs on the parent (same as current behavior for any leaf removal).
