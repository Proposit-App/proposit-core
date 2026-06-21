# Sources Design

## Goal

Add **sources** as first-class, argument-scoped, checksummed entities that provide evidentiary support for propositional variables and expressions. Sources attach to variables (justifying truth value claims) and to expressions (most commonly operators, justifying the relationship between subtrees, but any expression type is permitted at the core level). Two separate association entity types make the attachment explicit in the type system.

A new `SourceManager` class owns all source and association state, shared by reference across engines — mirroring the `VariableManager` pattern. The engine generic signature expands from 4 to 5 type parameters. Sources participate fully in changesets, diffs, snapshots, reactive state, and validation.

A new `src/extensions/ieee/` subproject provides optional IEEE reference schemas ported from proposit-server.

## Core Data Model

### Source entity

`TCoreSource` — argument-scoped, minimal:

```typescript
interface TCoreSource {
    id: string // UUID
    argumentId: string // UUID
    argumentVersion: number
    checksum: string
}
```

Follows the `TCorePremise` pattern: no display/UX data. Extended via `additionalProperties` by consumers.

### Variable-source association

`TCoreVariableSourceAssociation` — links a source to a variable:

```typescript
interface TCoreVariableSourceAssociation {
    id: string // UUID — unique association ID
    sourceId: string // UUID
    variableId: string // UUID
    argumentId: string // UUID
    argumentVersion: number
    checksum: string
}
```

### Expression-source association

`TCoreExpressionSourceAssociation` — links a source to an expression within a premise:

```typescript
interface TCoreExpressionSourceAssociation {
    id: string // UUID — unique association ID
    sourceId: string // UUID
    expressionId: string // UUID
    premiseId: string // UUID — locates the expression's premise
    argumentId: string // UUID
    argumentVersion: number
    checksum: string
}
```

Association types are **not generic** — they are fixed-shape core types (like `TCoreArgumentRoleState`). They don't need extension since their fields are all internal IDs.

## SourceManager

`SourceManager<TSource extends TCoreSource = TCoreSource>` — a shared, argument-scoped dependency injected into `ArgumentEngine` and each `PremiseEngine`.

### Internal state

| State                           | Type                                                   | Purpose                                          |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------ |
| Sources map                     | `Map<sourceId, TSource>`                               | Source entities                                  |
| Variable associations map       | `Map<associationId, TCoreVariableSourceAssociation>`   | Variable-source links                            |
| Expression associations map     | `Map<associationId, TCoreExpressionSourceAssociation>` | Expression-source links                          |
| Source → associations index     | `Map<sourceId, Set<associationId>>`                    | Cascade: remove source → remove associations     |
| Variable → associations index   | `Map<variableId, Set<associationId>>`                  | Cascade: remove variable → remove associations   |
| Expression → associations index | `Map<expressionId, Set<associationId>>`                | Cascade: remove expression → remove associations |

### Mutation methods

- `addSource(source)` / `removeSource(sourceId)` — CRUD on source entities; remove cascades all associations
- `addVariableSourceAssociation(...)` / `removeVariableSourceAssociation(id)`
- `addExpressionSourceAssociation(...)` / `removeExpressionSourceAssociation(id)`
- `removeAssociationsForVariable(variableId)` — called during variable removal cascade
- `removeAssociationsForExpression(expressionId)` — called during expression removal cascade

All mutation methods return the removed/added entities so callers can build changesets. Methods that trigger orphan cleanup (`removeAssociationsForVariable`, `removeAssociationsForExpression`, `removeSource`) also return any orphaned sources that were deleted, so callers can include them in their changesets.

### Query methods

- `getSource(id)` / `getSources()` — retrieve source entities
- `getAssociationsForSource(sourceId)` — both association types
- `getAssociationsForVariable(variableId)` — variable associations only
- `getAssociationsForExpression(expressionId)` — expression associations only

### Orphan cleanup

After any association removal, `SourceManager` checks whether the source that owned the removed association(s) has zero remaining associations. If so, the source entity itself is deleted. The deleted orphan sources are included in the return value of the mutation method that triggered the cleanup, so callers can add them to their changesets.

### Checksum strategy

Following the `VariableManager` pattern, `SourceManager` does not compute checksums. `ArgumentEngine` attaches checksums to sources and associations before passing them to `SourceManager` for registration, using the existing `entityChecksum` utility and the engine's checksum config.

### Snapshot and restoration

`SourceManager` provides `snapshot()` and static `fromSnapshot()` methods, mirroring `VariableManager`:

```typescript
interface TSourceManagerSnapshot<TSource extends TCoreSource = TCoreSource> {
    sources: TSource[]
    variableSourceAssociations: TCoreVariableSourceAssociation[]
    expressionSourceAssociations: TCoreExpressionSourceAssociation[]
}
```

