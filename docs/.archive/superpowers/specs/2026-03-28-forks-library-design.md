# ForksLibrary Design

**Date:** 2026-03-28
**Scope:** External ForksLibrary class, standalone fork function, entity-level `forkId`, engine `canFork()` visibility change

## Motivation

proposit-core 0.7.0 introduced engine-level argument forking via `forkArgument()`. Forked entities carry `forkedFrom` metadata directly on each entity, and `createForkedFromMatcher()` enables fork-aware diffing.

Entity-level `forkedFrom` is sufficient for diffing but creates an architectural inconsistency. The core manages relational data through libraries (ClaimLibrary, SourceLibrary, ClaimSourceLibrary), but fork operations have no library representation. This means:

1. No single source of truth for the fork operation itself (source argument, timestamp, creator).
2. No way to query "all entities from fork X" without scanning every entity.
3. Fork metadata doesn't travel with a library snapshot — applications must manage it separately.
4. Inconsistency with the library pattern used for claims and sources.

proposit-server currently tracks forks via a separate `argumentForks` table. Adding a ForksLibrary to the core lets the server mirror fork records the same way it mirrors claims and sources.

## Design

### 1. `TCoreFork` Schema

New schema in `src/lib/schemata/fork.ts`:

```typescript
type TCoreFork = {
    id: string // UUID
    sourceArgumentId: string // argument that was forked
    sourceArgumentVersion: number // version at fork time
    createdOn: string // ISO 8601 timestamp
    creatorId?: string // optional, application-provided
    checksum?: string // computed by library
}
```

Typebox schema: `CoreForkSchema`. Exported from `src/lib/schemata/index.ts`.

### 2. Entity-Level `forkId` Field

Add `forkId: Type.Optional(Nullable(UUID))` to:

- `BasePropositionalExpressionSchema` (expressions)
- `CoreVariableBaseFields` (shared by claim-bound and premise-bound variables)
- `CorePremiseSchema` (premises)
- `CoreArgumentSchema` (arguments)

The field is opaque to the engine — carried but not validated against any fork lookup. Follows the same `Optional(Nullable(...))` pattern as existing `forkedFrom` fields.

### 3. ForksLibrary Class

External standalone class in `src/lib/core/forks-library.ts`. Follows the ClaimSourceLibrary pattern: create/delete only, no versioning, no freeze semantics. Fork records are immutable after creation.

**Generic:** `ForksLibrary<TFork extends TCoreFork = TCoreFork>`

**Constructor:**

```typescript
constructor(options?: { checksumConfig?: TCoreChecksumConfig })
```

**API:**

| Method                                                        | Description                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `create(fork: TFork): void`                                   | Validates and stores. Throws if ID already exists. Computes checksum.                 |
| `get(id: string): TFork \| undefined`                         | Returns fork record by ID.                                                            |
| `getAll(): TFork[]`                                           | Returns all fork records.                                                             |
| `remove(id: string): void`                                    | Removes fork record. Throws if ID not found. Does not cascade-delete forked entities. |
| `snapshot(): TForksLibrarySnapshot<TFork>`                    | Returns `{ forks: TFork[] }`.                                                         |
| `static fromSnapshot<T>(snapshot, options?): ForksLibrary<T>` | Reconstructs library from snapshot.                                                   |

**Snapshot type:**

```typescript
type TForksLibrarySnapshot<TFork extends TCoreFork = TCoreFork> = {
    forks: TFork[]
}
```

**Lookup interface:**

```typescript
interface TForkLookup<TFork extends TCoreFork = TCoreFork> {
    get(id: string): TFork | undefined
    getAll(): TFork[]
}
```

ForksLibrary implements `TForkLookup`. The lookup interface is available for read-only consumers that don't need mutation access.

### 4. Standalone Fork Function

Extract the current `ArgumentEngine.forkArgument()` remap/reconstruct logic into a standalone function in `src/lib/core/fork.ts`:

```typescript
function forkArgumentEngine<
    TArg,
    TPremise,
    TExpr,
    TVar,
    TSource,
    TClaim,
    TAssoc,
>(
    engine: ArgumentEngine<
        TArg,
        TPremise,
        TExpr,
        TVar,
        TSource,
        TClaim,
        TAssoc
    >,
    newArgumentId: string,
    libraries: {
        claimLibrary: TClaimLookup<TClaim>
        sourceLibrary: TSourceLookup<TSource>
        claimSourceLibrary: TClaimSourceLookup<TAssoc>
    },
    options?: TForkArgumentOptions
): {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    remapTable: TForkRemapTable
}
```

