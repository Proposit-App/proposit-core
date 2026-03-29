# Unified ForkLibrary & PropositCore Design

**Date:** 2026-03-28
**Scope:** Replace ForksLibrary with unified ForkLibrary (namespaced entity fork records), introduce ArgumentLibrary (engine registry), introduce PropositCore (top-level orchestrator), remove inline fork fields from entity schemas

## Motivation

proposit-core 0.7.5 introduced `ForksLibrary` for argument-level fork records and inline `forkedFrom*`/`forkId` fields on every entity schema. This creates three problems:

1. **Schema bloat.** Each entity gains 4-5 nullable columns that are null on most rows and never updated. Fork data is immutable provenance stored on mutable entity rows.

2. **Custom fields not supported.** `ForksLibrary.forkArgument()` constructs fork records internally, accepting only `forkId` and `creatorId`. Applications extending `TCoreFork` cannot populate custom fields without a manual workaround that bypasses the `canFork()` guard.

3. **No cross-library orchestration.** Forking touches multiple libraries (claims, sources, associations) but there is no single coordinator. Each consumer must wire libraries together manually.

## Design

### 1. Core Principle: No Application Metadata

The core library does not deal in metadata such as user IDs, timestamps, or display text. These are application-level concerns. The CLI adds some metadata for its own purposes, but the core schemas are intentionally minimal. Applications extend core types via generic parameters to add fields like `createdOn`, `creatorId`, `sourceUserId`, etc.

### 2. Fork Record Schemas

New file: `src/lib/schemata/fork.ts` (replaces existing `CoreForkSchema`/`TCoreFork`).

**Base record** shared by all entity fork records:

```typescript
type TCoreEntityForkRecord = {
    entityId: string // the forked entity's ID
    forkedFromEntityId: string // original entity's ID
    forkedFromArgumentId: string // original argument ID
    forkedFromArgumentVersion: number // original argument version at fork time
    forkId: string // shared ID linking all records from one fork operation
}
```

No `checksum` field. Fork records are immutable after creation, so checksums serve no purpose.

**Per-entity types:**

```typescript
// Argument — identical to base; the record whose forkId other records reference
type TCoreArgumentForkRecord = TCoreEntityForkRecord

// Premise — identical to base
type TCorePremiseForkRecord = TCoreEntityForkRecord

// Expression — adds source premise reference
type TCoreExpressionForkRecord = TCoreEntityForkRecord & {
    forkedFromPremiseId: string // premise in the original argument that owned this expression
}

// Variable — identical to base
type TCoreVariableForkRecord = TCoreEntityForkRecord

// Claim — adds version tracking (claims are independently versioned)
type TCoreClaimForkRecord = TCoreEntityForkRecord & {
    forkedFromEntityVersion: number // claim version that was cloned
}

// Source — adds version tracking (sources are independently versioned)
type TCoreSourceForkRecord = TCoreEntityForkRecord & {
    forkedFromEntityVersion: number // source version that was cloned
}
```

All have Typebox schemas with `additionalProperties: true` for generic extension.

### 3. Entity Schema Changes

Remove all inline fork fields from entity schemas:

- **`CoreArgumentSchema`**: remove `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`
- **`CorePremiseSchema`**: remove `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`
- **`BasePropositionalExpressionSchema`**: remove `forkedFromExpressionId`, `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`
- **`CoreVariableBaseFields`**: remove `forkedFromVariableId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`

### 4. Checksum Config Changes

Remove fork-related entries from entity checksum field sets in `DEFAULT_CHECKSUM_CONFIG`:

- `expressionFields`: remove `forkedFromExpressionId`, `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`
- `variableFields`: remove `forkedFromVariableId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`
- `premiseFields`: remove `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`
- `argumentFields`: remove `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId`

Remove `forkFields` from `TCoreChecksumConfig` entirely.

### 5. ForkNamespace Class

Standalone exported class in `src/lib/core/fork-namespace.ts`. Manages fork records for one entity type.

