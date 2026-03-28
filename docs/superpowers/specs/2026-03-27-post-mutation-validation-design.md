# Post-Mutation Invariant Validation

**Date:** 2026-03-27
**Status:** Design

## Problem

Validation and normalization rules are enforced inconsistently across the three categories of mutation entry points:

1. **Atomic operations** (`addExpression`, `addVariable`, `createPremise`, etc.) — full validation via the delegation chain
2. **Combination operations** (`insertExpression`, `wrapExpression`, `toggleNegation`, etc.) — full validation but `autoNormalize` not supported in `insertExpression`/`wrapExpression`
3. **Bulk loading** (`fromSnapshot`, `fromData`, `rollback`, `loadExpressions`) — most or all validation skipped

This means an engine can hold data that violates its own grammar config and structural invariants, depending on how the data entered.

### Gap Matrix (Current State)

| Rule                                 | Atomic                     | Combination                            | Bulk    |
| ------------------------------------ | -------------------------- | -------------------------------------- | ------- |
| Root-only (`implies`/`iff`)          | Enforced                   | Enforced                               | Skipped |
| Formula-between-operators            | Enforced (+ autoNormalize) | Enforced (autoNormalize NOT supported) | Skipped |
| Child limits (`not`/`formula` max 1) | Enforced                   | Enforced                               | Skipped |
| Position uniqueness                  | Enforced                   | Enforced                               | Skipped |
| Variable reference existence         | Enforced                   | Enforced                               | Skipped |
| Circularity prevention               | Enforced                   | Enforced                               | Skipped |
| Claim library reference              | Enforced                   | N/A                                    | Skipped |
| Argument ownership                   | Enforced                   | Enforced                               | Skipped |

## Design Principles

1. **Grammar config is law.** Whatever `TGrammarConfig` says is enforced uniformly across all entry points. If it says reject, reject. If it says auto-normalize, auto-normalize.
2. **An engine never holds invalid data.** If the engine is configured with a rule, no data managed by that engine can violate it, regardless of how the data entered.
3. **Combination operations are atomic.** If a multi-step operation partially fails, the entire operation rolls back.
4. **Full sweep after every mutation.** Every mutation ends with a comprehensive validation of the entire argument. Simplicity over optimization.
5. **Hierarchical validation.** Each engine/library validates itself and delegates to children.
6. **Typebox schema checks as baseline.** Every managed object passes `Value.Check` against its schema.
7. **Checksum verification.** Freshly computed checksums must match stored values on every entity.

## Architecture

### Validation Result Type

New file: `src/lib/types/validation.ts`

```typescript
type TInvariantViolation = {
    code: string
    message: string
    entityType:
        | "expression"
        | "variable"
        | "premise"
        | "argument"
        | "claim"
        | "source"
        | "association"
    entityId: string
    premiseId?: string
}

type TInvariantValidationResult = {
    ok: boolean
    violations: TInvariantViolation[]
}
```

New file: `src/lib/core/invariant-violation-error.ts`

```typescript
class InvariantViolationError extends Error {
  public readonly violations: TInvariantViolation[]
  constructor(violations: TInvariantViolation[]) { ... }
}
```

Both types and the error class are exported from the library barrel.

### Validation Hierarchy

Each class gets a public, parameterless `validate(): TInvariantValidationResult` method. Grammar config and dependencies (variable IDs, library lookups) come from instance state set at construction time.

#### ExpressionManager.validate()

Uses `this.grammarConfig` (already stored via constructor).

1. **Schema:** every expression passes `Value.Check(CorePropositionalExpressionSchema, expr)`
2. **No duplicate expression IDs**
3. **No self-referential parents:** `parentId !== id`
4. **Parent existence:** all `parentId` references point to existing expressions
5. **Parent is container:** every non-root expression's parent is an operator or formula
6. **Root-only:** `implies`/`iff` expressions have `parentId === null`
7. **Formula-between-operators:** if `grammarConfig.enforceFormulaBetweenOperators`, no non-`not` operator is a direct child of another operator
8. **Child limits:** `not` and `formula` have at most 1 child
9. **Position uniqueness:** no two siblings share the same position under the same parent
10. **Checksums:** flush and verify `checksum`, `descendantChecksum`, `combinedChecksum` on every expression

#### PremiseEngine.validate()

Uses `this.grammarConfig` (already stored via constructor). Gets variable IDs via a callback from ArgumentEngine (same pattern as the existing `circularityCheck` callback).

