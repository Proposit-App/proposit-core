# Design: Extras Mutations Produce Changesets

**Date:** 2026-04-11
**Type:** Feature / bug fix
**Severity:** High (blocks server-side persistence unification)
**Affected version:** 0.8.x+
**Components:** `PremiseEngine`, `ArgumentEngine`, `ChangeCollector`, CLI
`premises update`

## Problem

`PremiseEngine.setExtras(extras)` updates the premise's mutable fields and marks
it dirty, but returns an empty changeset (`changes: {}`). This prevents consumers
from routing premise field updates through the standard `persistChangeset`
pipeline.

The server has two persistence patterns:

1. **Engine-driven:** mutation -> changeset -> `persistChangeset` -> DB
2. **DB-primary:** direct Knex update -> manual checksum recomputation ->
   cache invalidation

Premise title updates use pattern 2 because `setExtras` doesn't produce a
changeset. This has caused checksum bugs: manual recomputation diverges from
engine computation, logic is duplicated between server and client, and no shared
mutation function exists for premise title updates.

`ArgumentEngine` has no extras mutation methods at all. Arguments and premises are
both checksummed entities at different levels of the logic hierarchy with mutable
extra data. They should be treated symmetrically.

## Solution

Three coordinated changes:

1. Add `modifiedPremise()` to `ChangeCollector`
2. Fix `PremiseEngine.setExtras` and add `PremiseEngine.updateExtras`
3. Add `ArgumentEngine.getExtras`, `setExtras`, `updateExtras`

Plus a CLI refactor to route `premises update` through the engine.

## 1. ChangeCollector: add `modifiedPremise()`

**File:** `src/lib/core/change-collector.ts`

`ChangeCollector` has `addedPremise()` and `removedPremise()` but no
`modifiedPremise()`. Premise modifications currently enter the changeset through a
manual checksum-comparison check in `flushAndBuildChangeset`. Adding the method
makes the collector the canonical place for all entity change recording:

```ts
modifiedPremise(premise: TPremise): void {
    this.premises.modified.push(premise)
}
```

No other collector changes needed. `setArgument()` already handles argument
modifications since `TCoreChangeset.argument` is a single `TArg` slot (not an
entity-changes triple).

## 2. PremiseEngine: fix `setExtras`, add `updateExtras`

**File:** `src/lib/core/premise-engine.ts`

### `setExtras` (fix)

Current behavior: mutates premise, marks dirty, returns `{ result, changes: {} }`.

New behavior: same mutation, but creates a `ChangeCollector`, flushes checksums,
records the premise via `collector.modifiedPremise(this.toPremiseData())`, and
returns the collector's changeset. Pattern:

1. Mutate `this.premise` (full replace of non-structural fields, same as today)
2. `this.markDirty()`
3. Create `ChangeCollector`, call `this.flushChecksums()`, record
   `this.toPremiseData()` via `collector.modifiedPremise()`
4. `this.onMutate?.()`
5. Return `{ result: this.getExtras(), changes: collector.toChangeset() }`

Return type unchanged: `TCoreMutationResult<Record<string, unknown>, ...>`.

### `updateExtras` (new)

Partial merge variant. Shallow-merges `updates` into the existing extras rather
than replacing them. Same changeset flow as `setExtras`.

```ts
updateExtras(
    updates: Record<string, unknown>
): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
```

Implementation: read current extras via `getExtras()`, spread `updates` over
them, then follow the same mutate-flush-collect-return pattern as `setExtras`.

### Interface updates

**File:** `src/lib/core/interfaces/premise-engine.interfaces.ts`

- Fix `setExtras` JSDoc (currently says "returns the previous extras" — it
  returns the new extras)
- Add `updateExtras` with JSDoc

## 3. ArgumentEngine: add `getExtras`, `setExtras`, `updateExtras`

**File:** `src/lib/core/argument-engine.ts`

Arguments and premises are both checksummed entities with mutable extra data.
`ArgumentEngine` currently has `getArgument()` but no extras-specific mutation
methods.

### `getExtras()`

Strip structural fields (`id`, `version`, `checksum`, `descendantChecksum`,
`combinedChecksum`) from `this.argument`, return the rest. Same approach as
`PremiseEngine.getExtras`.

```ts
getExtras(): Record<string, unknown>
```

### `setExtras(extras)`

Full replace of non-structural fields. Creates a `ChangeCollector`, marks dirty,
flushes checksums, records the argument via
`collector.setArgument(this.getArgument())`, returns the changeset.

```ts
setExtras(
    extras: Record<string, unknown>
): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
```

Note: `ArgumentEngine` has no `withValidation` wrapper or `onMutate` callback, so
these methods are simpler than their `PremiseEngine` counterparts.

### `updateExtras(updates)`

Shallow merge into existing extras, same changeset flow.

```ts
updateExtras(
    updates: Record<string, unknown>
): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
```

### Interface updates

**File:** `src/lib/core/interfaces/argument-engine.interfaces.ts`

Add `getExtras`, `setExtras`, `updateExtras` with JSDoc.

## 4. CLI: refactor `premises update`

**File:** `src/cli/commands/premises.ts`

The `premises update` command (line 201-233) currently bypasses the engine: it
reads the premise meta file, mutates it in-place, and writes it back. With
`updateExtras` available, this should go through the engine:

```
hydrate engine -> find premise -> pm.updateExtras({ title }) -> persistEngine
```

This matches how other mutating commands (`premises delete`, `premises create`)
already work. The `readPremiseMeta`/`writePremiseMeta` calls are replaced with
engine hydration and persistence.

No new CLI commands for argument extras (out of scope — can be added later using
the new `ArgumentEngine` methods).

## 5. Tests

**File:** `test/core.test.ts` — new `describe` blocks at the bottom.

### PremiseEngine.setExtras changeset tests

1. `setExtras` changeset contains `premises.modified` with one entry whose extras
   match and checksums are correct
2. After `setExtras`, `toPremiseData().checksum` matches the premise in the
   changeset
3. Two consecutive `setExtras` calls produce two separate correct changesets
4. `setExtras` changeset contains no expressions or variables

### PremiseEngine.updateExtras tests

5. `updateExtras` merges into existing extras (existing keys preserved)
6. `updateExtras` produces a changeset with `premises.modified`
7. `updateExtras` with overlapping keys overwrites existing values

### ArgumentEngine extras tests

8. `getExtras` returns non-structural fields
9. `setExtras` replaces all extras and produces changeset with `argument` field
10. `updateExtras` merges and produces changeset with `argument` field
11. Structural fields (`id`, `version`) cannot be shadowed by extras

### Existing test update

12. Update `core.test.ts:5273` — "setExtras returns new extras with empty
    changes" — changeset is no longer empty; assert `premises.modified` instead

## Non-goals

- Adding an `arguments update` CLI command (future work)
- Changing `flushAndBuildChangeset` to use `collector.modifiedPremise()` instead
  of its manual checksum comparison (existing expression-mutation path works; can
  be unified later)
- Changeset-based persistence in the CLI (CLI uses full-snapshot
  `persistEngine`)
