# Global Libraries Design — Claims and Sources

**Date:** 2026-03-13
**Status:** Draft

## Overview

Introduce global, inter-argument entities — **Claims** and **Sources** — managed by dedicated library classes. Claims represent the propositional content that variables refer to. Sources provide evidentiary support. Both are reusable across arguments and have their own versioning system independent of argument versions.

## Motivation

Today, sources are argument-scoped (carry `argumentId`/`argumentVersion`) and variables have no formal connection to the propositional content they represent. This limits reuse: the same source or propositional claim used across multiple arguments must be duplicated. Global libraries solve this by making claims and sources first-class, independently versioned entities that arguments reference rather than own.

## Key Decisions

1. **Claims are minimal and extensible.** `CoreClaimSchema` has only identity fields (`id`, `version`, `frozen`, `checksum`) with `additionalProperties: true`. Content schema is left to extensions.
2. **Sources are no longer argument-scoped.** `CoreSourceSchema` drops `argumentId`/`argumentVersion`, gains `version`/`frozen`.
3. **Variables require claim references.** `claimId` and `claimVersion` are required (non-nullable) fields on `CorePropositionalVariableSchema`.
4. **Variables pin to a specific claim version.** The engine validates that the referenced claim exists in the library but does not enforce that it is frozen.
5. **Libraries are required by ArgumentEngine.** Passed as positional constructor parameters.
6. **Engine depends on narrow lookup interfaces.** `TClaimLookup` and `TSourceLookup` — not the full library classes.
7. **No deletion from libraries.** Claims and sources are permanent once created.
8. **Versioning with freeze semantics.** Entities start at version 0 (mutable). `freeze()` locks the current version and auto-creates the next version as a mutable copy. Only the latest version can be updated.
9. **Source associations gain `sourceVersion`.** Associations pin to a specific source version.
10. **SourceManager simplified to association-only.** No longer stores source entities; renamed considerations.

## Entity Schemas

### CoreClaimSchema (new)

```typescript
CoreClaimSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number(),
        frozen: Type.Boolean(),
        checksum: Type.String(),
    },
    { additionalProperties: true }
)
```

### CoreSourceSchema (updated)

```typescript
// Before: { id, argumentId, argumentVersion, checksum }
// After:
CoreSourceSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number(),
        frozen: Type.Boolean(),
        checksum: Type.String(),
    },
    { additionalProperties: true }
)
```

### CorePropositionalVariableSchema (updated)

```typescript
CorePropositionalVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String(),
        claimId: UUID, // new, required
        claimVersion: Type.Number(), // new, required
        checksum: Type.String(),
    },
    { additionalProperties: true }
)
```

### Association Schemas (updated)

Both gain `sourceVersion`:

```typescript
CoreVariableSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    sourceVersion: Type.Number(), // new
    variableId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String(),
})

CoreExpressionSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    sourceVersion: Type.Number(), // new
    expressionId: UUID,
    premiseId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String(),
})
```

## Library Interfaces

### Lookup Interfaces (engine dependencies)

Narrow interfaces — only what the engine needs for validation:

```typescript
interface TClaimLookup<TClaim extends TCoreClaim = TCoreClaim> {
    get(id: string, version: number): TClaim | undefined
}

interface TSourceLookup<TSource extends TCoreSource = TCoreSource> {
    get(id: string, version: number): TSource | undefined
}
```

`getAll()` lives on the full library classes only, not on the lookup interfaces.

### ClaimLibrary\<TClaim\>

Generic class implementing `TClaimLookup<TClaim>`.

**Constructor:**

```typescript
constructor(options?: { checksumConfig?: TCoreChecksumConfig })
```

**Methods:**

- `create(claim: Omit<TClaim, 'version' | 'frozen' | 'checksum'>): TClaim` — creates at version 0, unfrozen
- `update(id: string, updates: Partial<Omit<TClaim, 'id' | 'version' | 'frozen' | 'checksum'>>): TClaim` — updates the highest-numbered version; throws if that version is frozen
- `freeze(id: string): { frozen: TClaim; current: TClaim }` — freezes the highest-numbered version, auto-creates next version as mutable copy. Returns both the frozen version and the new mutable version. Throws if the highest-numbered version is already frozen.
- `get(id: string, version: number): TClaim | undefined`
- `getCurrent(id: string): TClaim | undefined` — returns latest version
- `getAll(): TClaim[]` — all versions of all claims
- `getVersions(id: string): TClaim[]` — all versions of a specific claim
- `snapshot(): TClaimLibrarySnapshot<TClaim>`
- `static fromSnapshot<T>(snapshot: TClaimLibrarySnapshot<T>, options?: { checksumConfig?: TCoreChecksumConfig }): ClaimLibrary<T>`

**Internal storage:** `Map<string, Map<number, TClaim>>` (id → version → entity)

**Freeze copy semantics:** `freeze()` performs a shallow spread (`{ ...entity, version: N+1, frozen: false }`) then recomputes the checksum. Extensions with nested objects get shallow-copied — deep cloning is the caller's responsibility if needed.