**Generic:** `ForkNamespace<T extends TCoreEntityForkRecord = TCoreEntityForkRecord>`

**Constructor:** `constructor()` — no options needed.

**API:**

| Method                                                   | Description                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `get(entityId: string): T \| undefined`                  | Fork record for a forked entity                              |
| `getAll(): T[]`                                          | All records in the namespace                                 |
| `getByForkId(forkId: string): T[]`                       | All records from one fork operation                          |
| `create(record: T): T`                                   | Validates schema, stores. Throws on duplicate `entityId`.    |
| `remove(entityId: string): T`                            | Removes record. Throws if not found. Returns removed record. |
| `snapshot(): T[]`                                        | Returns all records as an array                              |
| `static fromSnapshot<T>(records: T[]): ForkNamespace<T>` | Reconstructs from snapshot                                   |
| `validate(): TInvariantValidationResult`                 | Schema-only validation                                       |

**Key decisions:**

- Keyed by `entityId` (the forked entity), not by a separate record ID. Each entity appears at most once per namespace.
- `getByForkId()` is a linear scan (no secondary index). Adequate for typical fork sizes.
- Mutations wrapped in `withValidation()` following the established library pattern.

No separate lookup interface needed. `ForkNamespace` is the concrete class used directly by `ForkLibrary` and `PropositCore`.

### 6. ForkLibrary Class

In `src/lib/core/fork-library.ts`. Composes six `ForkNamespace` instances. Pure record store — no orchestration logic.

**Generic:**

```typescript
class ForkLibrary<
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
>
```

**Properties:**

```typescript
arguments: ForkNamespace<TArgFork>
premises: ForkNamespace<TPremiseFork>
expressions: ForkNamespace<TExprFork>
variables: ForkNamespace<TVarFork>
claims: ForkNamespace<TClaimFork>
sources: ForkNamespace<TSourceFork>
```

**API:**

| Method                                                 | Description                                 |
| ------------------------------------------------------ | ------------------------------------------- |
| `snapshot(): TForkLibrarySnapshot<...>`                | Returns all six namespace arrays            |
| `static fromSnapshot<...>(snapshot): ForkLibrary<...>` | Reconstructs all namespaces                 |
| `validate(): TInvariantValidationResult`               | Delegates to each namespace, merges results |

No `forkArgument()` on ForkLibrary — that orchestration lives on `PropositCore`.

**Snapshot type:**

```typescript
type TForkLibrarySnapshot<
    TArgFork,
    TPremiseFork,
    TExprFork,
    TVarFork,
    TClaimFork,
    TSourceFork,
> = {
    arguments: TArgFork[]
    premises: TPremiseFork[]
    expressions: TExprFork[]
    variables: TVarFork[]
    claims: TClaimFork[]
    sources: TSourceFork[]
}
```

### 7. ArgumentLibrary Class

New file: `src/lib/core/argument-library.ts`. Engine registry with lifecycle management.

**Generic:**

```typescript
class ArgumentLibrary<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
>
```

**Constructor:**

```typescript
constructor(
    libraries: {
        claimLibrary: ClaimLibrary<TClaim>
        sourceLibrary: SourceLibrary<TSource>
        claimSourceLibrary: ClaimSourceLibrary<TAssoc>
    },
    options?: TArgumentEngineOptions
)
```

**API:**

| Method                                                                          | Description                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `create(argument: TArg): ArgumentEngine<...>`                                   | Constructs engine with shared libraries, stores by `argument.id`. Throws on duplicate ID. |
| `get(argumentId: string): ArgumentEngine<...> \| undefined`                     | Retrieves engine by ID                                                                    |
| `getAll(): ArgumentEngine<...>[]`                                               | Returns all engines                                                                       |
| `remove(argumentId: string): ArgumentEngine<...>`                               | Removes and returns engine. Throws if not found.                                          |
| `snapshot(): TArgumentLibrarySnapshot<...>`                                     | Snapshots all engines                                                                     |
| `static fromSnapshot<...>(snapshot, libraries, options?): ArgumentLibrary<...>` | Restores all engines                                                                      |
| `validate(): TInvariantValidationResult`                                        | Validates all engines                                                                     |