`snapshot()` serializes all internal state (sources + both association maps). `fromSnapshot()` reconstructs a `SourceManager` from this data, rebuilding all reverse indices. Used by `ArgumentEngine.snapshot()`, `rollback()`, and `fromSnapshot()`. Snapshot restoration is verbatim — no orphan cleanup or validation is performed during restoration. Invalid state (e.g., orphaned sources from corrupted snapshots) is surfaced by `validateEvaluability()`.

## Engine Integration

### ArgumentEngine

Gains:

- Owns the `SourceManager` instance, passes it by reference to each `PremiseEngine`
- New interface contract `TSourceManagement` exposing public source CRUD + association methods:
    - `addSource(source)` — registers source, returns mutation result with changeset
    - `removeSource(sourceId)` — removes source + cascades all associations, returns changeset
    - `addVariableSourceAssociation(sourceId, variableId)` — validates both exist, delegates to `SourceManager`
    - `addExpressionSourceAssociation(sourceId, expressionId, premiseId)` — validates source exists, delegates to `PremiseEngine` for expression validation, then to `SourceManager`
    - `removeVariableSourceAssociation(associationId)` / `removeExpressionSourceAssociation(associationId)`
    - `getSources()`, `getSource(id)`, `getAssociationsForVariable(id)`, `getAssociationsForExpression(id)`, `getAssociationsForSource(id)`

Extended cascades:

- `removeVariable()` — now also calls `sourceManager.removeAssociationsForVariable()` (which may cascade to orphaned source deletion)
- `removePremise()` — current implementation does not call `removeExpression()` individually; it iterates all expressions in the premise and removes each from the expression index, then discards the `PremiseEngine`. This iteration must be extended to also call `sourceManager.removeAssociationsForExpression()` for each expression before discarding the premise. Orphan source cleanup applies.

### PremiseEngine

Gains:

- Receives shared `SourceManager` reference via the constructor `deps` object (same pattern as `VariableManager`)
- Convenience method `addExpressionSourceAssociation(sourceId, expressionId)` — fills in its own `premiseId`, validates expression exists within this premise, delegates to `SourceManager`
- Convenience method `removeExpressionSourceAssociation(associationId)` — delegates to `SourceManager`
- Query convenience: `getSourceAssociationsForExpression(expressionId)` — delegates to `SourceManager`

Extended cascades:

- `removeExpression()` — for each expression actually removed during the cascade, calls `sourceManager.removeAssociationsForExpression(expressionId)` (which may cascade to orphaned source deletion)

## Generic Type Parameter

The engine generics expand from 4 to 5 type parameters:

| Class            | Type Parameters                          |
| ---------------- | ---------------------------------------- |
| `ArgumentEngine` | `<TArg, TPremise, TExpr, TVar, TSource>` |
| `PremiseEngine`  | `<TArg, TPremise, TExpr, TVar, TSource>` |
| `SourceManager`  | `<TSource>`                              |

All parameters have `extends BaseType = BaseType` defaults. `TSource extends TCoreSource = TCoreSource`.

`PremiseEngine` needs `TSource` because its mutation results (e.g., `removeExpression`) return changesets that may include orphaned source deletions in the `sources` category.

### Downstream generic types that gain `TSource`

- `TCoreChangeset<TExpr, TVar, TPremise, TArg, TSource>`
- `TCoreMutationResult<..., TSource>`
- `TCoreArgumentDiff<TArg, TVar, TPremise, TExpr, TSource>`
- `TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar, TSource>`
- `TReactiveSnapshot<...>`
- `TCoreDiffOptions<TArg, TVar, TPremise, TExpr, TSource>`
- `diffArguments<TArg, TPremise, TExpr, TVar, TSource>` (note: `diffArguments` has a pre-existing parameter ordering that differs from `TCoreArgumentDiff`; this is not introduced by this spec)

## Changeset Expansion

`TCoreChangeset` adds three new optional categories:

```typescript
interface TCoreChangeset<TExpr, TVar, TPremise, TArg, TSource> {
    // ... existing categories ...
    sources?: TCoreEntityChanges<TSource>
    variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>
    expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>
}
```

`ChangeCollector` (internal class that mirrors `TCoreChangeset`) gains `TSource` as a fifth type parameter and new accumulator methods: `addedSource`, `removedSource`, `addedVariableSourceAssociation`, `removedVariableSourceAssociation`, `addedExpressionSourceAssociation`, `removedExpressionSourceAssociation`.

## Diff Expansion

`TCoreArgumentDiff` adds:

```typescript
interface TCoreArgumentDiff<TArg, TVar, TPremise, TExpr, TSource> {
    // ... existing fields ...
    sources: TCoreEntitySetDiff<TSource>
    variableSourceAssociations: TCoreEntitySetDiff<TCoreVariableSourceAssociation>
    expressionSourceAssociations: TCoreEntitySetDiff<TCoreExpressionSourceAssociation>
}
```

`TCoreDiffOptions` adds:

- `compareSource` — default comparator: empty (no diffable fields on base source, same as premise)
- `compareVariableSourceAssociation` — default: compares `sourceId`, `variableId`
- `compareExpressionSourceAssociation` — default: compares `sourceId`, `expressionId`, `premiseId`

