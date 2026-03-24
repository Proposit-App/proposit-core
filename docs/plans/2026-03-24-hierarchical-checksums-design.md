# Hierarchical Checksums Design

## Motivation

Optimistic UI updates and collaborative argument editing both require
comprehensive change detection. The current checksum system stores a single
entity-only hash per object. There is no structured way to determine whether an
entity's own data changed, a descendant changed, or both. This design introduces
a three-pronged checksum model that makes those distinctions explicit at every
level of the hierarchy.

## Entity Checksum Shape

Every hierarchical entity (expression, premise, argument) carries three
checksum fields:

```typescript
interface THierarchicalChecksum {
    checksum: string // meta — entity's own data only
    descendantChecksum: string | null // direct children's combinedChecksums
    combinedChecksum: string // hash(checksum + descendantChecksum)
}
```

- **`checksum`** (meta): derived from entity fields via `entityChecksum()` and
  `checksumConfig`, exactly as today.
- **`descendantChecksum`**: derived from direct children's `combinedChecksum`
  values. `null` when the entity has no children (leaf expressions, empty
  premises with no expression tree, arguments with no premises and no
  variables). Because each child's `combinedChecksum` recursively includes its
  own descendants, a change at any depth propagates upward.
- **`combinedChecksum`**: when `descendantChecksum` is `null`,
  `combinedChecksum` equals `checksum` directly (no additional hashing).
  Otherwise, `combinedChecksum` = `computeHash(checksum + descendantChecksum)`.

**Variables** are non-hierarchical. They retain a single `checksum` field with
no descendant or combined checksums.

**Role state** (`conclusionPremiseId`) is folded into the argument's meta
checksum. The argument's `checksum` is derived from both `argumentFields` and
`roleFields`.

## Collection Checksums

Each engine exposes per-collection checksums via a method:

```typescript
// ArgumentEngine
getCollectionChecksum(name: "premises" | "variables"): string

// PremiseEngine
getCollectionChecksum(name: "expressions"): string
```

### Computation

All collection checksums use ID-keyed maps to ensure deterministic ordering via
`canonicalSerialize` (which sorts keys). This makes checksums sensitive to
member identity, not just structure.

- **`premises`**: `computeHash(canonicalSerialize({ [premiseId]: premise.combinedChecksum, ... }))`.
  Empty collection: `null` (no premises to hash).
- **`variables`**: `computeHash(canonicalSerialize({ [varId]: variable.checksum, ... }))`.
  Empty collection: `null` (no variables to hash).
- **`expressions`**: the root expression's `combinedChecksum`. Since each
  expression's `combinedChecksum` recursively captures its subtree, the root
  expression's value represents the entire AST. Empty (no root expression):
  `null`.

### Relationship to Descendant Checksum

- Argument `descendantChecksum` =
  `computeHash(canonicalSerialize({ premises: premisesCollectionChecksum, variables: variablesCollectionChecksum }))`.
  Null collection checksums are **excluded** from the map (not included as
  `null` values). If all collection checksums are `null` (no premises and no
  variables), the argument's `descendantChecksum` is `null`.