**Snapshot type:**

```typescript
type TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar> = {
    arguments: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>[]
}
```

### 8. PropositCore Class

New file: `src/lib/core/proposit-core.ts`. Top-level orchestrator. Designed for subclassing — all internal state is `protected`, key methods are overridable.

**Generic:**

```typescript
class PropositCore<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
    TArgFork extends TCoreArgumentForkRecord = TCoreArgumentForkRecord,
    TPremiseFork extends TCorePremiseForkRecord = TCorePremiseForkRecord,
    TExprFork extends TCoreExpressionForkRecord = TCoreExpressionForkRecord,
    TVarFork extends TCoreVariableForkRecord = TCoreVariableForkRecord,
    TClaimFork extends TCoreClaimForkRecord = TCoreClaimForkRecord,
    TSourceFork extends TCoreSourceForkRecord = TCoreSourceForkRecord,
>
```

**Constructor:**

```typescript
constructor(options?: TPropositCoreOptions)
```

`TPropositCoreOptions` includes `checksumConfig`, `positionConfig`, `grammarConfig`, and optional pre-constructed library instances. When library instances are not provided, PropositCore constructs them with the shared options.

**Properties (protected, exposed as public getters or directly):**

```typescript
arguments: ArgumentLibrary<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
claims: ClaimLibrary<TClaim>
sources: SourceLibrary<TSource>
claimSources: ClaimSourceLibrary<TAssoc>
forks: ForkLibrary<
    TArgFork,
    TPremiseFork,
    TExprFork,
    TVarFork,
    TClaimFork,
    TSourceFork
>
```

**Cross-library operations:**

#### `forkArgument()`

```typescript
forkArgument(
    argumentId: string,
    newArgumentId: string,
    options?: TForkArgumentOptions & {
        forkId?: string
        argumentForkExtras?: Partial<Omit<TArgFork, keyof TCoreArgumentForkRecord>>
        premiseForkExtras?: Partial<Omit<TPremiseFork, keyof TCorePremiseForkRecord>>
        expressionForkExtras?: Partial<Omit<TExprFork, keyof TCoreExpressionForkRecord>>
        variableForkExtras?: Partial<Omit<TVarFork, keyof TCoreVariableForkRecord>>
        claimForkExtras?: Partial<Omit<TClaimFork, keyof TCoreClaimForkRecord>>
        sourceForkExtras?: Partial<Omit<TSourceFork, keyof TCoreSourceForkRecord>>
    }
): {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>
    remapTable: TForkRemapTable
    argumentFork: TArgFork
}
```

**Steps:**

1. Retrieve source engine from `this.arguments`. Throw if not found.
2. Call `engine.canFork()` — throw if `false`.
3. **Clone claims:** Identify all unique claims referenced by the engine's variables (via `claimId`/`claimVersion`). Clone each claim into `this.claims` (new ID, version 0, content from the referenced version). Build claim remap.
4. **Clone sources:** Identify all sources associated with the referenced claims (via `this.claimSources`). Clone each source into `this.sources` (new ID, version 0). Build source remap.
5. **Clone associations:** For each original claim-source association involving a referenced claim, create a corresponding new association in `this.claimSources` linking the cloned claim (at its cloned version) to the cloned source (at its cloned version). The forked argument gets a complete, independent copy of all claim-source relationships.
6. **Fork engine:** Call `forkArgumentEngine()` with claim remap so forked variables' `claimId`/`claimVersion` references point to the cloned claims instead of the originals.
7. **Register engine:** Store the forked engine in `this.arguments`.
8. **Create fork records:** Populate all 6 namespaces of `this.forks` using the remap table (merging respective extras).
9. Return `{ engine, remapTable, argumentFork }`.

The result is a fully independent copy: the forked argument, its claims, its sources, and all claim-source associations are decoupled from the originals. Mutating any forked entity has no effect on the original.

