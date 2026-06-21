# Persistence Utilities Design

**Date:** 2026-03-28
**Scope:** Core changeset utilities, ordered changeset for persistence, stale ancestor checksum bug fix

## Motivation

Consumers of `proposit-core` that persist argument data (to a database, filesystem, etc.) must currently write substantial boilerplate:

- **Changeset merging** when a logical operation triggers multiple engine calls (e.g., create premise + set conclusion role). The `proposit-server` has written this function twice with slightly different semantics.
- **FK-safe operation ordering** for persisting changesets to relational stores. Deletes must run in reverse FK order (expressions, variables, premises), inserts in forward order (premises, variables, expressions), and inserted expressions must be topologically sorted so parents precede children. This is ~130 lines in `proposit-server`.
- **Library lookup construction** from arrays of claims/sources. Every consumer writes the same `Map`-based adapter.
- **Empty lookup constants** for libraries that aren't in use.

Additionally, a bug in the engine's changeset emission causes ancestor expression checksums to be omitted after `addExpression` / `appendExpression` operations. The server works around this with a manual parent-chain walk, but any consumer using changesets for persistence would hit the same problem.

## Design

### 1. `mergeChangesets(a, b) -> TCoreChangeset`

Merges two changesets into one. For each entity category (`expressions`, `variables`, `premises`):

- Deduplicates by `id` within each bucket (`added`, `modified`, `removed`), with the second changeset's data winning.
- **Invariant:** After merge, no entity ID may appear in more than one bucket within the same category. If an entity ID appears in e.g. `added` and `removed` across the two inputs, the function throws an error. This surfaces logic bugs rather than silently reconciling conflicting states.
- For `roles`: takes `b` if present, else `a`.
- For `argument`: takes `b` if present, else `a`.

**Location:** `src/lib/utils/changeset.ts`

**Signature:**

```ts
function mergeChangesets<
    TExpr extends TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable,
    TPremise extends TCorePremise,
    TArg extends TCoreArgument,
>(
    a: TCoreChangeset<TExpr, TVar, TPremise, TArg>,
    b: TCoreChangeset<TExpr, TVar, TPremise, TArg>
): TCoreChangeset<TExpr, TVar, TPremise, TArg>
```

**JSDoc:** See Documentation Requirements.

### 2. `orderChangeset(changeset) -> TOrderedOperation[]`

Takes a `TCoreChangeset` and returns a flat array of tagged operations in an order that is safe to execute sequentially against a relational store with foreign key constraints.

**Ordering guarantees:**

The entities in a `proposit-core` argument form a dependency chain: **premises** own **expressions** (via `premiseId`), and **expressions** reference **variables** (via `variableId`). Expressions also form a parent-child tree (via `parentId`). This creates FK constraints that dictate safe operation ordering:

1. **Update premises** — run first so that premise rows exist with correct metadata before expression deletes cascade.
2. **Delete expressions** — before variables and premises, because expression rows hold FKs to both.
3. **Delete variables** — after expression deletes (expressions referencing deleted variables are already gone).
4. **Delete premises** — last in the delete phase (child rows are already removed).
5. **Insert premises** — first in the insert phase (new expressions and variables need their premise row to exist).
6. **Insert variables** — before expressions (new variable-type expressions reference variable rows).
7. **Insert expressions** — last in the insert phase, topologically sorted so that parent expressions are inserted before their children (satisfies the `parentId` FK).
8. **Update variables** — order relative to expression updates doesn't matter; grouped here for clarity.
9. **Update expressions** — checksum and position updates.
10. **Update argument metadata** — if present.
11. **Update role state** — if present.

**Tagged union type:**

```ts
type TOrderedOperation<TExpr, TVar, TPremise, TArg> =
    | { type: "delete"; entity: "expression"; data: TExpr }
    | { type: "delete"; entity: "variable"; data: TVar }
    | { type: "delete"; entity: "premise"; data: TPremise }
    | { type: "insert"; entity: "premise"; data: TPremise }
    | { type: "insert"; entity: "variable"; data: TVar }
    | { type: "insert"; entity: "expression"; data: TExpr }
    | { type: "update"; entity: "expression"; data: TExpr }
    | { type: "update"; entity: "variable"; data: TVar }
    | { type: "update"; entity: "premise"; data: TPremise }
    | { type: "update"; entity: "argument"; data: TArg }
    | { type: "update"; entity: "roles"; data: TCoreArgumentRoleState }
```

