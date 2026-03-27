# Argument Forking — Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Spec 1 of 2 (forking only; cross-argument variable binding is spec 2)

## Problem

When someone wants to respond to, critique, or expand on an existing argument, they need a way to create their own copy that preserves the original structure while allowing modifications. Currently there is no mechanism to duplicate an argument with provenance tracking — you'd have to manually reconstruct every entity.

A response is itself an argument. The responder forks the original, gaining a mutable copy of all entities. They can then add, remove, or replace premises to express their position. The fork metadata makes it trivial to diff the response against the original and see exactly what changed.

## Solution

An instance method `forkArgument` on `ArgumentEngine` that duplicates the current argument into a new, independent engine. All entities receive new UUIDs and carry `forkedFrom` metadata pointing back to their originals. A protected `canFork` method allows subclasses to inject validation policy (e.g., only fork published arguments).

## Design Decisions

| Decision                 | Choice                                                    | Rationale                                                                              |
| ------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Fork target              | Instance method on ArgumentEngine                         | "Fork the argument managed by this engine" — natural ownership                         |
| Entity IDs               | New UUIDs for all entities                                | Clean separation; provenance is explicit via `forkedFrom`, not implicit via shared IDs |
| Fork provenance          | Each entity type carries full `forkedFrom` identity tuple | Every entity is independently traceable to its source                                  |
| Forked entity mutability | Fully mutable                                             | Responders may modify, add, or remove any entity; changes are tracked via diff         |
| Validation               | `canFork()` protected overridable method                  | Core library is agnostic about publish semantics; subclasses inject policy             |
| Default validation       | `() => true`                                              | No restrictions at library level                                                       |
| New engine independence  | Fully independent                                         | Mutations to the fork do not affect the source engine                                  |
| Checksum handling        | `forkedFrom` fields included in checksums by default      | Forked entities are distinct from their sources; checksums should reflect this         |
| Diff integration         | Pluggable entity matchers on `TCoreDiffOptions`           | Enables fork-aware diffing via `forkedFrom` field matching                             |

## 1. Schema Changes

### Argument

New nullable fields on `CoreArgumentSchema`:

```typescript
forkedFromArgumentId: UUID | null
forkedFromArgumentVersion: number | null
```

### Premise

New nullable fields on `CorePremiseSchema`:

```typescript
forkedFromPremiseId: UUID | null
forkedFromArgumentId: UUID | null
forkedFromArgumentVersion: number | null
```

### Expression

New nullable fields on `BasePropositionalExpressionSchema`:

```typescript
forkedFromExpressionId: UUID | null
forkedFromPremiseId: UUID | null
forkedFromArgumentId: UUID | null
forkedFromArgumentVersion: number | null
```

### Variable

New nullable fields on the shared variable base (inherited by both `CoreClaimBoundVariableSchema` and `CorePremiseBoundVariableSchema`):

```typescript
forkedFromVariableId: UUID | null
forkedFromArgumentId: UUID | null
forkedFromArgumentVersion: number | null
```

All `forkedFrom` fields are nullable. Non-forked entities carry `null` values, keeping the schema uniform.

## 2. `canFork` Method

```typescript
// On ArgumentEngine — protected, overridable by subclasses
protected canFork(): boolean {
    return true
}
```

Called by `forkArgument` before any work. Throws if it returns `false`. The CLI subclass would override this to check its `published` metadata.

## 3. `forkArgument` Method

### Signature

```typescript
public forkArgument(
    newArgumentId: UUID,
    claimLibrary: TClaimLookup<TClaim>,
    sourceLibrary: TSourceLookup<TSource>,
    claimSourceLibrary: TClaimSourceLookup<TAssoc>,
    options?: TForkArgumentOptions
): TForkArgumentResult<TArg, TPremise, TExpr, TVar>
```

The caller provides `newArgumentId` (consistent with existing API patterns where the caller supplies IDs). Libraries are required because the new engine needs its own library references.

### Options

```typescript
interface TForkArgumentOptions {
    generateId?: () => UUID // defaults to crypto.randomUUID
    checksumConfig?: TChecksumConfig
    positionConfig?: TCorePositionConfig
    grammarConfig?: TGrammarConfig
}
```

Config options allow the fork to inherit or override the source's configuration. If omitted, they are copied from the source engine.

### Result

```typescript
interface TForkArgumentResult<TArg, TPremise, TExpr, TVar> {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar>
    remapTable: TForkRemapTable
}

interface TForkRemapTable {
    argumentId: { from: UUID; to: UUID }
    premises: Map<UUID, UUID> // original premise ID -> new premise ID
    expressions: Map<UUID, UUID> // original expression ID -> new expression ID
    variables: Map<UUID, UUID> // original variable ID -> new variable ID
}
```

### Process

1. Call `this.canFork()` — throw if `false`
2. Snapshot this engine via `this.snapshot()`
3. Generate new UUIDs for all premises, expressions, and variables via `generateId()`
4. Build the remap table mapping original IDs to new IDs
5. Walk the snapshot and apply remaps to all internal references:
    - Expression `premiseId` -> remapped premise ID
    - Expression `parentId` -> remapped expression ID (`null` stays `null`)
    - Premise-bound variable `boundPremiseId` -> remapped premise ID
    - Conclusion premise ID in role state -> remapped premise ID
