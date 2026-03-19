# Operator Nesting Restriction Design

## Problem

Expression trees currently allow operator nodes to be direct children of other operator nodes (e.g., `and → or → [P, Q]`). This creates ambiguity in how a flattened formula is evaluated, since not everyone knows the order of operations of logical operators. A structural restriction is needed to force explicit grouping.

## Rule

A non-`not` operator expression (`and`, `or`, `implies`, `iff`) cannot be a direct child of any operator expression (`and`, `or`, `not`, `implies`, `iff`). A `formula` node must sit between them to make grouping explicit.

The `not` operator is exempt as a child — it can be a direct child of any operator. This is because `not` is unary and its scope is unambiguous.

However, non-`not` operators cannot be direct children of `not` either — a `formula` buffer is required.

### Nesting Rules Table

| Parent          | Child                      | Allowed?                    |
| --------------- | -------------------------- | --------------------------- |
| `and`/`or`      | `and`/`or`/`implies`/`iff` | No — needs `formula` buffer |
| `and`/`or`      | `not`                      | Yes                         |
| `and`/`or`      | `formula`                  | Yes                         |
| `and`/`or`      | `variable`                 | Yes                         |
| `implies`/`iff` | `and`/`or`/`implies`/`iff` | No — needs `formula` buffer |
| `implies`/`iff` | `not`                      | Yes                         |
| `implies`/`iff` | `formula`                  | Yes                         |
| `implies`/`iff` | `variable`                 | Yes                         |
| `not`           | `and`/`or`/`implies`/`iff` | No — needs `formula` buffer |
| `not`           | `not`                      | Yes                         |
| `not`           | `formula`                  | Yes                         |
| `not`           | `variable`                 | Yes                         |
| `formula`       | any                        | Yes (formula is the buffer) |

Note: `implies`/`iff` are already root-only and cannot appear as children. The existing root-only check fires first, making the non-`not` child rows for `implies`/`iff` unreachable in practice. They are listed here for completeness — both restrictions are orthogonal and apply independently.

Note: `and`/`or` are variadic (≥2 children), not strictly binary. The term "non-`not` operator" is used throughout this spec to mean any operator other than `not` — i.e., `and`, `or`, `implies`, `iff`.

### Formal Check

```
if child.type === "operator"
   && child.operator !== "not"
   && parent.type === "operator"
then throw
```

## Affected Methods

All in `ExpressionManager` (`src/lib/core/expression-manager.ts`):

### `addExpression()`

When `parentId` is not null and the parent is an operator, check whether the new expression is a non-`not` operator. Throw if so. The check goes near the existing parent-type validation, after confirming the parent exists and is an operator/formula.

`appendExpression()` and `addExpressionRelative()` delegate to `addExpression()` and are transitively covered.

### `insertExpression()`

When splicing a new expression between existing nodes, two checks are needed:

1. The new expression as child of its new parent — if the parent is an operator (not formula) and the new expression is a non-`not` operator, throw.
2. The left/right nodes as children of the new expression — if the new expression is an operator (not formula) and a left/right node is a non-`not` operator, throw.

### `wrapExpression()`

When wrapping an existing node with a new operator and sibling, two checks are needed:

1. The new operator as child of its new parent — if the parent is an operator and the new operator expression is a non-`not` operator, throw.
2. The existing node and the new sibling as children of the new operator — if either is a non-`not` operator, throw. Note: the sibling is a new expression being created (a `TExpressionWithoutPosition`), not an existing node in the tree.

### `removeExpression()` — Pre-flight Promotion Validation

There are two promotion paths that can violate the nesting rule:

1. **Direct promotion (`removeAndPromote`, 1-child branch):** When removing an expression that has exactly 1 child with `deleteSubtree: false`, the child is promoted into the removed node's slot. If the child is a non-`not` operator and the grandparent is an operator, the nesting rule would be violated. Example: removing a `formula` from `and → formula → or → [P, Q]` would place `or` directly under `and`.

2. **Collapse promotion (`collapseIfNeeded`, 1-child branch):** When removing a child leaves an operator/formula with 1 remaining child, the remaining child is promoted into the operator's slot. If the remaining child is a non-`not` operator and the grandparent is an operator, the nesting rule would be violated.

**Implementation approach:** Both paths must validate _before_ mutating the tree. The current code in `collapseIfNeeded` mutates (deletes the expression) before running collapse, so a pre-flight check is needed.