### SourceLibrary\<TSource\>

Same API shape as `ClaimLibrary`, implementing `TSourceLookup<TSource>`.

### Library Snapshot Types

```typescript
type TClaimLibrarySnapshot<TClaim extends TCoreClaim = TCoreClaim> = {
    claims: TClaim[] // all versions, flattened
}

type TSourceLibrarySnapshot<TSource extends TCoreSource = TCoreSource> = {
    sources: TSource[] // all versions, flattened
}
```

Reconstructed into the `Map<string, Map<number, T>>` structure by `fromSnapshot` using each entity's `id` and `version` fields.

## ArgumentEngine Integration

### Constructor Signature

```typescript
class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
> {
    constructor(
        argument: TOptionalChecksum<TArg>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        options?: TLogicEngineOptions
    )
}
```

### Generic Parameter Cascade

`PremiseEngine` drops `TSource` from its generic parameters since `TSource` is removed from `TCoreChangeset` and `TCoreMutationResult`. `PremiseEngine` does not gain `TClaim` — claim validation is `ArgumentEngine`'s responsibility. `ChangeCollector` also drops `TSource`.

### Validation Behavior

- `addVariable(variable)` — validates `variable.claimId` and `variable.claimVersion` exist in the claim library. Throws if not found.
- `addVariableSourceAssociation(sourceId, sourceVersion, variableId)` — validates `sourceId`/`sourceVersion` exist in the source library. Throws if not found.
- `addExpressionSourceAssociation(sourceId, sourceVersion, expressionId, premiseId)` — validates `sourceId`/`sourceVersion` exist in the source library. Throws if not found.

### SourceManager Simplification

`SourceManager` is stripped down to association-only management:

**Removed:**

- `sources` map
- `addSource()`, `removeSource()`, `getSource()`, `getSources()`
- `cleanupOrphanedSource()` / orphan cleanup logic
- `TSourceRemovalResult` type (replaced — see below)

**Retained:**

- `addVariableSourceAssociation()`, `removeVariableSourceAssociation()`
- `addExpressionSourceAssociation()`, `removeExpressionSourceAssociation()`
- `removeAssociationsForVariable()`, `removeAssociationsForExpression()`
- All association query methods
- `snapshot()`, `fromSnapshot()`

**Internal changes:**

- `sourceToAssociations` index remains `Map<string, Set<string>>` keyed by `sourceId` alone (not a compound key with version). It is lazily populated: `addVariableSourceAssociation` and `addExpressionSourceAssociation` create entries on demand via `getOrCreate` (no prior `addSource` call needed).
- `getAssociationsForSource(sourceId)` returns associations across all source versions for that ID. It does not accept a version parameter — callers can filter by `sourceVersion` if needed.
- `SourceManager` constructor remains parameterless (no changes needed).
- Return types for `removeAssociationsForVariable()` and `removeAssociationsForExpression()` simplified: return `{ removedVariableAssociations: TCoreVariableSourceAssociation[]; removedExpressionAssociations: TCoreExpressionSourceAssociation[] }` instead of `TSourceRemovalResult`.
- `TSourceManagerSnapshot` drops the `sources` field — becomes `{ variableSourceAssociations: TCoreVariableSourceAssociation[]; expressionSourceAssociations: TCoreExpressionSourceAssociation[] }`.

### TSourceManagement Interface

Updated to remove source entity methods. Association method signatures updated to include `sourceVersion`:

```typescript
addVariableSourceAssociation(
    sourceId: string, sourceVersion: number, variableId: string
): TCoreMutationResult<...>

addExpressionSourceAssociation(
    sourceId: string, sourceVersion: number, expressionId: string, premiseId: string
): TCoreMutationResult<...>
```

Retains all association query and removal methods. `removeVariableSourceAssociation` and `removeExpressionSourceAssociation` signatures unchanged (operate by association ID).

### Variable Claim Updates

`updateVariable` is extended to accept claim reference changes:

```typescript
updateVariable(variableId: string, updates: {
    symbol?: string;
    claimId?: string;
    claimVersion?: number;
}): TCoreMutationResult<...>
```

`claimId` and `claimVersion` must be provided together (both or neither). Providing only one throws. When both are provided, the engine validates the new reference against the claim library before applying the update.

## Changeset and Snapshot Updates

### TCoreChangeset

Drops `sources` field and the `TSource` generic parameter (no longer needed since source entities are library-managed):

```typescript
interface TCoreChangeset<TExpr, TVar, TPremise, TArg> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    roles?: TCoreArgumentRoleState
    argument?: TArg
    variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>
    expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>
}
```

`TCoreMutationResult` also drops `TSource` from its generic parameters.

### TArgumentEngineSnapshot and TReactiveSnapshot

Both drop the `sources` record. Association records remain.

## Checksum Config Updates