#### `diffArguments()`

```typescript
diffArguments(
    argumentIdA: string,
    argumentIdB: string,
    options?: TCoreDiffOptions<TPremise, TExpr, TVar>
): TCoreArgumentDiff<TPremise, TExpr, TVar>
```

Retrieves engines from `this.arguments`, automatically injects fork-aware entity matchers from `this.forks`, and delegates to the existing standalone `diffArguments()` function. Each matcher checks `this.forks.<namespace>.get(b.id)?.forkedFromEntityId === a.id` to pair forked entities with their originals. Caller-provided matchers in `options` override the automatic fork-aware matchers.

**State operations:**

| Method                                                            | Description                             |
| ----------------------------------------------------------------- | --------------------------------------- |
| `snapshot(): TPropositCoreSnapshot<...>`                          | Snapshots all libraries                 |
| `static fromSnapshot<...>(snapshot, options?): PropositCore<...>` | Restores full state                     |
| `validate(): TInvariantValidationResult`                          | Validates all libraries, merges results |

**Snapshot type:**

`TPropositCoreSnapshot` captures the complete state of all libraries, including all claim-source associations. Round-tripping through `snapshot()`/`fromSnapshot()` preserves forked arguments with their independent claims, sources, and associations intact.

```typescript
type TPropositCoreSnapshot<
    TArg,
    TPremise,
    TExpr,
    TVar,
    TSource,
    TClaim,
    TAssoc,
    TArgFork,
    TPremiseFork,
    TExprFork,
    TVarFork,
    TClaimFork,
    TSourceFork,
> = {
    arguments: TArgumentLibrarySnapshot<TArg, TPremise, TExpr, TVar>
    claims: TClaimLibrarySnapshot<TClaim>
    sources: TSourceLibrarySnapshot<TSource>
    claimSources: TClaimSourceLibrarySnapshot<TAssoc>
    forks: TForkLibrarySnapshot<
        TArgFork,
        TPremiseFork,
        TExprFork,
        TVarFork,
        TClaimFork,
        TSourceFork
    >
}
```

**Subclassing:** All internal library references are `protected`. Key methods (`forkArgument`, `diffArguments`) are public and overridable. Subclasses can inject custom behavior (e.g., fork policy, event hooks) by overriding these methods.

### 9. `forkArgumentEngine()` Changes

The standalone function in `src/lib/core/fork.ts` changes:

1. **Stops setting `forkedFrom*` fields** on entities. Those fields no longer exist. The function purely remaps IDs and cross-references.

2. **Accepts optional claim remap** for updating variable claim references:

```typescript
function forkArgumentEngine<TArg, TPremise, TExpr, TVar, TSource, TClaim, TAssoc>(
    engine: ArgumentEngine<...>,
    newArgumentId: string,
    libraries: {
        claimLibrary: TClaimLookup<TClaim>
        sourceLibrary: TSourceLookup<TSource>
        claimSourceLibrary: TClaimSourceLookup<TAssoc>
    },
    options?: TForkArgumentOptions & {
        claimRemap?: Map<string, { id: string; version: number }>
    }
): {
    engine: ArgumentEngine<...>
    remapTable: TForkRemapTable
}
```

When `claimRemap` is provided, claim-bound variables with `claimId` in the map get their `claimId` and `claimVersion` updated to the cloned values during the remap pass.

### 10. `TForkRemapTable` Changes

Expanded to include claim and source remaps:

```typescript
type TForkRemapTable = {
    argumentId: { from: string; to: string }
    premises: Map<string, string>
    expressions: Map<string, string>
    variables: Map<string, string>
    claims: Map<string, string> // original claim ID -> cloned claim ID
    sources: Map<string, string> // original source ID -> cloned source ID
}
```

### 11. `createForkedFromMatcher()` Removal

The standalone `createForkedFromMatcher()` function is removed entirely. Fork-aware entity matching is handled internally by `PropositCore.diffArguments()`, which has direct access to the fork records in `this.forks`. There is no need for consumers to create matchers manually.

