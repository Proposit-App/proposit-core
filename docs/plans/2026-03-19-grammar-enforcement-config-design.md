# Grammar Enforcement Config Design

## Problem

The operator nesting restriction is currently enforced unconditionally during mutations and bypassed via a `skipNestingCheck` boolean flag during restoration. This is ad-hoc and doesn't scale as more structural rules are added (e.g., arity enforcement). There's also no way for callers to opt into auto-normalization of non-compliant trees.

## Solution

Replace the `skipNestingCheck` flag with a first-class `TGrammarConfig` system that:

- Toggles individual structural rules independently
- Supports auto-normalization (automatically fix violations where possible)
- Threads through the existing `TLogicEngineOptions` → `ArgumentEngine` → `PremiseEngine` → `ExpressionManager` pipeline
- Allows callers of `fromSnapshot`, `fromData`, and other static factories to control enforcement at load time

## Type Definitions

New file `src/lib/types/grammar.ts`:

```typescript
type TGrammarOptions = {
    enforceFormulaBetweenOperators: boolean
}

type TGrammarConfig = TGrammarOptions & {
    autoNormalize: boolean
}

const DEFAULT_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: true,
    autoNormalize: false,
}
```

`TGrammarOptions` defines the individual rule toggles. `TGrammarConfig` extends it with the `autoNormalize` cross-cutting flag. This separation allows `TGrammarOptions` to be used independently in contexts where auto-normalize is not applicable (e.g., future validation-only paths).

**`autoNormalize` asymmetry:** Auto-normalization is only supported in `addExpression` and `loadInitialExpressions`. Compound mutation operations (`insertExpression`, `wrapExpression`) and `removeExpression` always throw on violations regardless of this flag — callers must construct correct trees for these operations. This is documented in the type's JSDoc.

`TLogicEngineOptions` gains a new optional field:

```typescript
type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
    grammarConfig?: TGrammarConfig
}
```

When `grammarConfig` is omitted, `DEFAULT_GRAMMAR_CONFIG` is used — all rules enforced, auto-normalize off. This preserves current behavior.

The grammar config round-trips through snapshots via the existing `TLogicEngineOptions` path. `TExpressionManagerSnapshot` already has `config?: TLogicEngineOptions`, and `snapshot()` already stores `this.config`. Adding `grammarConfig` to `TLogicEngineOptions` means it is automatically serialized and deserialized in snapshots with no additional work.

## ExpressionManager Changes

`ExpressionManager` stores the resolved `TGrammarConfig` (from options or default). The private `skipNestingCheck` flag is removed.

### `addExpression`

The current guard (`if (!this.skipNestingCheck && ...)`) becomes:

```
if grammarConfig.enforceFormulaBetweenOperators
   && parent.type === "operator"
   && expression is non-not operator:
    if autoNormalize:
        insert formula buffer between parent and expression (in place)
    else:
        throw
```

Auto-normalization mechanics (all within the same `addExpression` invocation, not recursive):
1. Create a formula node with `randomUUID()` as ID, copying `argumentId`, `argumentVersion`, `premiseId` from the expression
2. Use the expression's intended position under the parent for the formula
3. Register the formula directly in the expression store and index maps (bypassing `addExpression` to avoid recursion). This is safe because formula nodes never trigger the nesting check (they are type `"formula"`, not `"operator"`)
4. Rewrite the expression's `parentId` to the formula's ID, position to `0` (only child of formula)
5. Continue with normal `addExpression` flow for the rewritten expression

### `insertExpression` and `wrapExpression`

Check `grammarConfig.enforceFormulaBetweenOperators` instead of the removed flag. When the rule is enabled and violated, always throw — even when `autoNormalize` is `true`. These are compound operations where the caller must construct correct trees. Auto-normalization is not supported.

### `removeExpression`

The pre-flight check (`assertRemovalSafe`, `simulateCollapseChain`, `assertPromotionSafe`) consults `grammarConfig.enforceFormulaBetweenOperators`. When the rule is disabled, the nesting check in `assertPromotionSafe` is skipped (the root-only check for `implies`/`iff` remains unconditional). No auto-normalize path — if removal would create a violation, it's rejected.

### Defense-in-depth guards

The nesting guards in `removeAndPromote` and `collapseIfNeeded` also consult `grammarConfig.enforceFormulaBetweenOperators`. When enforcement is disabled, these guards are skipped. They remain as safety nets for when enforcement is enabled — if the pre-flight simulation has a bug, the mutation-time check prevents silent data corruption. The root-only check for `implies`/`iff` in `collapseIfNeeded` remains unconditional (it is not grammar-configurable).

### `loadInitialExpressions`

No longer needs to toggle `skipNestingCheck`. It calls `addExpression` normally and the grammar config controls enforcement. If the `ExpressionManager` was constructed with enforcement disabled (because the caller passed that config to `fromSnapshot`), the checks don't fire.

## Static Factory and Restoration Changes

### Config precedence in `fromSnapshot`

All `fromSnapshot` methods gain an optional `grammarConfig` parameter that controls enforcement **during loading only**. The parameter does NOT become the engine's stored config — the engine's ongoing grammar config comes from `snapshot.config?.grammarConfig` (or `DEFAULT_GRAMMAR_CONFIG` if absent). This means:

