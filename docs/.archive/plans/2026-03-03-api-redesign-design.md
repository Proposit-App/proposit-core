# API Redesign for Dual-Instance Synchronization

## Context

The primary consumer of proposit-core is a web application with:

- A **browser instance** of `ArgumentEngine` for optimistic UI rendering
- A **server instance** of `ArgumentEngine` for authoritative state + Postgres persistence

The Postgres database uses **normalized tables** — separate rows for arguments, premises, expressions, variables, and roles.

The synchronization model is **optimistic, server-authoritative replace**: the client applies mutations for fast rendering, but always adopts the server's response as the source of truth. Checksums detect drift; when they don't match, the client re-syncs from the server.

IDs are **server-authoritative** — the server generates all entity IDs.

## Requirements

1. **Determinism**: Given the same input data, both instances produce identical behavior — ordering, collapse effects, position computation, etc.
2. **Easy state access**: A current representation of the whole argument is available at any time (already largely there via getters).
3. **Entity-typed changesets**: Every mutating method returns the direct result plus a changeset of all affected entities, typed by entity category, so the caller knows exactly which DB rows to INSERT/UPDATE/DELETE.
4. **Per-entity checksums**: Each entity has a checksum for fast sync detection. Aggregate checksums at the premise and argument level for hierarchical comparison.

## Approach

Mutation result augmentation (Approach 1 from brainstorming). Keep the current class hierarchy. Augment each mutating public method to return `{ result, changes }`. Track changes via an internal `ChangeCollector` that internal helpers record to during a mutation.

## Design

### Changeset Types

```typescript
interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[] // contains new state after modification
    removed: T[]
}

interface TCoreChangeset {
    // Present only when the category was affected
    expressions?: TCoreEntityChanges<TCorePropositionalExpression>
    variables?: TCoreEntityChanges<TCorePropositionalVariable>
    premises?: TCoreEntityChanges<TCorePremise>
    roles?: TCoreArgumentRoleState // new state, only when changed
    argument?: TCoreArgument // new state, only when changed
}

interface TCoreMutationResult<T> {
    result: T
    changes: TCoreChangeset
}
```

- Optional fields in `TCoreChangeset` — absence means the category was untouched.
- `modified` contains new state only — the caller had the old state before calling the mutation.
- `roles` and `argument` are singletons, so they're the new state rather than added/modified/removed.

### Method-by-Method Return Types

**PremiseManager** (all mutating methods):

| Method                                     | Current return            | New return                                                       |
| ------------------------------------------ | ------------------------- | ---------------------------------------------------------------- |
| `addVariable(v)`                           | `void`                    | `TCoreMutationResult<TCorePropositionalVariable>`                |
| `removeVariable(id)`                       | `variable \| undefined`   | `TCoreMutationResult<TCorePropositionalVariable \| undefined>`   |
| `addExpression(e)`                         | `void`                    | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `appendExpression(parentId, e)`            | `void`                    | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `addExpressionRelative(siblingId, pos, e)` | `void`                    | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `removeExpression(id)`                     | `expression \| undefined` | `TCoreMutationResult<TCorePropositionalExpression \| undefined>` |
| `insertExpression(e, left?, right?)`       | `void`                    | `TCoreMutationResult<TCorePropositionalExpression>`              |
| `setExtras(extras)`                        | `void`                    | `TCoreMutationResult<Record<string, unknown>>`                   |

**ArgumentEngine** (all mutating methods):

| Method                             | Current return   | New return                                    |
| ---------------------------------- | ---------------- | --------------------------------------------- |
| `createPremise(extras?)`           | `PremiseManager` | `TCoreMutationResult<PremiseManager>`         |
| `createPremiseWithId(id, extras?)` | `PremiseManager` | `TCoreMutationResult<PremiseManager>`         |
| `removePremise(id)`                | `void`           | `TCoreMutationResult<TCorePremise>`           |
| `setConclusionPremise(id)`         | `void`           | `TCoreMutationResult<TCoreArgumentRoleState>` |
| `clearConclusionPremise()`         | `void`           | `TCoreMutationResult<TCoreArgumentRoleState>` |

`removePremise` returns the removed premise's data (via `toData()`) as `result`.

### Internal Change Collection

A lightweight `ChangeCollector` class scoped to a single public method call:

```typescript
class ChangeCollector {
    addedExpression(expr: TCorePropositionalExpression): void
    modifiedExpression(expr: TCorePropositionalExpression): void
    removedExpression(expr: TCorePropositionalExpression): void
    addedVariable(variable: TCorePropositionalVariable): void
    // ... same pattern for other entity types
    toChangeset(): TCoreChangeset // returns only non-empty categories
}
```

Each public mutating method creates a `ChangeCollector`, makes it available to internal helpers (`collapseIfNeeded`, `reparent`, etc.) for the duration of the call, then wraps the result:

```
public removeExpression(id) {
  collector = new ChangeCollector()
  // Internal helpers record to collector during collapse/reparent
  result = internal remove logic
  return { result, changes: collector.toChangeset() }
}
```

`PremiseManager` owns `ExpressionManager` and `VariableManager`, so it controls the collector lifetime. `ArgumentEngine` does the same when its mutations cascade into premise-level changes.

`ChangeCollector` is internal — not exported in the public API.

### Checksum System

**Scope**: An entity's checksum is computed solely from its own fields — not its children or related entities. A parent expression's checksum does not change when children are added/removed beneath it.

**Granularity** (hierarchical):

- Entity-level: each expression, variable, premise metadata, role state, argument metadata
- Premise-level: combines its entity checksums
- Argument-level: combines all premise checksums + role state checksum + argument metadata checksum

**Computation**:

- Deterministic serialization with sorted JSON keys
- Fast non-cryptographic hash (e.g., FNV-1a) — sync detection, not security
- Browser-compatible, no Node.js-only dependencies

**Lazy evaluation**:

- Mutations mark affected checksums as dirty
- Checksums are recomputed only when read
- Aggregate checksums are also lazy — dirty if any child is dirty
- Avoids wasted work during batch operations (hydration, bulk mutations)

**Configurable fields**: The fields used to compute each entity type's checksum are configurable, defaulting to the current schema fields:

```typescript
interface TCoreChecksumConfig {
  expressionFields?: (keyof TCorePropositionalExpression)[]
  variableFields?: (keyof TCorePropositionalVariable)[]
  premiseFields?: string[]
  argumentFields?: string[]
}

// Passed at engine construction
new ArgumentEngine(argument, { checksumConfig: { ... } })
```

This lets consumers include custom fields (e.g., DB-specific metadata) in the checksum calculation.

**Entity integration**: Entity types gain an optional `checksum?: string` field. The engine populates it on any entity it returns (getters, changesets).

**Public API**:

```typescript
premise.checksum(): string    // premise-level aggregate
engine.checksum(): string     // argument-level aggregate
```

### Role State Simplification

**`TCoreArgumentRoleState`** shrinks to:

```typescript
{ conclusionPremiseId?: string }
```

Supporting premises are **derived, not stored**: any inference premise (`implies`/`iff` root) that isn't the conclusion is supporting. Any non-inference premise is a constraint.

**Methods removed from `ArgumentEngine`**:

- `addSupportingPremise()`
- `removeSupportingPremise()`

**`listSupportingPremises()`** remains as a public method — it's still useful, but computed rather than stored.

**Downstream impact**:

- `evaluate()` and `checkValidity()` use the derived list internally
- CLI: `roles add-support` and `roles remove-support` commands removed
- CLI storage: `roles.json` shrinks to just conclusion
- Hydration: no longer reads/writes supporting IDs

### Determinism Guarantees

1. **Collection ordering**: Any array derived from `Map` values must be explicitly sorted (by ID, lexicographic). Never rely on insertion order.
2. **Position computation**: Already deterministic (midpoint math).
3. **Operator collapse**: Deterministic algorithm — 0 children -> delete, 1 child -> promote.
4. **ID generation**: Server-authoritative — the client uses `createPremiseWithId()` with server-provided IDs.
5. **Checksum computation**: Deterministic serialization (sorted keys) ensures both instances produce the same hash.

### Unchanged (Read-Only, No Changeset)

- All getters (`getPremise`, `getExpression`, `listPremises`, `getRoleState`, etc.)
- `evaluate()`, `checkValidity()`, `validateEvaluability()`
- `toData()`, `exportState()`, `toDisplayString()`
- Standalone functions (`diffArguments`, `analyzePremiseRelationships`, `buildPremiseProfile`, `parseFormula`)

### Documentation Updates

After all code changes, update:

- `README.md` — new API, concepts (changesets, checksums, derived roles)
- `CLAUDE.md` — architecture, type descriptions, method signatures
- CLI examples documentation — reflect removed commands and new role behavior
