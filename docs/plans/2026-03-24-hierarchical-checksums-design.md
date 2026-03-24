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
  checksum: string                    // meta — entity's own data only
  descendantChecksum: string | null   // direct children's combinedChecksums
  combinedChecksum: string            // hash(checksum + descendantChecksum)
}
```

- **`checksum`** (meta): derived from entity fields via `entityChecksum()` and
  `checksumConfig`, exactly as today.
- **`descendantChecksum`**: derived from direct children's `combinedChecksum`
  values. `null` for leaf expressions (no children). Because each child's
  `combinedChecksum` recursively includes its own descendants, a change at any
  depth propagates upward.
- **`combinedChecksum`**: a single hash of `checksum` and `descendantChecksum`.
  For leaves where `descendantChecksum` is `null`, `combinedChecksum` equals
  `checksum`.

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

- **`premises`**: `computeHash(canonicalSerialize({ [premiseId]: premise.combinedChecksum, ... }))`.
- **`variables`**: `computeHash(canonicalSerialize({ [varId]: variable.checksum, ... }))`.
- **`expressions`**: the root expression's `combinedChecksum`. Since each
  expression's `combinedChecksum` recursively captures its subtree, the root
  expression's value represents the entire AST.

### Relationship to Descendant Checksum

- Argument `descendantChecksum` =
  `computeHash(canonicalSerialize({ premises: premisesCollectionChecksum, variables: variablesCollectionChecksum }))`.
- Premise `descendantChecksum` = the expressions collection checksum (root
  expression's `combinedChecksum`).

Collection checksums are cached and invalidated by the same dirty-flag
mechanism as entity checksums.

## Dirty Propagation and Flush

### Dirty Marking

When a mutation occurs, the affected entity and all ancestors are marked dirty:

- **Expression mutation** (add/remove/update): mark the expression dirty, walk
  `parentId` chain marking each ancestor expression dirty, mark the owning
  premise dirty, mark the argument dirty.
- **Variable mutation** (add/remove/update/bind): mark the argument dirty.
- **Premise mutation** (create/remove): mark the argument dirty.
- **Role state change**: mark the argument dirty.

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

### Flush Points

- `snapshot()` / `buildReactiveSnapshot()`
- `checksum()` / `combinedChecksum()` / `descendantChecksum()` accessors
- Serialization and sync boundaries
- `publish()`

## `checksumConfig` Changes

`TCoreChecksumConfig` is unchanged in structure. It continues to control which
fields feed into the **meta checksum** (`checksum`) only.

`roleFields` now contributes to the argument's meta checksum rather than being
a separate entry in a composite checksum map.

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
interface THierarchicalChecksummable {
  checksum(): string
  descendantChecksum(): string | null
  combinedChecksum(): string
  getCollectionChecksum(name: string): string
  flushChecksums(): void
}
```

`ArgumentEngine` and `PremiseEngine` implement this. Expression checksums are
stored on the entity objects and recomputed during flush by `ExpressionManager`.

### `TOptionalHierarchicalChecksum<T>`

```typescript
type TOptionalHierarchicalChecksum<T extends {
  checksum?: unknown
  descendantChecksum?: unknown
  combinedChecksum?: unknown
}> = Omit<T, "checksum" | "descendantChecksum" | "combinedChecksum"> &
  Partial<Pick<T, "checksum" | "descendantChecksum" | "combinedChecksum">>
```

Replaces `TOptionalChecksum<T>` for hierarchical entities. `TOptionalChecksum`
remains for variables and other non-hierarchical types.

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
- **`"strict"`**: recompute checksums, compare against stored values, throw on
  mismatch. The error includes which entity mismatched and the stored vs.
  computed values.

This option is added to the existing options parameter accepted by
`fromSnapshot` and `fromData`.

## Breaking Changes

### Removed

- `TChecksummable` interface (replaced by `THierarchicalChecksummable`).
- `ArgumentEngine.checksum()` returning a single composite hash.
- `PremiseEngine.checksum()` returning a single composite hash.
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
