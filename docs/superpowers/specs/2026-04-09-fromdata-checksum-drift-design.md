# Design: Fix fromData Checksum Drift via `registerExpression` Extraction

**Date:** 2026-04-09
**Type:** Bug fix
**Severity:** High (blocks optimistic concurrency in proposit-server)
**Affected version:** 0.8.12
**Component:** `ExpressionManager` in `src/lib/core/expression-manager.ts`

## Problem

When `autoNormalize` is set to a granular `TAutoNormalizeConfig` with
`wrapInsertFormula: true`, successive calls to `ArgumentEngine.fromData` on the
same valid data can produce different checksums. This breaks checksum-based
optimistic concurrency control in proposit-server, where the engine is rebuilt
from the database on LRU cache misses.

### Root cause

`loadInitialExpressions` reconstructs the expression tree by calling
`addExpression` for each expression. `addExpression` is a mutation-time method
that performs grammar validation and auto-normalization (including
`wrapInsertFormula`). During restoration, this is unnecessary and harmful:

1. **Grammar enforcement during loading:** `addExpression` requires parents to
   exist before children, forcing a BFS ordering loop. The BFS processes
   expressions in array order (when their parent exists), which depends on the
   order the database returns rows. PostgreSQL heap order is non-deterministic
   after row updates (no `ORDER BY` clause on the server's query).

2. **Auto-normalization during loading:** If `wrapInsertFormula` fires during
   restoration (for data shapes where the check triggers), it calls
   `registerFormulaBuffer` with `generateId()`, producing a different UUID on
   each rebuild. This rewrites the expression's `parentId` and `position`,
   changing its meta checksum.

3. **Order-dependent state:** Even when auto-normalization doesn't fire, the
   BFS ordering loop introduces unnecessary coupling between array order and
   internal state (dirty set ordering, position registration order). While the
   final checksums should be deterministic for well-formed data, the
   restoration path should not depend on this invariant.

### Impact

- proposit-server uses `verifyChecksum` before mutations. After a cache miss
  and rebuild via `fromData`, the new engine's checksums don't match the
  DB-stored checksums from the previous engine, causing `ChecksumMismatchError`.
- Current workaround: `autoNormalize: false` for all `fromData` calls, which
  defeats the purpose of granular config.

## Solution

Extract the core registration logic from `addExpression` into a new private
`registerExpression` method. Loading paths (`loadInitialExpressions`) call
`registerExpression` directly, bypassing all grammar validation and
normalization. `addExpression` delegates to `registerExpression` after its
validation/normalization phase.

### New method: `registerExpression` (private)

Handles only the mechanical bookkeeping of storing an expression in the
manager's internal data structures:

1. Register position in `childPositionsByParentId`
2. `attachChecksum` (compute meta checksum, set `descendantChecksum: null`,
   `combinedChecksum: metaChecksum`)
3. Store in `expressions` map
4. Notify collector (if set; no-op during loading since collector is null)
5. Register in `childExpressionIdsByParentId`
6. `markExpressionDirty`

No validation, no normalization, no parent existence check, no child limit
check, no position collision check.

### Refactored `addExpression` (public)

Keeps all validation and normalization. After the validation phase (and possible
expression rewriting via `wrapInsertFormula`), delegates to
`registerExpression`:

1. ID uniqueness check
2. Self-referential parent check
3. Root-only operator check (`implies`/`iff` must have `parentId: null`)
4. Parent validation:
   - Existence
   - Type is operator or formula
   - `wrapInsertFormula` auto-insertion (may rewrite `parentId`/`position`,
     calls `registerFormulaBuffer`)
   - Child limit for operators
   - Single-child limit for formulas
5. Position collision check
6. **`this.registerExpression(expression)`**

### Simplified `loadInitialExpressions` (private)

The BFS loop is removed entirely. Since `registerExpression` does not require
parent existence, expressions can be loaded in any order:

```typescript
private loadInitialExpressions(initialExpressions: TExpressionInput<TExpr>[]) {
    for (const expression of initialExpressions) {
        this.registerExpression(expression)
    }
}
```

Data integrity is verified by the `validate()` call at the end of
`fromData`/`fromSnapshot`.

## Grammar config enforcement is preserved

`registerExpression` only bypasses validation and normalization **during the
loading step**. The grammar config remains fully effective through three
post-load mechanisms that are unchanged by this fix:

1. **Post-load normalization** (`fromData` line 1451, `fromSnapshot` line 1294):
   When `autoNormalize === true` (boolean), `normalizeExpressions()` runs on
   each premise after loading. This restructures the tree to satisfy grammar
   rules (e.g., inserting formula buffers, collapsing double negation). This
   path is unaffected — it operates on the fully-loaded tree, not during
   expression registration.

2. **Post-load validation** (`fromData` line 1467, `fromSnapshot` line 1305):
   `engine.validate()` calls `ExpressionManager.validate()`, which checks
   `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED` against `this.grammarConfig`
   (line 2217). Invalid data is rejected with `InvariantViolationError`. This
   runs after loading regardless of how expressions were registered.

3. **Config restoration** (`ExpressionManager.fromSnapshot` line 2359):
   After loading, `em.config = normalizedConfig` restores the snapshot's config.
   In `fromData`, the grammar config is set on the `ArgumentEngine` (line 1443)
   and was already passed to the `PremiseEngine`/`ExpressionManager` at
   construction time. All subsequent mutations use the correct grammar config.

The separation is: **load faithfully, then validate, then enforce going
forward.** `registerExpression` handles the first step. The existing post-load
code handles the second and third.

## Scope boundaries

- **`registerFormulaBuffer`** is left as-is. It is only called from mutation
  paths (`addExpression`, `insertExpression`, `wrapExpression`), never from
  loading. It could be refactored to use `registerExpression` in a follow-up
  but that is a separate cleanup.
- **No changes to `fromData` or `fromSnapshot`** on `ArgumentEngine`. The fix
  is entirely within `ExpressionManager`.
- **No changes to `PremiseEngine.loadExpressions`** — it delegates to
  `ExpressionManager.loadExpressions` which calls `loadInitialExpressions`.

## Testing strategy

1. **Reproduction test:** Build an expression tree with
   `IMPLIES(formula(AND(P, Q)), R)` via the normal mutation API with granular
   `wrapInsertFormula: true`. Extract flat expression arrays. Call `fromData`
   twice with the same data. Assert checksums are identical between both
   engines.

2. **Order-independence test:** Call `fromData` with expressions in multiple
   different array orderings (topological, reverse, shuffled). Assert all
   produce identical checksums.

3. **Existing tests:** All existing `fromData`, `fromSnapshot`, and expression
   tests must continue to pass — the refactoring preserves external behavior.

4. **Validation still catches bad data:** Verify that `fromData` with invalid
   data (missing parents, duplicate positions, etc.) still fails at the
   `validate()` step.

5. **Grammar enforcement after loading (fromData):** Build a `fromData` engine
   with `enforceFormulaBetweenOperators: true` and granular
   `wrapInsertFormula: true`. Feed it data with a non-NOT operator as a direct
   child of another operator (no formula buffer). Verify that `fromData` throws
   `InvariantViolationError` with `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED` —
   the grammar config is still enforced via post-load validation even though
   `registerExpression` doesn't check it.

6. **Grammar enforcement after loading (fromSnapshot):** Same as above but via
   `fromSnapshot`. Construct a snapshot with an operator-under-operator
   violation and verify the grammar config rejects it.

7. **Post-load normalization with `autoNormalize: true` (boolean):** Build
   `fromData` with `autoNormalize: true` (boolean, not granular) and feed it
   data with an unjustified formula (a formula whose bounded subtree has no
   binary operator). Verify the post-load `normalizeExpressions()` pass
   collapses the unjustified formula — i.e., the normalization path still works
   after the `registerExpression` refactor.

8. **Mutations after loading respect grammar config:** Load an engine via
   `fromData` with granular `wrapInsertFormula: true`. Then call
   `addExpression` to add a non-NOT operator as a child of an existing
   operator. Verify that `addExpression` auto-inserts a formula buffer — the
   grammar config is active for post-load mutations.

## Files changed

| File | Change |
|------|--------|
| `src/lib/core/expression-manager.ts` | Extract `registerExpression`, refactor `addExpression` to delegate, simplify `loadInitialExpressions` |
| `test/core.test.ts` | Add reproduction test, order-independence test, validation-still-catches test |
| `docs/change-requests/2026-04-09-fromdata-wrapinsertformula-checksum-drift.md` | Delete after implementation |