1. **Schema:** premise passes `Value.Check(CorePremiseSchema, premise)`
2. **Delegates to** `ExpressionManager.validate()`
3. **Root expression consistency:** `rootExpressionId` is either `undefined` (no expressions) or points to an existing expression with `parentId === null`
4. **Variable references:** every variable expression references a `variableId` that exists in the set provided by the callback
5. **Checksums:** premise-level checksum fields match freshly computed values

#### VariableManager.validate()

No external dependencies.

1. **Schema:** every variable passes `Value.Check(CorePropositionalVariableSchema, variable)`
2. **No duplicate variable IDs**
3. **No duplicate symbols**
4. **Checksums:** variable checksums match freshly computed values

#### ArgumentEngine.validate()

Uses `this.grammarConfig`. Has direct access to all children.

1. **Schema:** argument passes `Value.Check(CoreArgumentSchema, argument)`
2. **Delegates to** `VariableManager.validate()`
3. **Delegates to** each `PremiseEngine.validate()`
4. **Argument ownership:** all variables, premises, and expressions have matching `argumentId` and `argumentVersion`
5. **Claim-bound variables:** referenced claim exists in claim library (by ID and version)
6. **Premise-bound internal variables:** referenced premise exists in this argument
7. **Circularity:** no premise-bound variable creates a circular reference chain
8. **Conclusion premise:** if set, references an existing premise
9. **Checksums:** argument-level checksum fields match freshly computed values

#### ClaimLibrary.validate()

1. **Schema:** every claim passes `Value.Check(CoreClaimSchema, claim)`
2. **No duplicate IDs within the same version**
3. **Frozen claims have a successor version** (except the latest)

#### SourceLibrary.validate()

Same pattern as ClaimLibrary with `CoreSourceSchema`.

#### ClaimSourceLibrary.validate()

Uses stored claim and source lookups (already held via constructor).

1. **Schema:** every association passes `Value.Check(CoreClaimSourceAssociationSchema, assoc)`
2. **No duplicate association IDs**
3. **Claim references:** all point to existing claims (by ID and version)
4. **Source references:** all point to existing sources (by ID and version)

### Mutation Safety Bracket

Every public mutation method wraps its logic in a snapshot-mutate-validate-rollback bracket.

#### ArgumentEngine.withValidation

`protected withValidation<T>(fn: () => T): T`

1. Takes a full argument snapshot via `this.snapshot()`
2. Executes `fn()`
3. Calls `this.validate()`
4. If validation fails: `this.rollback(snap)`, throw `InvariantViolationError`
5. If `fn()` throws (existing per-operation validation): `this.rollback(snap)`, re-throw original error

All ArgumentEngine mutations (`createPremise`, `addVariable`, `removeVariable`, `removePremise`, `setConclusionPremise`, `clearConclusionPremise`, `updateVariable`, `bindVariableToPremise`, `bindVariableToExternalPremise`, `bindVariableToArgument`) wrap their logic in `this.withValidation(() => { ... })`.

Existing per-operation validation (e.g., "claim doesn't exist") stays. It provides early, specific error messages. The post-mutation `validate()` sweep is a safety net.

#### PremiseEngine.withValidation

`protected withValidation<T>(fn: () => T): T`

PremiseEngine mutations are called directly by users (via `engine.getPremise(id).addExpression(...)`). ArgumentEngine registers a validation callback on each PremiseEngine at creation time:

```
pm.setArgumentValidateCallback(() => this.validate())
```

PremiseEngine's bracket:

