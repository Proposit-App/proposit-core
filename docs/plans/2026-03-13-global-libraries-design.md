# Global Libraries Design — Assertions and Sources

**Date:** 2026-03-13
**Status:** Draft

## Overview

Introduce global, inter-argument entities — **Assertions** and **Sources** — managed by dedicated library classes. Assertions represent the propositional content that variables refer to. Sources provide evidentiary support. Both are reusable across arguments and have their own versioning system independent of argument versions.

## Motivation

Today, sources are argument-scoped (carry `argumentId`/`argumentVersion`) and variables have no formal connection to the propositional content they represent. This limits reuse: the same source or propositional claim used across multiple arguments must be duplicated. Global libraries solve this by making assertions and sources first-class, independently versioned entities that arguments reference rather than own.

## Key Decisions

1. **Assertions are minimal and extensible.** `CoreAssertionSchema` has only identity fields (`id`, `version`, `frozen`, `checksum`) with `additionalProperties: true`. Content schema is left to extensions.
2. **Sources are no longer argument-scoped.** `CoreSourceSchema` drops `argumentId`/`argumentVersion`, gains `version`/`frozen`.
3. **Variables require assertion references.** `assertionId` and `assertionVersion` are required (non-nullable) fields on `CorePropositionalVariableSchema`.
4. **Variables pin to a specific assertion version.** The engine validates that the referenced assertion exists in the library but does not enforce that it is frozen.
5. **Libraries are required by ArgumentEngine.** Passed as positional constructor parameters.
6. **Engine depends on narrow lookup interfaces.** `TAssertionLookup` and `TSourceLookup` — not the full library classes.
7. **No deletion from libraries.** Assertions and sources are permanent once created.
8. **Versioning with freeze semantics.** Entities start at version 0 (mutable). `freeze()` locks the current version and auto-creates the next version as a mutable copy. Only the latest version can be updated.
9. **Source associations gain `sourceVersion`.** Associations pin to a specific source version.
10. **SourceManager simplified to association-only.** No longer stores source entities; renamed considerations.

## Entity Schemas

### CoreAssertionSchema (new)

```typescript
CoreAssertionSchema = Type.Object({
    id: UUID,
    version: Type.Number(),
    frozen: Type.Boolean(),
    checksum: Type.String(),
}, { additionalProperties: true })
```

### CoreSourceSchema (updated)

```typescript
// Before: { id, argumentId, argumentVersion, checksum }
// After:
CoreSourceSchema = Type.Object({
    id: UUID,
    version: Type.Number(),
    frozen: Type.Boolean(),
    checksum: Type.String(),
}, { additionalProperties: true })
```

### CorePropositionalVariableSchema (updated)

```typescript
CorePropositionalVariableSchema = Type.Object({
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    symbol: Type.String(),
    assertionId: UUID,              // new, required
    assertionVersion: Type.Number(), // new, required
    checksum: Type.String(),
}, { additionalProperties: true })
```

### Association Schemas (updated)

Both gain `sourceVersion`:

```typescript
CoreVariableSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    sourceVersion: Type.Number(),  // new
    variableId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String(),
})

CoreExpressionSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    sourceVersion: Type.Number(),  // new
    expressionId: UUID,
    premiseId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String(),
})
```

## Library Interfaces

### Lookup Interfaces (engine dependencies)

```typescript
interface TAssertionLookup<TAssertion extends TCoreAssertion = TCoreAssertion> {
    get(id: string, version: number): TAssertion | undefined
    getAll(): TAssertion[]
}

interface TSourceLookup<TSource extends TCoreSource = TCoreSource> {
    get(id: string, version: number): TSource | undefined
    getAll(): TSource[]
}
```

### AssertionLibrary\<TAssertion\>

Generic class implementing `TAssertionLookup<TAssertion>`.

**Constructor:**
```typescript
constructor(options?: { checksumConfig?: TCoreChecksumConfig })
```

**Methods:**
- `create(assertion: Omit<TAssertion, 'version' | 'frozen' | 'checksum'>): TAssertion` — creates at version 0, unfrozen
- `update(id: string, updates: Partial<Omit<TAssertion, 'id' | 'version' | 'frozen' | 'checksum'>>): TAssertion` — updates latest (unfrozen) version; throws if frozen
- `freeze(id: string): TAssertion` — freezes latest version, auto-creates next version as mutable copy, returns the new mutable version
- `get(id: string, version: number): TAssertion | undefined`
- `getCurrent(id: string): TAssertion | undefined` — returns latest version
- `getAll(): TAssertion[]` — all versions of all assertions
- `getVersions(id: string): TAssertion[]` — all versions of a specific assertion
- `snapshot(): TAssertionLibrarySnapshot<TAssertion>`
- `static fromSnapshot<T>(...): AssertionLibrary<T>`

**Internal storage:** `Map<string, Map<number, TAssertion>>` (id → version → entity)

### SourceLibrary\<TSource\>

Same API shape as `AssertionLibrary`, implementing `TSourceLookup<TSource>`.

## ArgumentEngine Integration

### Constructor Signature