6. Stamp `forkedFrom` fields on every entity using the original IDs and argument identity
7. Set argument to `newArgumentId`, version `0`
8. Set all entity `argumentId` and `argumentVersion` fields to match the new argument
9. Construct new engine via `fromSnapshot` with `checksumVerification: "ignore"` (checksums will be recomputed since fields changed)
10. Return `{ engine, remapTable }`

## 4. Diff Integration

### Pluggable Entity Matchers

New optional fields on `TCoreDiffOptions`:

```typescript
interface TCoreDiffOptions<TArg, TVar, TPremise, TExpr> {
    // ... existing comparator fields ...
    premiseMatcher?: (a: TPremise, b: TPremise) => boolean
    variableMatcher?: (a: TVar, b: TVar) => boolean
    expressionMatcher?: (a: TExpr, b: TExpr) => boolean
}
```

When provided, matchers override the default ID-based pairing in `diffEntitySet`. A matcher returns `true` if two entities should be compared as corresponding pairs.

### Built-in Fork-Aware Matcher

```typescript
function createForkedFromMatcher<TPremise, TExpr, TVar>(): {
    premiseMatcher: (a: TPremise, b: TPremise) => boolean
    variableMatcher: (a: TVar, b: TVar) => boolean
    expressionMatcher: (a: TExpr, b: TExpr) => boolean
}
```

Pairs entity A with entity B when B's `forkedFrom*Id` equals A's `id` and the `forkedFromArgumentId`/`forkedFromArgumentVersion` match A's argument identity. No remap table required — the provenance metadata is self-describing. The function checks for the presence of `forkedFrom` fields at runtime, so it works with any entity types that include the fork provenance fields (which all core schema types will after the schema changes).

Usage:

```typescript
diffArguments(originalEngine, forkedEngine, { ...createForkedFromMatcher() })
```

## 5. Checksum Configuration

The `forkedFrom` fields are added to the default checksum field lists:

- `argumentFields`: adds `forkedFromArgumentId`, `forkedFromArgumentVersion`
- `premiseFields`: adds `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`
- `expressionFields`: adds `forkedFromExpressionId`, `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`
- `variableFields`: adds `forkedFromVariableId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`

Since `checksumConfig` is caller-controlled, applications that want provenance-agnostic checksums can omit these fields.

## 6. Testing Strategy

Tests follow the existing pattern in `test/core.test.ts` — each `describe` block builds its own fixtures inline, no shared state.

New `describe` block: **`forkArgument`**

1. **Basic fork** — fork a simple argument with 2 premises, a few expressions, and a variable. Verify the new engine has a new argument ID, version 0, all entities have new UUIDs, and all `forkedFrom` fields point back to the originals.

2. **Internal reference remapping** — fork an argument with nested expressions and premise-bound variables. Verify expression `parentId` chains are remapped correctly, variable `boundPremiseId` points to the forked premise (not the original), and conclusion role state points to the forked conclusion premise.

3. **Remap table accuracy** — verify every entry in the remap table correctly maps original ID to new ID, and that the maps cover all entities.

4. **Independence** — mutate the forked engine (add a premise, remove an expression, change an operator). Verify the source engine is unaffected.

5. **`canFork` rejection** — subclass ArgumentEngine, override `canFork` to return `false`. Verify `forkArgument` throws.

6. **Forked entity mutability** — modify forked expressions (change operators, add children), remove forked premises, add new premises. Verify all mutations work normally.

7. **Diff integration** — fork an argument, mutate the fork, then run `diffArguments` with `createForkedFromMatcher()`. Verify the diff correctly identifies added, removed, and modified entities relative to the original.

8. **Checksum divergence** — verify that a freshly forked entity's checksum differs from its source (due to different IDs and `forkedFrom` fields), and that checksums update correctly after mutations.

## 7. Scope and Boundaries

### In scope

- `forkedFrom` schema fields on argument, premise, expression, and variable entities
- `canFork` protected overridable method on ArgumentEngine
- `forkArgument` public instance method on ArgumentEngine
- `TForkArgumentResult` and `TForkRemapTable` types
- `TForkArgumentOptions` type
- `createForkedFromMatcher` helper for diff integration
- Matcher options (`premiseMatcher`, `variableMatcher`, `expressionMatcher`) on `TCoreDiffOptions`
- Checksum config updates to include `forkedFrom` fields
- Tests for all of the above

### Out of scope — deferred to spec 2 (cross-argument variable binding)

- New variable variant for external premise/argument binding
- `canBind` overridable method on ArgumentEngine
- Published-version constraint enforcement for bindings
- Evaluation semantics for cross-argument bound variables
- Argument-level binding sugar (resolve to conclusion premise at bind time)

### Out of scope — application level

- CLI `fork` command
- Publish enforcement policy (provided by subclass override of `canFork`)
- Saved evaluations and auto-assignment UX
- Fork provenance display and navigation