This is a pure extraction — same snapshot/remap/reconstruct logic, same `forkedFrom` assignment. Does not create fork records or set `forkId`. Does not call `canFork()`.

The existing `TForkArgumentOptions` and `TForkRemapTable` types move or are re-exported from the new location.

### 5. ForksLibrary.forkArgument()

The primary public API for forking. Orchestrates the fork record creation and delegates engine forking to the standalone function.

```typescript
forkArgument<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>,
    newArgumentId: string,
    libraries: {
        claimLibrary: TClaimLookup<TClaim>
        sourceLibrary: TSourceLookup<TSource>
        claimSourceLibrary: TClaimSourceLookup<TAssoc>
    },
    options?: TForkArgumentOptions & {
        forkId?: string       // caller-provided; auto-generated if omitted
        creatorId?: string    // optional, stored on the fork record
    }
): { engine: ArgumentEngine<...>; remapTable: TForkRemapTable; fork: TFork }
```

**Steps:**

1. Calls `engine.canFork()` — throws if `false`.
2. Calls `forkArgumentEngine()` to create the forked engine and remap table.
3. Creates a `TCoreFork` record: `{ id, sourceArgumentId, sourceArgumentVersion, createdOn: new Date().toISOString(), creatorId }`.
4. Sets `forkId` on all entities in the forked engine (argument, premises, expressions, variables).
5. Registers the fork record via `this.create(fork)`.
6. Returns `{ engine, remapTable, fork }`.

Setting `forkId` on forked entities requires mutating the engine's internal state after construction. This can be done by snapshotting the newly forked engine, injecting `forkId` into each entity, and restoring — or by exposing a targeted internal method. The implementation plan will determine the cleanest approach.

### 6. ArgumentEngine Changes

**`canFork()`:** Changed from `protected` to `public`. No other signature change. Subclass override continues to work.

**`forkArgument()`:** Removed from ArgumentEngine. This is a breaking API change.

**No new generic parameter.** The engine does not hold a fork lookup reference.

**No constructor change.** ForksLibrary is fully decoupled from the engine.

### 7. Diff

No changes. `createForkedFromMatcher()` continues using entity-level `forkedFrom` fields. The ForksLibrary is organizational, not a diffing concern.

### 8. Changeset

No forks section added to `TCoreChangeset`. Fork records are managed by the ForksLibrary, not the engine. The `forkId` field on entities will appear naturally in entity-level changesets when entities are mutated.

## Exports

All new types, schemas, functions, and the class are exported from `src/lib/index.ts`:

- `CoreForkSchema`, `TCoreFork`
- `ForksLibrary`
- `TForksLibrarySnapshot`, `TForkLookup`
- `forkArgumentEngine`

## Documentation Requirements

1. **JSDoc** on all exported functions, types, and class methods.
2. **`src/lib/core/interfaces/`**: Add `TForkLookup` to `library.interfaces.ts` with JSDoc.
3. **CLAUDE.md**: No new design rules needed — ForksLibrary follows established library patterns.
4. **docs/api-reference.md**: Add ForksLibrary section.
5. **README.md**: Update forking section to reflect new API.
6. **Release notes and changelog**: Update `docs/release-notes/upcoming.md` and `docs/changelogs/upcoming.md`.

## Testing

1. ForksLibrary `create()`: stores fork record, computes checksum, throws on duplicate ID.
2. ForksLibrary `get()` / `getAll()`: retrieval semantics.
3. ForksLibrary `remove()`: deletes record, throws on missing ID, does not cascade.
4. ForksLibrary `snapshot()` / `fromSnapshot()`: round-trip preserves all records.
5. `forkArgumentEngine()`: extracted logic produces identical results to the old `ArgumentEngine.forkArgument()` — same remap table, same `forkedFrom` fields, same engine state.
6. `ForksLibrary.forkArgument()`: creates fork record, sets `forkId` on all forked entities, calls `canFork()`, returns correct result shape.
7. `canFork()` returning `false`: `ForksLibrary.forkArgument()` throws.
8. `createForkedFromMatcher()` regression: continues to work with entity-level `forkedFrom` fields.
9. `forkId` appears in entity changesets when forked entities are subsequently mutated.
10. Engine `validate()` does not flag forked entities or `forkId` as invalid.
