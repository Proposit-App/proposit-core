# Auto-Normalize: Formula Collapse & Gated Operator Collapse

## Summary

Three changes to expression tree normalization:

1. **Gate operator collapse on `autoNormalize`**: The existing `collapseIfNeeded` mechanism (which collapses operators with 0 or 1 children) becomes conditional on `grammarConfig.autoNormalize`. When `autoNormalize` is false, the tree is free-form — incomplete or grammar-violating states are allowed.

2. **New formula collapse rule**: A formula node is only justified if its bounded subtree (stopping at the next nested formula) contains a binary operator (`and` or `or`). Formulas wrapping only variables, `not` chains, or other formulas without a binary operator are collapsed by promoting the formula's child into the formula's slot.

3. **Public `normalize()` API**: A method callers can invoke to normalize an expression tree on demand, regardless of `autoNormalize` setting.

## Motivation

Formula nodes exist to group a binary operator's operands relative to a parent operator. A formula wrapping a single variable (`formula -> variable`) or a unary chain (`formula -> not -> variable`) serves no grouping purpose. Currently these survive indefinitely.

Separately, operator collapse (0/1 children) currently runs unconditionally — even when `autoNormalize` is false. This prevents callers from building up trees incrementally (e.g., adding an operator before its children). Gating collapse on `autoNormalize` makes the flag the single control point for all automatic structural normalization.

## Design

### 1. Grammar Config Default Change

```typescript
DEFAULT_GRAMMAR_CONFIG = {
    enforceFormulaBetweenOperators: true,
    autoNormalize: true, // was false
}
```

Changing the default preserves existing collapse behavior for users who don't set grammar config explicitly. `PERMISSIVE_GRAMMAR_CONFIG` is unchanged (`{ enforceFormulaBetweenOperators: false, autoNormalize: false }`).

### 2. `collapseIfNeeded` Modifications

**2a. Gate on `autoNormalize`**

Early return at the top of `collapseIfNeeded`:

```typescript
private collapseIfNeeded(operatorId: string | null): void {
    if (!this.grammarConfig.autoNormalize) return
    // ... existing logic
}
```

This gates both operator collapse and formula collapse on the same flag.

**2b. New helper: `hasBinaryOperatorInBoundedSubtree`**

```typescript
private hasBinaryOperatorInBoundedSubtree(expressionId: string): boolean
```

Walks the subtree rooted at `expressionId`:

- Returns `true` if it encounters an `and` or `or` operator expression.
- Stops traversal at formula boundaries (returns `false` for that branch — the nested formula owns its own subtree).
- Returns `false` for variable expressions (leaf).
- Recurses into `not` operator children.

**2c. Extend formula branch for 1-child case**

Currently the formula case in `collapseIfNeeded` only handles 0 children (deletes the formula, recurses to grandparent). Add the 1-child case:

If the formula has 1 child and `hasBinaryOperatorInBoundedSubtree(child.id)` returns `false`, promote the child into the formula's slot using the same promotion mechanics as operator-with-1-child:

- Update child's `parentId` to formula's `parentId`, child's `position` to formula's `position`.
- Update grandparent's child-id set: remove formula, add child.
- Remove formula from expressions map and tracking.
- Emit `removedExpression` for formula, `modifiedExpression` for promoted child.
- Prune formula from dirty set, mark promoted child dirty.
- Recurse: `collapseIfNeeded(grandparentId)` — the grandparent may itself be a formula that now needs collapsing.

**2d. Recurse after operator promotion**

Currently operator promotion (operator with 1 child) does not recurse. Change: after promoting a child into an operator's slot, call `this.collapseIfNeeded(grandparentId)`. This catches cascades where an operator inside a formula collapses, leaving the formula with a non-binary-operator child that triggers formula collapse.

### 3. `assertRemovalSafe` / `simulateCollapseChain`

These methods simulate the collapse chain before any mutation to detect rule violations. When `autoNormalize` is false, no collapse occurs, so simulation should be skipped:

- `simulateCollapseChain`: early return if `!this.grammarConfig.autoNormalize`.

The promotion validation in `removeAndPromote` (checking `enforceFormulaBetweenOperators` for direct promotion) remains independent — it concerns the explicit removal semantics, not automatic collapse.

### 4. Public `normalize()` API

New public method on `ExpressionManager`:

```typescript
public normalize(): void
```

Performs a full normalization sweep:

1. Finds all formulas whose bounded subtree has no binary operator and collapses them.
2. Runs operator collapse (0/1 children) on any operators that need it.
3. Inserts formula buffers where `enforceFormulaBetweenOperators` requires them (binary operators as direct children of operators without formula wrappers).
4. Repeats until stable (collapsing one node may expose another).

Exposed through the engine API:

- `PremiseEngine.normalizeExpressions()` — normalizes one premise's expression tree, returns changeset.
- `ArgumentEngine.normalizeAllExpressions()` — normalizes all premises, returns combined changeset.

These methods work regardless of the current `autoNormalize` setting — they perform the normalization on demand.

### 5. Post-Load Normalization

After `fromSnapshot` / `fromData` finishes loading all data and restores the caller's grammar config:

- If `autoNormalize` is true in the restored config, call the normalize sweep on each premise's expression tree.
- This runs after `restoringFromSnapshot` is set back to `false`, so normal mutation semantics apply.
- Catches any unjustified formulas in serialized data.

Normalization does NOT run inline during loading. Expressions are loaded permissively (as currently done via `loadExpressions`), and normalization is deferred until all expressions are in place.

### 6. Changeset Semantics

Formula collapse produces the same changeset entries as operator collapse:

- **Formula deleted**: `removedExpression` event
- **Child promoted**: `modifiedExpression` event (parentId/position changed)
- Dirty propagation follows existing patterns (mark promoted child dirty, prune deleted from dirty set)

The public `normalize()` methods return a `TCoreChangeset` / `TCoreMutationResult` reflecting all changes made during the sweep.

## What Does NOT Change

- `addExpression` does not trigger formula collapse. A formula can only become unjustified through removal, not addition.
- `insertExpression` and `wrapExpression` do not trigger formula collapse. They create formula buffers around binary operators, which are always justified.
- The `enforceFormulaBetweenOperators` flag remains independent. When true with `autoNormalize` false, violations still throw. When false, no formula-between-operators checking occurs.
- `removeAndPromote` promotion validation (checking nesting rules for explicit removal) remains independent of `autoNormalize`.
- Formula buffer auto-insertion in `addExpression` / `insertExpression` / `wrapExpression` continues to be gated on both `enforceFormulaBetweenOperators` and `autoNormalize` as before.

## Files Affected

- `src/lib/types/grammar.ts` — default config change
- `src/lib/core/expression-manager.ts` — `collapseIfNeeded`, new helper, `normalize()`, `assertRemovalSafe`/`simulateCollapseChain`
- `src/lib/core/premise-engine.ts` — `normalizeExpressions()` public method
- `src/lib/core/argument-engine.ts` — `normalizeAllExpressions()` public method, post-load normalization in `fromSnapshot`/`fromData`
- `test/core.test.ts` — new test cases, possible adjustments to existing tests that rely on collapse with default config