- Premise `descendantChecksum` = the expressions collection checksum (root
  expression's `combinedChecksum`). `null` if the premise has no expression tree.

Collection checksums are cached and invalidated by the same dirty-flag
mechanism as entity checksums.

## Expression Descendant Checksum Computation

An expression's `descendantChecksum` is derived from its direct children's
`combinedChecksum` values using an ID-keyed map, consistent with collection
checksums:

```
descendantChecksum = computeHash(canonicalSerialize({
  [child1.id]: child1.combinedChecksum,
  [child2.id]: child2.combinedChecksum,
  ...
}))
```

Using IDs as keys (rather than position-ordered arrays) ensures that the
checksum is sensitive to child identity and that `canonicalSerialize` produces
deterministic output via key sorting. If the expression has no children,
`descendantChecksum` is `null`.

## Dirty Propagation and Flush

### Dirty Marking

When a mutation occurs, the affected entity and all ancestors are marked dirty:

- **Expression mutation** (add/remove/update): mark the expression dirty, walk
  `parentId` chain marking each ancestor expression dirty, mark the owning
  premise dirty, mark the argument dirty.
- **Variable mutation** (add/remove/update/bind): mark the argument dirty.
- **Premise mutation** (create/remove): mark the argument dirty.
- **Role state change**: mark the argument dirty.

**Compound mutations:** Some operations trigger cascading structural changes:

- **`removeExpression` with operator collapse**: when removal causes an
  operator/formula to collapse (0 children → delete, 1 child → promote),
  collapsed expressions are removed from the dirty set since they no longer
  exist. Promoted children are marked dirty (their `parentId` changed). The
  ancestor chain from the collapse point upward is marked dirty.
- **`insertExpression` with reparenting**: reparenting changes multiple
  expressions' `parentId` fields. All reparented expressions are marked dirty,
  plus the ancestor chains of both the old and new parents.

In both cases the dirty set is reconciled after the structural mutation
completes — IDs of deleted expressions are pruned from `dirtyExpressionIds`.

After a flush completes, `dirtyExpressionIds` is cleared (and premise/argument
dirty flags are reset), consistent with the current dirty-flag caching pattern.

Dirty flags live on the engine, not the entity:

```typescript
// ExpressionManager
private dirtyExpressionIds: Set<string>

// PremiseEngine
private checksumDirty: boolean

// ArgumentEngine
private checksumDirty: boolean
```

### Flush (Recomputation)

Triggered explicitly by `flushChecksums()` or implicitly by accessing any
checksum property. Recomputation proceeds bottom-up:

1. **Dirty expressions**: recompute in leaf-to-root order. For each: compute
   `checksum` from entity fields, `descendantChecksum` from direct children's
   `combinedChecksum` values, `combinedChecksum` from the two.
2. **Dirty premises**: recompute premise `checksum` from entity fields,
   `descendantChecksum` from root expression's `combinedChecksum`,
   `combinedChecksum` from the two. Recompute expressions collection checksum.
3. **Dirty argument**: recompute argument `checksum` from entity fields + role
   state, `descendantChecksum` from collection checksums (premises, variables),
   `combinedChecksum` from the two.

### Expression Checksum Timing

Today, `ExpressionManager.attachChecksum()` eagerly computes the meta checksum
at add time. This continues for the meta `checksum` field — it is always correct
immediately since it depends only on entity data.

`descendantChecksum` and `combinedChecksum` are **not** set eagerly. Leaf
expressions are initialized with `descendantChecksum: null` and
`combinedChecksum` equal to their meta `checksum` (since these values are
deterministically correct for leaves). Non-leaf expressions are initialized with
stale placeholders (`descendantChecksum: ""`, `combinedChecksum: ""`) and only
become correct after `flushChecksums()`. This avoids wasted computation during
mutation bursts (e.g., building an expression tree by adding nodes one at a
time — each node's `descendantChecksum` would be immediately invalidated as
children are added).

**Changeset implications:** `ChangeCollector` emits expression entities as they
are mutated. Expressions in changesets carry the correct meta `checksum` but may
have stale `descendantChecksum` and `combinedChecksum` values. Consumers that
need accurate hierarchical checksums should read them from the engine after
flush, not from changeset entities.

### `flushChecksums()` vs Accessor-Triggered Flush

Both `flushChecksums()` and the checksum accessors (`checksum()`,
`combinedChecksum()`, `descendantChecksum()`) trigger a flush. `flushChecksums()`
exists as a batch optimization — calling it once before reading multiple checksum
properties avoids repeated dirty checks. The accessor path is the primary
convenience API; `flushChecksums()` is for explicit control at sync boundaries.

### Flush Points

- `snapshot()` / `buildReactiveSnapshot()`
- `checksum()` / `combinedChecksum()` / `descendantChecksum()` accessors
- Serialization and sync boundaries
- `publish()`

## `checksumConfig` Changes

`TCoreChecksumConfig` is unchanged in structure. It continues to control which
fields feed into the **meta checksum** (`checksum`) only.

`roleFields` remains a separate key in `TCoreChecksumConfig` for clarity, but
at computation time the argument's meta checksum merges `argumentFields` and
`roleFields` into a single entity checksum. This replaces the previous approach
where role state was a separate entry in the composite checksum map.

`checksumConfig` does **not** control:

- `descendantChecksum` — always derived from children's `combinedChecksum`
  values. Fixed recursive formula.
- `combinedChecksum` — always `computeHash(checksum + descendantChecksum)`.
- Collection checksums — always derived from member
  `combinedChecksum`/`checksum` values.

The existing `entityChecksum()` utility remains the workhorse for meta
checksums. Descendant and combined checksums use `computeHash()` and
`canonicalSerialize()` directly.

## Interface Changes

### `THierarchicalChecksummable`

Replaces the existing `TChecksummable` interface:

```typescript
interface THierarchicalChecksummable<TCollectionName extends string = string> {
    checksum(): string
    descendantChecksum(): string | null
    combinedChecksum(): string
    getCollectionChecksum(name: TCollectionName): string | null
    flushChecksums(): void
}
```

`ArgumentEngine` implements `THierarchicalChecksummable<"premises" | "variables">`.
`PremiseEngine` implements `THierarchicalChecksummable<"expressions">`.

`ArgumentEngine` and `PremiseEngine` implement this. Expression checksums are
stored on the entity objects and recomputed during flush by `ExpressionManager`.

### `TOptionalHierarchicalChecksum<T>`

```typescript
type TOptionalHierarchicalChecksum<
    T extends {
        checksum: unknown
        descendantChecksum: unknown
        combinedChecksum: unknown
    },
> = Omit<T, "checksum" | "descendantChecksum" | "combinedChecksum"> &
    Partial<Pick<T, "checksum" | "descendantChecksum" | "combinedChecksum">>
```

The constraint requires all three fields to exist (non-optional) on the input
type `T`. The utility then makes them optional on the output type so callers
can pass entities without checksums.

Replaces `TOptionalChecksum<T>` for hierarchical entities. `TOptionalChecksum`
remains for variables and other non-hierarchical types.

### Input Types

`TExpressionInput<TExpr>` and `TExpressionWithoutPosition<TExpr>` must omit
all three checksum fields since they are engine-computed, not caller-provided:

```typescript
type TExpressionInput<TExpr> = Omit<
    TExpr,
    "checksum" | "descendantChecksum" | "combinedChecksum"
>
type TExpressionWithoutPosition<TExpr> = Omit<
    TExpr,
    "position" | "checksum" | "descendantChecksum" | "combinedChecksum"
>
```

The same applies to any other input/creation types that strip computed fields.

### Snapshot Types

`TReactiveSnapshot` and `TReactivePremiseSnapshot` require no structural
changes. The entities they carry now include the three checksum fields instead
of one.

## Schema Changes

### Expression Schema

Add two fields:

```typescript
descendantChecksum: Type.Union([Type.String(), Type.Null()])
combinedChecksum: Type.String()
```

### Premise Schema

Add two fields (same as expression).

### Argument Schema

Add two fields (same as expression).

### Variable Schema

Unchanged. Single `checksum` field.

### CLI Disk Schemas

CLI-extended schemas inherit the new fields from core schemas. YAML/JSON
serialization includes `descendantChecksum` and `combinedChecksum` on
expressions, premises, and arguments.

## Snapshot Restoration and Checksum Verification

`fromSnapshot` and `fromData` always recompute checksums on load. Stored
checksum values are not trusted as a source of truth.

A new option controls verification of stored values against computed values:

```typescript
type TChecksumVerification = "ignore" | "strict"
```

- **`"ignore"`** (default): recompute checksums, discard stored values. Current
  behavior.
- **`"strict"`**: recompute checksums, compare all three fields (`checksum`,
  `descendantChecksum`, `combinedChecksum`) against stored values, throw on
  mismatch. The error includes which entity mismatched, which field(s), and the
  stored vs. computed values.

This option is added to the existing options parameter accepted by
`fromSnapshot` and `fromData`.

## Diff System

The diff comparators (`defaultCompareExpression`, `defaultComparePremise`,
`defaultCompareArgument`) should **not** compare `descendantChecksum` or
`combinedChecksum`. These are derived values — if the underlying data differs,
the diff will detect it through the structural comparison. Including derived
checksums would produce redundant diff entries.

The diff system continues to use the entity's meta `checksum` field as it does
today (if it appears in the compared fields at all).

## Reactive Dirty Tracking

The existing `reactiveDirty` system (used by `buildReactiveSnapshot`) and the
new checksum dirty system remain **independent**. They track different concerns:
`reactiveDirty` drives which parts of the reactive snapshot need rebuilding;
checksum dirty flags drive which checksums need recomputation. A mutation marks
both systems dirty, but they flush independently.

## `VariableManager`

`VariableManager` is unchanged beyond stripping `descendantChecksum` and
`combinedChecksum` if they appear on incoming variable entities (defensive).
Variables remain non-hierarchical with a single `checksum` field.

## Breaking Changes

### Removed

- `TChecksummable` interface (replaced by `THierarchicalChecksummable`).
- `ArgumentEngine.checksum()` returning a single composite hash. Today this
  method conflates entity and descendant data into one hash. Callers relying on
  it to detect expression/premise changes must switch to `combinedChecksum()`.
- `PremiseEngine.checksum()` returning a single composite hash. Same as above —
  today it mixes premise entity data with expression checksums.
- `TOptionalChecksum<T>` for hierarchical entities (replaced by
  `TOptionalHierarchicalChecksum<T>`).

### Changed

- Entity `.checksum` field semantics: now consistently means meta checksum
  everywhere.
- Expression entities gain `descendantChecksum` and `combinedChecksum` fields.
- Premise entities gain `descendantChecksum` and `combinedChecksum` fields.
- Argument entities gain `descendantChecksum` and `combinedChecksum` fields.
- `fromSnapshot` / `fromData` accept `checksumVerification?: "ignore" | "strict"`.
- Role state contributes to argument meta checksum instead of being a separate
  composite entry.

### Unchanged

- `entityChecksum()`, `computeHash()`, `canonicalSerialize()` utilities.
- `TCoreChecksumConfig` structure and field sets.
- Variable checksum (single `checksum` field).
- `TOptionalChecksum<T>` for non-hierarchical entities.

This is a breaking change acceptable at the current 0.x semver range.
