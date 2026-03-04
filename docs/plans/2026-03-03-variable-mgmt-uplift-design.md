# Variable Management Uplift + Checksum Config Cleanup

**Date:** 2026-03-03

## Summary

Move variable CRUD from `PremiseManager` to `ArgumentEngine` via a shared `VariableManager` instance. Deleting a variable cascades to all expressions that reference it across all premises. Additionally, consolidate checksum defaults into a single exported constant with `Set<string>` fields and a convenience merge function.

## Part 1: Shared VariableManager

### Current state

- Each `PremiseManager` constructs its own `VariableManager`
- `addVariable()` and `removeVariable()` live on `PremiseManager`
- `removeVariable()` throws if any expression references the variable
- The CLI hydration code manually registers every argument-level variable with every premise
- Variables are conceptually argument-scoped (stored once per argument version on disk) but mutated at the premise level

### New design

**ArgumentEngine** owns a single `VariableManager` instance, passed by reference to every `PremiseManager` it creates.

#### ArgumentEngine gains three public methods

- `addVariable(variable: TCorePropositionalVariable): TCoreMutationResult<TCorePropositionalVariable>` — registers a variable in the shared `VariableManager`. Validates argument membership, unique ID, and unique symbol.
- `updateVariable(variableId: string, updates: { symbol?: string }): TCoreMutationResult<TCorePropositionalVariable | undefined>` — updates fields on an existing variable. Since the `VariableManager` is shared, all premises see the change immediately.
- `removeVariable(variableId: string): TCoreMutationResult<TCorePropositionalVariable | undefined>` — for each premise, calls `deleteExpressionsUsingVariable(variableId)`, then removes the variable from the shared `VariableManager`. The changeset aggregates all removed expressions across all premises.

#### PremiseManager changes

- Constructor accepts a `VariableManager` reference instead of creating its own.
- Drops public `addVariable()` and `removeVariable()` methods.
- Keeps `getVariables()` as read-only.
- Gains `deleteExpressionsUsingVariable(variableId: string): TCoreMutationResult<TCorePropositionalExpression[]>` — finds all variable expressions referencing the given variable ID (via `expressionsByVariableId`), calls `removeExpression()` on each (which handles subtree deletion and operator collapse), returns all removed expressions in the changeset.

#### VariableManager changes

- Gains `updateVariable(variableId: string, updates: { symbol?: string }): TCorePropositionalVariable | undefined` — validates symbol uniqueness, applies updates, returns the updated variable or `undefined` if not found.

### Cascade deletion behavior

When `ArgumentEngine.removeVariable(variableId)` is called:

1. For each premise in the engine, call `premise.deleteExpressionsUsingVariable(variableId)`.
2. Each call finds variable expressions referencing that variable ID via the `expressionsByVariableId` map.
3. For each such expression, `removeExpression()` is called, which:
    - Deletes the expression and its entire subtree
    - Runs `collapseIfNeeded()` on the parent (operator collapse)
    - Cleans up `expressionsByVariableId` entries for all removed expressions
4. After all premises are cleaned, the variable is removed from the shared `VariableManager`.
5. The combined changeset includes all removed expressions and variables.

### Test impact

- Existing tests that call `premise.addVariable()` and `premise.removeVariable()` must be updated to use `engine.addVariable()` and `engine.removeVariable()`.
- New tests for cascade deletion, `deleteExpressionsUsingVariable`, `updateVariable`, and shared `VariableManager` behavior.

## Part 2: Checksum Config Cleanup

### Current state

- `DEFAULT_EXPRESSION_FIELDS` and `DEFAULT_VARIABLE_FIELDS` are private constants in `PremiseManager.ts`
- `DEFAULT_PREMISE_FIELDS`, `DEFAULT_ARGUMENT_FIELDS`, and `DEFAULT_ROLE_FIELDS` are inline literal arrays at each usage site
- `TCoreChecksumConfig` fields are `string[]`
- Users cannot access defaults to extend them

### New design

#### New file: `src/lib/consts.ts`

Contains:

- `DEFAULT_CHECKSUM_CONFIG: Readonly<TCoreChecksumConfig>` — single source of truth for all default field sets.
- `createChecksumConfig(additional: TCoreChecksumConfig): TCoreChecksumConfig` — merges each field set from `DEFAULT_CHECKSUM_CONFIG` with the corresponding set from `additional`. Omitted fields in `additional` inherit defaults.

#### TCoreChecksumConfig fields become `Set<string>`

Change from `string[]` to `Set<string>` to prevent duplicate fields:

```typescript
export interface TCoreChecksumConfig {
    expressionFields?: Set<string>
    variableFields?: Set<string>
    premiseFields?: Set<string>
    argumentFields?: Set<string>
    roleFields?: Set<string>
}
```

#### Ripple effects

- `entityChecksum()` in `core/checksum.ts` accepts `Set<string>` instead of `string[]`.
- Remove private `DEFAULT_*_FIELDS` constants from `PremiseManager.ts`.
- Remove inline default arrays from `PremiseManager.ts` and `ArgumentEngine.ts` — use `DEFAULT_CHECKSUM_CONFIG` references.
- Export `DEFAULT_CHECKSUM_CONFIG` and `createChecksumConfig` from `src/index.ts` and `src/lib/index.ts`.

## Part 3: CLI Updates

### Variable commands (`src/cli/commands/variables.ts`)

- `create` — call `engine.addVariable()` instead of iterating over premises.
- `update` — call `engine.updateVariable()` instead of per-premise logic.
- `delete` — call `engine.removeVariable()` (cascade happens automatically).
- `delete-unused` — same approach but via `engine.removeVariable()` for each unused variable.
- Read-only commands (`list`, `show`, `list-unused`) may simplify since variables are engine-owned.

### Engine hydration (`src/cli/engine.ts`)

- `hydrateEngine()` calls `engine.addVariable()` for each variable (once, not per-premise).
- Remove the per-premise variable registration loop.

### Engine persistence (`src/cli/engine.ts`)

- `persistEngine()` reads variables from the engine directly (e.g. via any premise's `getVariables()` — since they all share the same `VariableManager`, any premise returns the same list).

## Part 4: Documentation Updates

### `CLAUDE.md`

- Update class hierarchy to show `VariableManager` owned by `ArgumentEngine` and shared with `PremiseManager`s.
- Update Architecture section for new `src/lib/consts.ts` file.
- Update key design decisions: variable management at argument level, cascade deletion, checksum config as `Set<string>`.
- Update Types section for `TCoreChecksumConfig` change.
- Add new exports to relevant sections.

### `README.md`

- Update "Variables" concept section: variables are registered with `ArgumentEngine`, not `PremiseManager`.
- Update usage examples: `engine.addVariable()` instead of `premise.addVariable()`.
- Move `addVariable`/`removeVariable`/`updateVariable` from `PremiseManager` API reference to `ArgumentEngine`.
- Add `deleteExpressionsUsingVariable` to `PremiseManager` API reference.
- Document cascade deletion behavior.
- Document `DEFAULT_CHECKSUM_CONFIG` and `createChecksumConfig`.

### `CLI_EXAMPLES.md`

- Variable commands remain argument-scoped (no change to CLI syntax).
- Fix stale references to `roles add-support` and `roles remove-support` (these were removed in the API redesign — supporting premises are derived automatically).
- Update the complete script at the bottom to remove `roles add-support` lines.
