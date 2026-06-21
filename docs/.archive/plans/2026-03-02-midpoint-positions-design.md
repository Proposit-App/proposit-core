# Midpoint-Based Position Handling

## Problem

Position values in the expression tree are currently nullable integers managed manually by callers. Inserting a sibling between two existing children requires the caller to know which positions are occupied and may require renumbering. The literal value of a position doesn't matter — only relative ordering does.

## Solution

Replace nullable integer positions with non-nullable floats using a midpoint bisection strategy. Add intent-based methods (`addExpressionRelative`, `appendExpression`) so callers say "before X" or "after X" and the library computes positions automatically. Keep explicit position on `addExpression` as a low-level escape hatch.

## Design

### 1. Schema Change

`position` in `BasePropositionalExpressionSchema` changes from `Nullable(Type.Integer({ minimum: 0 }))` to `Type.Number({ minimum: 0 })`.

- Non-nullable: every expression always has a numeric position.
- Float (`Type.Number` instead of `Type.Integer`): allows midpoint bisection to produce non-integer values.
- Root expressions get a position too (typically `POSITION_INITIAL`). Since there's only one root per premise, its value is functionally irrelevant.

This is a breaking change to serialized data.

### 2. Position Utilities

Constants and helper, exported from a new `utils/position.ts`:

```typescript
const POSITION_MIN = 0
const POSITION_MAX = Number.MAX_SAFE_INTEGER
const POSITION_INITIAL = Math.floor(POSITION_MAX / 2)

function midpoint(a: number, b: number): number {
    return (a + b) / 2
}
```

Position computation rules for inserting a child under a given parent:

| Scenario                       | Position                                  |
| ------------------------------ | ----------------------------------------- |
| First child (no siblings)      | `POSITION_INITIAL`                        |
| Append (after last sibling)    | `midpoint(last.position, POSITION_MAX)`   |
| Prepend (before first sibling) | `midpoint(POSITION_MIN, first.position)`  |
| Between two siblings           | `midpoint(left.position, right.position)` |

~52 bisections at the same insertion point before losing floating-point precision.

### 3. ExpressionManager Changes

**Existing `addExpression`:** Position is now required as a `number`. Still validates uniqueness. This is the low-level escape hatch.

**New methods:**

- `addExpressionRelative(siblingId: string, position: "before" | "after", expression)` — looks up the sibling, finds its neighbor in the specified direction, computes the midpoint. Delegates to `addExpression`.
- `appendExpression(parentId: string | null, expression)` — finds the last child of that parent, computes position after it (or `POSITION_INITIAL` if no children). Delegates to `addExpression`.

Input type for new methods omits `position` (it's computed internally).

**Simplified internals:**

- `getChildExpressions`: sort becomes `(a, b) => a.position - b.position`. No null handling.
- `reparent`: position parameter becomes `number`. All null checks removed.
- `collapseIfNeeded`: `if (position !== null)` guards become unconditional.

**PremiseManager** mirrors `addExpressionRelative` and `appendExpression`, adding its own validation (argument ownership, variable existence, single-root enforcement) before delegating to ExpressionManager.

### 4. insertExpression and Binary Ops

No logic changes. Mechanical null-check removal only. `insertExpression` still hardcodes positions 0 and 1 for left/right children. Evaluation code using `children.find((child) => child.position === 0)` for `implies`/`iff` is unchanged. The `EXPR_BINARY_POSITIONS_INVALID` validation check remains.

### 5. CLI Changes

`expressions create`:

- New options: `--before <sibling_id>`, `--after <sibling_id>`.
- `--position <n>` kept as explicit escape hatch.
- Default (none specified): append as last child under the parent.
- Error if `--before`/`--after` combined with `--position`.
- Routes to `appendExpression`, `addExpressionRelative`, or `addExpression` accordingly.

`expressions insert`: No change (position computed internally).

`expressions list` / `expressions show`: Position always displays as a number.

### 6. Testing

New `describe` block at the bottom of `ExpressionManager.test.ts`:

- Position utilities: `midpoint` computation, constants.
- `appendExpression`: first child gets `POSITION_INITIAL`, subsequent children get midpoints, ordering is correct.
- `addExpressionRelative`: before first, after last, between two — verify computed positions maintain sort order.
- `addExpression` escape hatch: explicit position works, duplicates throw.
- `getChildExpressions` ordering: numeric sort only.
- PremiseManager wrappers: intent-based methods with validation.

Existing tests: mechanical updates replacing `position: null` with numeric values and removing null-position sort tests.