1. Takes a premise-level snapshot (premise state + expression index entries this premise owns)
2. Executes `fn()`
3. Calls `this.argumentValidateCallback()` which runs `ArgumentEngine.validate()` (which includes this premise's validation via delegation)
4. If validation fails: restores premise-level snapshot, throw `InvariantViolationError`
5. If `fn()` throws: restores premise-level snapshot, re-throw

If no `argumentValidateCallback` is set (standalone PremiseEngine without an ArgumentEngine), falls back to `this.validate()` alone.

All PremiseEngine mutations (`addExpression`, `appendExpression`, `addExpressionRelative`, `removeExpression`, `updateExpression`, `insertExpression`, `wrapExpression`, `toggleNegation`, `changeOperator`, `deleteExpressionsUsingVariable`, `setExtras`) wrap their logic in `this.withValidation(() => { ... })`.

#### Library withValidation

ClaimLibrary, SourceLibrary, and ClaimSourceLibrary each get their own `protected withValidation<T>(fn: () => T): T` that snapshots own state, mutates, validates, and rolls back if invalid. Same pattern, simpler scope.

### Bulk Path Changes

#### fromSnapshot(snapshot, ..., grammarConfig?)

1. Load all state from snapshot (as today)
2. Call `this.validate()` using the grammar config provided (or from snapshot config)
3. If validation fails, throw `InvariantViolationError` (no rollback needed; engine was just constructed)

#### fromData(argument, ..., grammarConfig?)

1. Change default from `PERMISSIVE_GRAMMAR_CONFIG` to the **provided** `grammarConfig` (or `DEFAULT_GRAMMAR_CONFIG` if omitted)
2. Load data as today
3. Call `this.validate()`
4. If validation fails, throw `InvariantViolationError`

#### rollback(snapshot)

1. Take a pre-rollback snapshot of current state
2. Restore state from the provided snapshot (as today)
3. Call `this.validate()`
4. If validation fails: restore the pre-rollback snapshot (reject the rollback), throw `InvariantViolationError`

### autoNormalize Gap Closure

These methods currently throw on formula-between-operators violations even when `autoNormalize` is true. They need to auto-insert formula buffers instead:

#### ExpressionManager.insertExpression

When `enforceFormulaBetweenOperators` and `autoNormalize` are both true, and reparenting a child under the new operator would create a non-`not` operator as direct child of operator: auto-insert a formula buffer between the new operator and that child.

#### ExpressionManager.wrapExpression

Same behavior: when the existing node or new sibling is a non-`not` operator becoming a direct child of the new wrapper operator, auto-insert formula buffers.

#### ExpressionManager.loadExpressions

Respect the grammar config during BFS loading. If `autoNormalize` is true, auto-insert formula buffers. If `enforceFormulaBetweenOperators` is true and `autoNormalize` is false, reject violations.

### Cross-Engine Validation

Library mutations (e.g., removing a claim) do not automatically trigger ArgumentEngine validation. If a claim referenced by a variable is removed from ClaimLibrary, ArgumentEngine will not notice until its next mutation triggers `validate()`. This is acceptable — each engine validates on its own mutations.

## Modified Files

### New Files

- `src/lib/types/validation.ts` — `TInvariantViolation`, `TInvariantValidationResult`, violation code constants
- `src/lib/core/invariant-violation-error.ts` — `InvariantViolationError` class

### Modified Files

- `src/lib/core/expression-manager.ts` — add `validate()`, update `insertExpression`/`wrapExpression`/`loadExpressions` for autoNormalize
- `src/lib/core/variable-manager.ts` — add `validate()`
- `src/lib/core/premise-engine.ts` — add `validate()`, add `withValidation` bracket, add `argumentValidateCallback` wiring, wrap all mutation methods
- `src/lib/core/argument-engine.ts` — add `validate()`, add `withValidation` bracket, wire callbacks onto PremiseEngines, update `fromSnapshot`/`fromData`/`rollback`, wrap all mutation methods
- `src/lib/core/claim-library.ts` — add `validate()`, add `withValidation` bracket, wrap mutation methods
- `src/lib/core/source-library.ts` — same
- `src/lib/core/claim-source-library.ts` — add `validate()`, add `withValidation` bracket, wrap mutation methods
- `src/lib/core/interfaces/argument-engine.interfaces.ts` — add `validate()` to `TArgumentLifecycle`
- `src/lib/core/interfaces/premise-engine.interfaces.ts` — add `validate()` to premise engine interface
- `src/lib/core/interfaces/library.interfaces.ts` — add `validate()` to library interfaces
- `src/lib/types/index.ts` — export new validation types
- `src/lib/index.ts` / `src/index.ts` — export `InvariantViolationError` and validation types

## Testing Strategy

Each `validate()` method needs tests for every violation code it can produce. Tests should verify:

1. **Positive:** valid state returns `{ ok: true, violations: [] }`
2. **Negative:** each invariant violation is detected with the correct code
3. **Bracket:** mutations that would produce invalid state are rolled back and throw `InvariantViolationError`
4. **Bulk paths:** `fromSnapshot`, `fromData`, `rollback` reject invalid data under strict grammar configs
5. **autoNormalize:** `insertExpression`, `wrapExpression`, `loadExpressions` auto-insert formula buffers when configured
6. **Checksum verification:** checksum mismatches are detected
7. **Schema checks:** malformed objects are caught by `Value.Check`
