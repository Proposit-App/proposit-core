# Auto-Reposition on Position Collision — Design

**Date:** 2026-04-09
**Status:** Approved
**Change request:** `docs/change-requests/2026-04-09-auto-reposition-on-collision.md`

## Problem

`addExpressionRelative` and other midpoint-computing operations produce position collisions when the gap between consecutive siblings is <= 1, because `midpoint(a, b) = Math.trunc(a + (b - a) / 2)` truncates toward zero (e.g., `midpoint(0, 1) = 0`). Consumers are forced to implement ~30 lines of position-widening logic externally, tightly coupled to the library's internal position strategy.

Additionally, `insertExpression` hardcodes child positions as 0 and 1, leaving no room for future bisection between reparented children.

## Solution

### New `autoNormalize` flag

Add `repositionOnCollision: boolean` to `TAutoNormalizeConfig`.

- **Enabled** (via `autoNormalize: true` or granular config): midpoint-computing operations auto-redistribute siblings to resolve collisions.
- **Disabled** (via `autoNormalize: false` or granular config): collisions throw as they do today.

`DEFAULT_GRAMMAR_CONFIG` (`autoNormalize: true`) enables the flag by default. `PERMISSIVE_GRAMMAR_CONFIG` (`autoNormalize: false`) disables it — no behavior change for `fromData`/`fromSnapshot` loads.

### Targeted redistribution

When a midpoint collision is detected, only the minimal set of nodes is repositioned — not all children of the parent.

**Algorithm** (for inserting between positions `p[i]` and `p[i+1]` where `p[i+1] - p[i] <= 1`):

1. **Scan right:** From index `i+1`, walk right while consecutive gaps are <= 1. The first gap > 1 (or `positionConfig.max`) is the right boundary. Count nodes in this chain.
2. **Scan left:** From index `i`, walk left while consecutive gaps are <= 1. The first gap > 1 (or `positionConfig.min`) is the left boundary. Count nodes in this chain.
3. **Pick the direction with fewer nodes to shift.** On tie, pick right (arbitrary but deterministic).
4. **Redistribute those nodes evenly** within the available space (between the insertion point's neighbor and the boundary). Even spacing maximizes future bisection room.
5. Report each repositioned node via `collector.modifiedExpression()` and mark dirty for checksum recomputation.
6. Recompute midpoint against the new positions.

The redistribution is a private method on `ExpressionManager`. It bypasses `updateExpression` (which has operator swap validation and per-update collision checks) and instead rebuilds positions atomically: clears affected positions from the parent's position set, computes new positions, updates each expression with fresh checksum, notifies the collector, and rebuilds the position set. Returns the array of modified expressions.

**Example:** Positions `0, 5, 6, 10`, insert between 5 and 6:

- Right chain: [6], boundary 10. Left chain: [5], boundary 0. Tie — pick right.
- Redistribute [6] in (5, 10) -> position 7. Then `midpoint(5, 7) = 6`. One modification.

**Example:** Positions `0, 1, 2, 3, 100`, insert between 1 and 2:

- Right chain: [2, 3], boundary 100. Left chain: [0, 1], boundary min. Pick right.
- Redistribute [2, 3] in (1, 100) -> positions 34, 67. Then `midpoint(1, 34) = 17`. Two modifications.

## Affected operations

| Method                  | Change                                                                                                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `addExpressionRelative` | After computing midpoint, detect collision -> targeted redistribution -> recompute midpoint.                                                                                                                                                                             |
| `appendExpression`      | Same — midpoint between last child and `max` can collide if last child is at `max - 1`.                                                                                                                                                                                  |
| `insertExpression`      | Replace hardcoded `reparent(..., 0)` / `reparent(..., 1)` with evenly-spaced positions across `[positionConfig.min, positionConfig.max]`. For 2 children: `initial` and `midpoint(initial, max)` (matching `wrapExpression`'s existing pattern). For 1 child: `initial`. |
| `wrapExpression`        | Already uses `initial` and `midpoint(initial, max)` — no change needed.                                                                                                                                                                                                  |
| `promoteChild`          | When the flag is enabled and grandparent has siblings, compute midpoint between parent's left and right neighbors (or `min`/`max` boundaries) instead of inheriting parent's position. When disabled or at root, keep existing behavior.                                 |
| `addExpression`         | No change — caller provides explicit position, collision still throws.                                                                                                                                                                                                   |

### Changeset impact

All repositioned expressions appear in `changes.expressions.modified` on the returned `TCoreMutationResult`, alongside the new expression in `changes.expressions.added`. Consumers get a single changeset reflecting both the insertion and any repositioning side effects.

## Error handling and edge cases

- **Flag disabled:** All midpoint-computing operations throw on collision as today.
- **Flag enabled, no collision:** No redistribution. Zero overhead — just a set lookup after computing the midpoint.
- **Position range exhausted:** If the tight chain spans the entire range with no gap in either direction, throw. Practically impossible with int32 range.
- **`promoteChild` at root (`grandparentId === null`):** No siblings. Keep parent's position regardless of flag.
- **`promoteChild` with no neighbors:** Only child of grandparent. Keep parent's position.
- **Single-child parent in `appendExpression`:** Position is `positionConfig.initial`. No collision possible.

## Test cases

1. **Collision with consecutive integers:** Operator with children at 0 and 1. `addExpressionRelative` after first child. Flag enabled -> redistribution + clean insertion. Verify `changes.expressions.modified` contains repositioned sibling(s).
2. **No collision (wide gap):** Children at 0 and 1000. Insert between. No repositioning — midpoint is 500.
3. **Three consecutive children:** Positions 0, 1, 2. Insert after position 0. Only the tight chain shifts.
4. **Flag disabled -> throws:** Same setup as #1 but with flag disabled. Verify error thrown.
5. **`appendExpression` collision:** Child at `POSITION_MAX - 1`. Append triggers redistribution.
6. **`insertExpression` spacing:** After `insertExpression` with left and right nodes, verify children get evenly-spaced positions (not 0 and 1).
7. **`promoteChild` repositioning:** Three siblings at 0, 1, 100. Remove middle node, promote its child. Verify promoted child gets `midpoint(0, 100) = 50`, not 1.
8. **`promoteChild` at root:** Promoted to root keeps parent's position.
9. **Changeset correctness:** Every repositioned node appears in `changes.expressions.modified` with updated position and checksum.
10. **Tight chain direction:** Positions `0, 5, 6, 7, 100`. Insert between 5 and 6. Only [6, 7] shift right (toward gap at 100). Nodes 0 and 5 untouched.