- Loading: uses the explicit `grammarConfig` parameter (if provided) or `snapshot.config?.grammarConfig` or `DEFAULT_GRAMMAR_CONFIG`
- Subsequent mutations: uses `snapshot.config?.grammarConfig` or `DEFAULT_GRAMMAR_CONFIG`

Implementation: during `fromSnapshot`, a temporary `ExpressionManager` is constructed with the loading config. After loading completes, the stored config is replaced with the snapshot's config. Alternatively, the loading config is applied only to `loadInitialExpressions` (via a temporary config swap in a `try/finally`).

### `ExpressionManager.fromSnapshot`

```typescript
static fromSnapshot(snapshot, grammarConfig?): ExpressionManager
```

### `PremiseEngine.fromSnapshot`

Gains optional `grammarConfig` parameter, passes through to `ExpressionManager.fromSnapshot`.

### `ArgumentEngine.fromSnapshot`

Gains optional `grammarConfig` parameter, passes through to each `PremiseEngine.fromSnapshot` call.

### `ArgumentEngine.fromData`

Gains optional `grammarConfig` parameter. Controls enforcement during loading. **Default behavior when no `grammarConfig` is provided:** no enforcement (`{ enforceFormulaBetweenOperators: false, autoNormalize: false }`). This preserves the current behavior where `fromData` always loads without enforcement. Callers wanting enforcement or auto-normalization pass an explicit config.

This differs from the constructor/mutation default (which enforces). The rationale: `fromData` loads external data which may predate the grammar rules, so permissive loading is the safe default.

### `PremiseEngine.loadExpressions`

Preserved as a convenience. Respects the grammar config of the `ExpressionManager` instance rather than unconditionally bypassing. Since `fromData` constructs engines with permissive config by default, this method continues to work for its original purpose.

### `rollback`

Restores the grammar config from the snapshot, just like it restores `checksumConfig` and `positionConfig`. During restoration, `rollback` calls `PremiseEngine.fromSnapshot` for each premise — it passes a permissive grammar config for the loading phase (same as current `skipNestingCheck` bypass) so that rolling back to a snapshot with operator-under-operator trees succeeds. After restoration completes, the engine uses `snapshot.config?.grammarConfig` for subsequent mutations.

## Error Handling

- **Enforcement violation (no auto-normalize):** Throws with existing error messages (`"Non-not operator expressions cannot be direct children..."`, `"Cannot remove expression — would promote..."`)
- **Auto-normalize failure:** Throws with descriptive error. For the current operator nesting rule, auto-normalize always succeeds (inserting a formula buffer is always valid). Future rules may have cases where normalization is impossible.
- **Auto-normalize not supported for compound operations:** `insertExpression`, `wrapExpression`, and `removeExpression` throw even with `autoNormalize: true`.

## Testing

New `describe("grammar enforcement config")` block in `test/core.test.ts`:

### Config behavior

- Default config (no `grammarConfig`) enforces nesting restriction and throws — same as current behavior
- `{ enforceFormulaBetweenOperators: false }` allows operator-under-operator via `addExpression`
- `{ enforceFormulaBetweenOperators: false }` allows operator-under-operator via `insertExpression` and `wrapExpression`
- `{ enforceFormulaBetweenOperators: false }` allows removals that would promote operator-under-operator

### Auto-normalize

- `{ enforceFormulaBetweenOperators: true, autoNormalize: true }` — `addExpression` auto-inserts formula buffer
- Verify auto-inserted formula has correct `argumentId`, `argumentVersion`, `premiseId`
- Verify expression ends up parented under the formula, not the original operator
- Auto-normalize during `loadInitialExpressions` via `fromSnapshot` with auto-normalize config
- `insertExpression` still throws even with `autoNormalize: true`
- `wrapExpression` still throws even with `autoNormalize: true`
- `removeExpression` still throws even with `autoNormalize: true`

### Restoration paths

- `fromSnapshot` with `{ enforceFormulaBetweenOperators: true }` rejects operator-under-operator
- `fromSnapshot` with `{ enforceFormulaBetweenOperators: true, autoNormalize: true }` auto-normalizes legacy tree
- `fromSnapshot` with no grammar config uses default (enforces, throws)
- `fromData` with no grammar config uses permissive default (no enforcement)
- `fromData` with `{ enforceFormulaBetweenOperators: true }` enforces during loading
- `rollback` to a snapshot with operator-under-operator succeeds (permissive during loading)
- Existing restoration bypass tests updated to pass grammar config instead of relying on `loadExpressions` bypass

## Migration

- `skipNestingCheck` private flag removed from `ExpressionManager`
- `loadInitialExpressions` no longer toggles a flag — relies on grammar config
- Existing tests that use `ExpressionManager.fromSnapshot` to load legacy trees need a permissive grammar config parameter (default now enforces)
- The existing `loadExpressions` method on `ExpressionManager` and `PremiseEngine` is preserved but updated to respect grammar config
- `fromData` default behavior preserved (permissive loading) — explicit opt-in for enforcement