```typescript
DEFAULT_CHECKSUM_CONFIG = {
    // ... existing fields ...
    claimFields: new Set(["id", "version"]),
    sourceFields: new Set(["id", "version"]), // updated: removed argumentId/argumentVersion
    variableFields: new Set([
        "id",
        "symbol",
        "argumentId",
        "argumentVersion",
        "claimId",
        "claimVersion", // new
    ]),
    variableSourceAssociationFields: new Set([
        "id",
        "sourceId",
        "sourceVersion", // sourceVersion new
        "variableId",
        "argumentId",
        "argumentVersion",
    ]),
    expressionSourceAssociationFields: new Set([
        "id",
        "sourceId",
        "sourceVersion", // sourceVersion new
        "expressionId",
        "premiseId",
        "argumentId",
        "argumentVersion",
    ]),
}
```

## Diff API Updates

- `defaultCompareSource` removed (sources no longer argument-owned)
- `TCoreArgumentDiff` drops the `sources` field and the `TSource` generic parameter
- `TCoreDiffOptions` drops `compareSource`
- Association comparators updated to include `sourceVersion`
- `defaultCompareVariable` updated to compare `claimId` and `claimVersion` in addition to `symbol`
- `diffArguments` drops source entity diffing; retains association diffing. Uses default generic parameters for `TSource` and `TClaim` (no new generics needed on `diffArguments` itself)

## File Organization

### New Files

| File                                            | Contents                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/lib/schemata/claim.ts`                     | `CoreClaimSchema`, `TCoreClaim`                                                    |
| `src/lib/core/claim-library.ts`                 | `ClaimLibrary<T>` class                                                            |
| `src/lib/core/source-library.ts`                | `SourceLibrary<T>` class                                                           |
| `src/lib/core/interfaces/library.interfaces.ts` | `TClaimLookup`, `TSourceLookup`, `TClaimLibrarySnapshot`, `TSourceLibrarySnapshot` |

### Modified Files

| File                                                      | Changes                                                                                                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/lib/schemata/source.ts`                              | Drop argument fields, add version/frozen                                                                      |
| `src/lib/schemata/propositional.ts`                       | Add claimId/claimVersion to variable schema                                                                   |
| `src/lib/schemata/index.ts`                               | Export claim schema                                                                                           |
| `src/lib/core/source-manager.ts`                          | Strip to association-only                                                                                     |
| `src/lib/core/argument-engine.ts`                         | New constructor, validation, new `TClaim` generic param                                                       |
| `src/lib/core/premise-engine.ts`                          | Drop `TSource` generic parameter                                                                              |
| `src/lib/core/interfaces/source-management.interfaces.ts` | Remove source entity methods                                                                                  |
| `src/lib/core/interfaces/index.ts`                        | Export library interfaces                                                                                     |
| `src/lib/types/mutation.ts`                               | Drop sources from changeset                                                                                   |
| `src/lib/types/reactive.ts`                               | Drop sources from snapshots                                                                                   |
| `src/lib/types/checksum.ts`                               | Add claimFields to config type                                                                                |
| `src/lib/consts.ts`                                       | Update DEFAULT_CHECKSUM_CONFIG                                                                                |
| `src/lib/core/diff.ts`                                    | Remove source diffing, drop TSource generic, update association diffing                                       |
| `src/lib/types/diff.ts`                                   | Drop sources from `TCoreArgumentDiff`, drop `compareSource` from `TCoreDiffOptions`, remove `TSource` generic |
| `src/lib/core/change-collector.ts`                        | Remove `addedSource`/`removedSource` methods, drop `TSource` generic                                          |
| `src/lib/index.ts`                                        | Export new classes and types                                                                                  |
| `src/extensions/ieee/source.ts`                           | Update to new CoreSourceSchema                                                                                |
| `test/core.test.ts`                                       | Update all tests; add library tests                                                                           |

## Checksum Config Sharing

`ClaimLibrary` and `SourceLibrary` reuse the existing `TCoreChecksumConfig` type. Libraries use `claimFields` and `sourceFields` respectively from the config. The same config instance can be shared across libraries and engines for consistency, or each can use its own. `DEFAULT_CHECKSUM_CONFIG` includes defaults for all field sets.

## CLI Scope

CLI files (`src/cli/`) will need updating for the new model (hydration, storage, commands). This is **out of scope** for this spec — CLI changes will be addressed in a follow-up spec after the core library changes land.

## Breaking Changes

This is version 0.5.0. All breaks are acceptable at pre-1.0.

1. `ArgumentEngine` constructor requires `claimLibrary` and `sourceLibrary`
2. `CoreSourceSchema` drops `argumentId`/`argumentVersion`, gains `version`/`frozen`
3. `CorePropositionalVariableSchema` requires `claimId`/`claimVersion`
4. `TSourceManagement` loses source entity methods
5. `TCoreChangeset` loses `sources` field
6. `TReactiveSnapshot` / `TArgumentEngineSnapshot` lose `sources` record
7. Association schemas gain `sourceVersion`
8. Diff API removes `defaultCompareSource`
9. IEEE extension needs updating
10. CLI hydration/storage needs updating