**Location:** `src/lib/utils/changeset.ts`, alongside `mergeChangesets`.

**Code comments and CLAUDE.md:** See Documentation Requirements.

### 3. `createLookup(items, getKey) -> { get(id, version) }`

Generic factory for building `TClaimLookup` or `TSourceLookup` from an array. Items are indexed by a composite `"id:version"` key internally, and the returned object exposes the standard `get(id, version)` interface:

```ts
function createLookup<T>(
    items: T[],
    getKey: (item: T) => string
): { get(id: string, version: number): T | undefined }
```

The `getKey` function must return a string of the form `"id:version"`. The returned `get(id, version)` method builds the same composite key internally to perform the lookup.

Usage:

```ts
const claimLookup = createLookup(claims, (c) => `${c.id}:${c.version}`)
const sourceLookup = createLookup(sources, (s) => `${s.id}:${s.version}`)
```

**Location:** `src/lib/utils/lookup.ts`

### 4. Empty Lookup Constants

Pre-built no-op implementations for when a library isn't in use:

```ts
const EMPTY_CLAIM_LOOKUP: TClaimLookup = { get: () => undefined }
const EMPTY_SOURCE_LOOKUP: TSourceLookup = { get: () => undefined }
const EMPTY_CLAIM_SOURCE_LOOKUP: TClaimSourceLookup = {
    getForClaim: () => [],
    getForSource: () => [],
    get: () => undefined,
}
```

**Location:** `src/lib/utils/lookup.ts`

### 5. Bug Fix: Stale Ancestor Checksums in Changesets

**Problem:** When `addExpression`, `appendExpression`, or `addExpressionRelative` are called, the checksum flush propagates dirty flags up the ancestor chain. However, ancestor expressions whose `checksum`, `descendantChecksum`, or `combinedChecksum` changed during the flush are not emitted in the changeset's `expressions.modified` array.

**Impact:** Any consumer persisting changesets to a database will have stale checksums for ancestor expressions. The `proposit-server` works around this with a manual parent-chain walk after every expression creation.

**Fix:** In the checksum flush logic, ensure that any expression whose checksum fields changed during flush is added to the changeset's `modified` list. The fix should be localized to the code path that propagates checksums up the expression tree after mutation.

## Documentation Requirements

1. **Every exported function and constant** must have a full JSDoc docstring with `@param`, `@returns`, `@throws` (where applicable), and `@example` (where illustrative).
2. **`orderChangeset` code comments:** The implementation must have inline comments on each phase of the ordering explaining _why_ that phase appears in its position, referencing the FK dependency chain. This is critical for preventing accidental reordering in future refactors.
3. **CLAUDE.md design rule:** Add an entry to the "Key design rules" section documenting the `orderChangeset` operation ordering as an invariant. Any future work that would change entity relationships or add new entity types must preserve or extend this ordering. Planned changes that would violate this guarantee must be flagged to the user before implementation.
4. **`mergeChangesets` example:** The JSDoc must include an `@example` showing a concrete use case (e.g., merging the changeset from `createPremiseWithId` with the changeset from `setConclusionPremise`).

## Testing

- `mergeChangesets`: dedup semantics, cross-bucket collision throws, roles/argument merge, undefined categories.
- `orderChangeset`: verify FK-safe ordering for each operation type, topological sort of inserted expressions, empty changeset, changeset with only deletes/only inserts.
- `createLookup`: basic get, missing key returns undefined.
- Empty lookups: verify return values.
- Stale ancestor checksum fix: add an expression with a deep ancestor chain, verify all ancestors appear in the changeset's modified list with correct checksums.

## Exports

All new functions and types are exported from `src/lib/index.ts`:

- `mergeChangesets`
- `orderChangeset`
- `TOrderedOperation`
- `createLookup`
- `EMPTY_CLAIM_LOOKUP`
- `EMPTY_SOURCE_LOOKUP`
- `EMPTY_CLAIM_SOURCE_LOOKUP`