- For **direct promotion**: add the check before the existing root-only check at line 487, in the same guard block.
- For **collapse promotion**: add a pre-flight validation step in `removeExpression` (the public method) that simulates the collapse chain before committing the deletion. This check must handle cascading collapse — removing a subtree under an operator could cause 0-child deletion of the operator, which triggers collapse at the grandparent, which may attempt to promote a non-`not` operator. The pre-flight simulation walks the chain: at each level, compute resulting child count; if 0, continue up (formula nodes losing their only child are treated as 0-child deletion, same as operators); if 1, check the surviving child against its new parent.

If the pre-flight check detects a violation, the removal is rejected with an error and no mutation occurs.

**Pre-existing gap:** `collapseIfNeeded` also lacks the existing root-only check for `implies`/`iff` promotion (that check only exists in `removeAndPromote`). This should be fixed as part of this work. The pre-flight check validates both the nesting rule and the root-only rule before any mutation occurs. As defense-in-depth, `collapseIfNeeded` itself should also gain the same guards in its 1-child promotion branch — if the pre-flight simulation has a bug, the mutation-time check prevents silent data corruption.

### Methods NOT Affected

- **`updateExpression()`** — The only allowed operator swaps are `and↔or` and `implies↔iff`. These don't change whether an expression is a non-`not` operator, so no new violation can be created.
- **`fromSnapshot()` / `fromData()` / `rollback()`** — Forward-only enforcement. Existing data created under old rules is trusted. All restoration paths must bypass the nesting check:
    - `ExpressionManager.fromSnapshot` → `loadInitialExpressions` → `addExpression`: already an internal path. A private `skipNestingCheck` flag on `ExpressionManager` is set to `true` by `loadInitialExpressions` before loading and reset to `false` in a `finally` block. The flag is checked in `addExpression` only.
    - `ArgumentEngine.fromData` calls `PremiseEngine.addExpression` → `ExpressionManager.addExpression` directly (not through `loadInitialExpressions`). To cover this path, `ExpressionManager` exposes a `loadExpressions(expressions[])` method that wraps the BFS-with-bypass logic currently in `loadInitialExpressions`. `PremiseEngine` exposes a corresponding `loadExpressions` method that delegates to it. `ArgumentEngine.fromData` calls `pe.loadExpressions(premiseExprs)` instead of calling `pe.addExpression` in a loop — eliminating the duplicated BFS logic in `fromData` as well.
    - `ArgumentEngine.rollback` → `PremiseEngine.fromSnapshot` → `ExpressionManager.fromSnapshot` → `loadInitialExpressions`: covered by the `skipNestingCheck` flag path above.

## Error Messages

- **Mutation methods** (`addExpression`, `insertExpression`, `wrapExpression`): `"Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node"`

- **`removeExpression` pre-flight rejection**: `"Cannot remove expression — would promote a non-not operator as a direct child of another operator"`

## Testing

New `describe` block in `test/core.test.ts`:

### `addExpression` tests

- `and` as child of `and` → throws
- `or` as child of `not` → throws
- `not` as child of `and` → succeeds
- `not` as child of `not` → succeeds
- `and` as child of `formula` → succeeds (formula is the buffer)
- `formula → and` as child of `or` → succeeds (formula buffer between operators)

### `insertExpression` tests

- Insert non-`not` operator between an operator parent and its child → throws (new expression is non-`not` op under operator)
- Insert non-`not` operator that would receive non-`not` operator children → throws
- Insert `not` between operator and its child → succeeds
- Insert `formula` between operator and its child (e.g., `and → not → P`, insert formula between `and` and `not`) → succeeds (formula insertion is always valid; also demonstrates the pattern for fixing legacy trees loaded via `fromSnapshot`)

### `wrapExpression` tests

- Wrap with non-`not` operator under an operator parent → throws
- Wrap a non-`not` operator child into a new non-`not` operator → throws
- Wrap where the new sibling is a non-`not` operator → throws
- Wrap with non-`not` operator at root → succeeds

### `removeExpression` promotion tests

- Direct promotion (`deleteSubtree: false`): remove `formula` between two operators, causing non-`not` operator to promote under operator → throws
- Direct promotion: remove node causing `not` to promote under operator → succeeds
- Collapse promotion: remove child leaving 1 sibling that is a non-`not` operator under operator grandparent → throws
- Collapse promotion: remove child leaving 1 sibling that is `not` under operator grandparent → succeeds
- Cascading collapse: remove node causing 0-child deletion chain, where final promotion is safe → succeeds (no false rejection)
- Cascading collapse: remove node causing 0-child deletion chain, where final promotion violates the nesting rule → throws

### Restoration tests

- Verify `fromSnapshot` can restore a tree containing operator-under-operator (forward-only enforcement)
- Verify `fromData` can reconstruct a tree containing operator-under-operator (forward-only enforcement)
- Verify `rollback` can restore a tree containing operator-under-operator (forward-only enforcement)