## Removals

- `ForksLibrary` class — replaced by `ForkLibrary` + `PropositCore`
- `TCoreFork`, `CoreForkSchema` — replaced by `TCoreEntityForkRecord` and per-entity types
- `TForkLookup`, `TForksLibrarySnapshot` — replaced by `TForkLibrarySnapshot`
- `createForkedFromMatcher()` standalone function — fork matching is now internal to `PropositCore.diffArguments()`
- `forkFields` from `TCoreChecksumConfig`
- All `forkedFrom*` and `forkId` fields from entity schemas and checksum configs
- `ForksLibrary.forkArgument()` — replaced by `PropositCore.forkArgument()`

## Exports

All new types, schemas, classes, and functions exported from `src/lib/index.ts`:

**Classes:** `ForkNamespace`, `ForkLibrary`, `ArgumentLibrary`, `PropositCore`

**Types:** `TCoreEntityForkRecord`, `TCoreArgumentForkRecord`, `TCorePremiseForkRecord`, `TCoreExpressionForkRecord`, `TCoreVariableForkRecord`, `TCoreClaimForkRecord`, `TCoreSourceForkRecord`, `TForkLibrarySnapshot`, `TArgumentLibrarySnapshot`, `TPropositCoreOptions`, `TPropositCoreSnapshot`

**Schemas:** `CoreEntityForkRecordSchema`, `CoreArgumentForkRecordSchema`, `CorePremiseForkRecordSchema`, `CoreExpressionForkRecordSchema`, `CoreVariableForkRecordSchema`, `CoreClaimForkRecordSchema`, `CoreSourceForkRecordSchema`

**Functions:** `forkArgumentEngine` (updated)

## Documentation Requirements

1. **JSDoc** on all exported functions, types, and class methods.
2. **`src/lib/core/interfaces/`**: Replace `TForkLookup`/`TForksLibrarySnapshot` with `TForkLibrarySnapshot`/`TArgumentLibrarySnapshot`/`TPropositCoreSnapshot` in `library.interfaces.ts`.
3. **CLAUDE.md**: Add design rules for PropositCore, ArgumentLibrary, ForkLibrary. Add explicit note that the core library does not deal in application metadata (user IDs, timestamps, display text).
4. **README.md**: Add PropositCore section as the recommended entry point. Update forking section. Add the same metadata note.
5. **docs/api-reference.md**: Add PropositCore, ArgumentLibrary, ForkLibrary, ForkNamespace sections. Remove ForksLibrary section.
6. **Release notes and changelog**: Update `docs/release-notes/upcoming.md` and `docs/changelogs/upcoming.md`.

## Testing

1. **ForkNamespace**: create, get, getAll, getByForkId, remove, snapshot/fromSnapshot round-trip, validate, duplicate entityId rejection.
2. **ForkLibrary**: 6 namespaces populated, snapshot/fromSnapshot round-trips all namespaces, validate delegates to each namespace.
3. **ArgumentLibrary**: create/get/getAll/remove, snapshot/fromSnapshot round-trip, duplicate ID rejection, validate delegates to engines.
4. **PropositCore construction**: constructs all libraries, wires them together.
5. **PropositCore.forkArgument()**: end-to-end — clones claims and sources, creates associations, creates fork records in all 6 namespaces, registers forked engine, respects `canFork()` guard.
6. **PropositCore.diffArguments()**: automatically pairs forked entities with originals via fork records. Caller-provided matchers override automatic fork matching.
7. **PropositCore snapshot/fromSnapshot**: full round-trip of all libraries.
8. **forkArgumentEngine()**: claim remap works, no forkedFrom fields on forked entities, returns expanded TForkRemapTable.
9. **Entity schema regression**: forked entities do NOT carry forkedFrom/forkId fields.
10. **Generic extras**: custom fields merged into fork records during `forkArgument()`.
11. **Checksum regression**: entity checksums no longer include fork-related fields.
12. **PropositCore subclassing**: subclass can override `forkArgument()` and `diffArguments()`.
