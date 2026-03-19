# Operator Nesting Restriction Design

## Problem

Expression trees currently allow operator nodes to be direct children of other operator nodes (e.g., `and → or → [P, Q]`). This creates ambiguity in how a flattened formula is evaluated, since not everyone knows the order of operations of logical operators. A structural restriction is needed to force explicit grouping.

## Rule

A binary operator expression (`and`, `or`, `implies`, `iff`) cannot be a direct child of any operator expression (`and`, `or`, `not`, `implies`, `iff`). A `formula` node must sit between them to make grouping explicit.

The `not` operator is exempt as a child — it can be a direct child of any operator. This is because `not` is unary and its scope is unambiguous.

However, binary operators cannot be direct children of `not` either — a `formula` buffer is required.

### Nesting Rules Table

| Parent | Child | Allowed? |
|--------|-------|----------|
| binary op (`and`/`or`) | binary op (`and`/`or`) | No — needs `formula` buffer |
| binary op (`and`/`or`) | `not` | Yes |
| binary op (`and`/`or`) | `formula` | Yes |
| binary op (`and`/`or`) | `variable` | Yes |
| `not` | binary op (`and`/`or`) | No — needs `formula` buffer |
| `not` | `not` | Yes |
| `not` | `formula` | Yes |
| `not` | `variable` | Yes |
| `formula` | any | Yes (formula is the buffer) |

Note: `implies`/`iff` are already root-only and cannot appear as children. That existing restriction is orthogonal and both checks apply independently.

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

When `parentId` is not null and the parent is an operator, check whether the new expression is a binary operator. Throw if so. The check goes near the existing parent-type validation, after confirming the parent exists and is an operator/formula.

### `insertExpression()`

When splicing a new expression between existing nodes, two checks are needed:

1. The new expression as child of its new parent — if the parent is an operator and the new expression is a binary operator, throw.
2. The left/right nodes as children of the new expression — if the new expression is an operator and a left/right node is a binary operator, throw.

### `wrapExpression()`

When wrapping an existing node with a new operator and sibling, two checks are needed:

1. The new operator as child of its new parent — if the parent is an operator and the new operator is a binary operator, throw.
2. The existing node and sibling as children of the new operator — if they are binary operators, throw.

### `removeExpression()` — Collapse Promotion

When removing an expression causes operator collapse and a child is promoted into a parent slot, the promotion must be validated. If promoting a binary operator into an operator parent, the removal is rejected.

This keeps the invariant consistent for newly-created trees. Old trees created before this restriction wouldn't hit this path unless edited.

### Methods NOT Affected

- **`updateExpression()`** — The only allowed operator swaps are `and↔or` and `implies↔iff`. These don't change whether an expression is a binary operator, so no new violation can be created.
- **`fromSnapshot()` / `fromData()`** — Forward-only enforcement. Existing data created under old rules is trusted.

## Error Messages

- **Mutation methods** (`addExpression`, `insertExpression`, `wrapExpression`): `"Binary operator expressions cannot be direct children of operator expressions — wrap in a formula node"`

- **`removeExpression` collapse rejection**: `"Cannot remove expression — would promote a binary operator as a direct child of another operator"`

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

- Insert binary operator between an operator parent and its child → throws (new expression is binary op under operator)
- Insert binary operator that would receive binary operator children → throws
- Insert `not` between operator and its child → succeeds
- Insert `formula` between operator and its binary operator child → succeeds (this is the fix path)

### `wrapExpression` tests

- Wrap with binary operator under an operator parent → throws
- Wrap a binary operator child into a new binary operator → throws
- Wrap with binary operator at root → succeeds

### `removeExpression` collapse tests

- Remove a child causing promotion of binary operator into operator parent → throws (rejects removal)
- Remove a child causing promotion of `not` into operator parent → succeeds