```typescript
class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TAssertion extends TCoreAssertion = TCoreAssertion,
> {
    constructor(
        argument: TOptionalChecksum<TArg>,
        assertionLibrary: TAssertionLookup<TAssertion>,
        sourceLibrary: TSourceLookup<TSource>,
        options?: TLogicEngineOptions
    )
}
```

### Validation Behavior

- `addVariable(variable)` — validates `variable.assertionId` and `variable.assertionVersion` exist in the assertion library. Throws if not found.
- `addVariableSourceAssociation(sourceId, sourceVersion, variableId)` — validates `sourceId`/`sourceVersion` exist in the source library. Throws if not found.
- `addExpressionSourceAssociation(sourceId, sourceVersion, expressionId, premiseId)` — validates `sourceId`/`sourceVersion` exist in the source library. Throws if not found.

### SourceManager Simplification

`SourceManager` is stripped down to association-only management:

**Removed:**
- `sources` map
- `addSource()`, `removeSource()`, `getSource()`, `getSources()`
- `cleanupOrphanedSource()` / orphan cleanup logic

**Retained:**
- `addVariableSourceAssociation()`, `removeVariableSourceAssociation()`
- `addExpressionSourceAssociation()`, `removeExpressionSourceAssociation()`
- `removeAssociationsForVariable()`, `removeAssociationsForExpression()`
- All association query methods
- `snapshot()`, `fromSnapshot()`

### TSourceManagement Interface

Updated to remove source entity methods. Retains association CRUD and queries only.

## Changeset and Snapshot Updates

### TCoreChangeset

Drops `sources` field:

```typescript
interface TCoreChangeset<TExpr, TVar, TPremise, TArg, TSource> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    roles?: TCoreArgumentRoleState
    argument?: TArg
    // sources field removed
    variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>
    expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>
}
```

### TArgumentEngineSnapshot and TReactiveSnapshot

Both drop the `sources` record. Association records remain.

## Checksum Config Updates

```typescript
DEFAULT_CHECKSUM_CONFIG = {
    // ... existing fields ...
    assertionFields: new Set(["id", "version"]),
    sourceFields: new Set(["id", "version"]),  // updated: removed argumentId/argumentVersion
    variableFields: new Set([
        "id", "symbol", "argumentId", "argumentVersion",
        "assertionId", "assertionVersion",  // new
    ]),
    variableSourceAssociationFields: new Set([
        "id", "sourceId", "sourceVersion",  // sourceVersion new
        "variableId", "argumentId", "argumentVersion",
    ]),
    expressionSourceAssociationFields: new Set([
        "id", "sourceId", "sourceVersion",  // sourceVersion new
        "expressionId", "premiseId", "argumentId", "argumentVersion",
    ]),
}
```

## Diff API Updates

- `defaultCompareSource` removed (sources no longer argument-owned)
- Association comparators updated to include `sourceVersion`
- `diffArguments` drops source entity diffing; retains association diffing

## File Organization

### New Files

| File | Contents |
|------|----------|
| `src/lib/schemata/assertion.ts` | `CoreAssertionSchema`, `TCoreAssertion` |
| `src/lib/core/assertion-library.ts` | `AssertionLibrary<T>` class |
| `src/lib/core/source-library.ts` | `SourceLibrary<T>` class |
| `src/lib/core/interfaces/library.interfaces.ts` | `TAssertionLookup`, `TSourceLookup` |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/schemata/source.ts` | Drop argument fields, add version/frozen |
| `src/lib/schemata/propositional.ts` | Add assertionId/assertionVersion to variable schema |
| `src/lib/schemata/index.ts` | Export assertion schema |
| `src/lib/core/source-manager.ts` | Strip to association-only |
| `src/lib/core/argument-engine.ts` | New constructor, validation, new generic param |
| `src/lib/core/interfaces/source-management.interfaces.ts` | Remove source entity methods |
| `src/lib/core/interfaces/index.ts` | Export library interfaces |
| `src/lib/types/mutation.ts` | Drop sources from changeset |
| `src/lib/types/reactive.ts` | Drop sources from snapshots |
| `src/lib/types/checksum.ts` | Add assertionFields to config type |
| `src/lib/consts.ts` | Update DEFAULT_CHECKSUM_CONFIG |
| `src/lib/core/diff.ts` | Remove source diffing, update association diffing |
| `src/lib/index.ts` | Export new classes and types |
| `src/extensions/ieee/source.ts` | Update to new CoreSourceSchema |
| `test/core.test.ts` | Update all tests; add library tests |

## Breaking Changes

This is version 0.5.0. All breaks are acceptable at pre-1.0.

1. `ArgumentEngine` constructor requires `assertionLibrary` and `sourceLibrary`
2. `CoreSourceSchema` drops `argumentId`/`argumentVersion`, gains `version`/`frozen`
3. `CorePropositionalVariableSchema` requires `assertionId`/`assertionVersion`
4. `TSourceManagement` loses source entity methods
5. `TCoreChangeset` loses `sources` field
6. `TReactiveSnapshot` / `TArgumentEngineSnapshot` lose `sources` record
7. Association schemas gain `sourceVersion`
8. Diff API removes `defaultCompareSource`
9. IEEE extension needs updating
10. CLI hydration/storage needs updating