Note: Associations are **immutable** — they can be created or deleted, but not updated. There is no `updateAssociation` mutation path. The default comparators will therefore never produce changes for associations matched by ID. They are included for consumer extensibility (e.g., a consumer extending the association types with additional fields).

## Snapshot Expansion

`TArgumentEngineSnapshot` adds:

- `sources: TSource[]`
- `variableSourceAssociations: TCoreVariableSourceAssociation[]`
- `expressionSourceAssociations: TCoreExpressionSourceAssociation[]`

`TReactiveSnapshot` adds:

- `sources: Record<string, TSource>`
- `variableSourceAssociations: Record<string, TCoreVariableSourceAssociation>`
- `expressionSourceAssociations: Record<string, TCoreExpressionSourceAssociation>`

## Cascade Behavior

### `removeSource(sourceId)`

1. Delete all `TCoreVariableSourceAssociation` where `sourceId` matches
2. Delete all `TCoreExpressionSourceAssociation` where `sourceId` matches
3. Delete the source entity
4. Changeset includes removed source + all removed associations

### `removeVariable(variableId)` (extended)

1. Existing: cascade-delete referencing expressions with operator collapse. This transitively triggers expression-source association cleanup via the extended `removeExpression` cascade (see below).
2. New: delete _variable_-source associations for this variable (a separate concern from expression-source associations handled in step 1)
3. New: delete any source left with zero associations after both steps (orphan cleanup)
4. Changeset now also includes removed associations and orphaned sources from both steps

### `removeExpression(expressionId)` (extended)

1. Existing: remove expression, collapse operators, may recurse
2. New: for each expression actually removed, delete its expression-source associations
3. New: delete any source left with zero associations (orphan cleanup)
4. Changeset now also includes removed associations and orphaned sources

### `removePremise(premiseId)` (extended)

1. Existing: iterate all expressions in the premise, remove each from the expression index, then discard the `PremiseEngine`
2. New: during the expression iteration (before discarding), call `sourceManager.removeAssociationsForExpression()` for each expression
3. New: delete any source left with zero associations (orphan cleanup)
4. Changeset now also includes removed expression-source associations and orphaned sources

### Association removal → source lifecycle

Removing an association never directly deletes the source. But if the source has zero remaining associations after the removal, the source is deleted as an orphan. This is handled internally by `SourceManager`.

## Validation

New validation codes in `TCoreValidationResult`:

### Error-level (block evaluation)

- `SOURCE_VARIABLE_ASSOCIATION_INVALID_VARIABLE` — association references nonexistent variable
- `SOURCE_EXPRESSION_ASSOCIATION_INVALID_EXPRESSION` — association references nonexistent expression
- `SOURCE_EXPRESSION_ASSOCIATION_INVALID_PREMISE` — association references nonexistent premise

### Warning-level

- `SOURCE_ORPHANED` — source exists with zero associations

These should be unreachable during normal engine usage since mutation methods validate targets before creating associations and cascades clean up on removal. They guard against snapshot restoration or deserialization from corrupted state.

## CLI Extension

The CLI extends `CoreSourceSchema` with a required URL field:

```typescript
const CliSourceSchema = Type.Intersect([
    CoreSourceSchema,
    Type.Object({ url: Type.String() }),
])
```

### New CLI commands

Under `{argumentId}/{version}/sources/`:

| Command                                     | Description                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `add --url <url>`                           | Create a source                                                                                                     |
| `remove <sourceId>`                         | Delete a source by ID                                                                                               |
| `list`                                      | List all sources                                                                                                    |
| `link variable <sourceId> <variableId>`     | Create variable-source association                                                                                  |
| `link expression <sourceId> <expressionId>` | Create expression-source association (premise resolved via expression index lookup; errors if expression not found) |
| `unlink <associationId>`                    | Remove an association                                                                                               |
| `show <sourceId>`                           | Display source and its associations                                                                                 |

### CLI storage

Inside the version directory:

```
{version}/
├── sources/
│   ├── {sourceId}/
│   │   └── meta.json                    # Source entity (core fields + url)
│   ├── variable-associations.json       # TCoreVariableSourceAssociation[]
│   └── expression-associations.json     # TCoreExpressionSourceAssociation[]
```

Association files are arrays of their respective association types, stored at the sources directory level (not per-source). Both files are rewritten on any association change. This keeps the two association types cleanly separated and easy to inspect.

## Extensions Subproject

New directory: `src/extensions/ieee/`

- Separate TypeScript build target (its own `tsconfig` extending the base)
- Exports `IEEEReferenceSchema` and all 33 reference type schemas, ported from proposit-server
- Exports `IEEESourceSchema` extending `CoreSourceSchema` with `{ url: Nullable(string), citation: IEEEReferenceSchema }`
- Importable separately (e.g., `@polintpro/proposit-core/extensions/ieee`)
