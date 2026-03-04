# Migrating to proposit-core 0.2.0

This release redesigns the public API to support dual-instance synchronization (e.g., a browser instance for optimistic UI rendering alongside a server instance for authoritative state). The changes fall into four areas: mutation results, role state simplification, checksums, and new exports.

## Breaking changes at a glance

| Area                         | What changed                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| All mutating methods         | Return `TCoreMutationResult<T>` instead of the bare value                          |
| `TCoreArgumentRoleState`     | `supportingPremiseIds` removed; supporting premises are now derived                |
| `addSupportingPremise()`     | Removed                                                                            |
| `removeSupportingPremise()`  | Removed                                                                            |
| Validation codes             | `ARGUMENT_SUPPORTING_PREMISE_NOT_FOUND` and `ARGUMENT_ROLE_OVERLAP` removed        |
| `TCoreRoleDiff`              | `supportingAdded` and `supportingRemoved` fields removed                           |
| Entity schemas               | New optional `checksum` field on expressions, variables, premises, and arguments   |
| `ArgumentEngine` constructor | New optional second parameter `options?: { checksumConfig?: TCoreChecksumConfig }` |

---

## 1. Mutation results

Every mutating method now returns `TCoreMutationResult<T>` — an object with `result` (the direct return value) and `changes` (an entity-typed changeset describing all affected entities).

### Types

```typescript
interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[]
    removed: T[]
}

interface TCoreChangeset {
    expressions?: TCoreEntityChanges<TCorePropositionalExpression>
    variables?: TCoreEntityChanges<TCorePropositionalVariable>
    premises?: TCoreEntityChanges<TCorePremise>
    roles?: TCoreArgumentRoleState
    argument?: TCoreArgument
}

interface TCoreMutationResult<T> {
    result: T
    changes: TCoreChangeset
}
```

Optional fields in `TCoreChangeset` are absent when that entity category was not affected. `roles` and `argument` are singletons, so they contain the new state directly rather than added/modified/removed arrays.

### Updating call sites

If you previously used the return value directly, destructure `.result`:

```typescript
// Before
const pm = engine.createPremise()

// After
const { result: pm, changes } = engine.createPremise()
```

Methods that previously returned `void` now return a `TCoreMutationResult` whose `result` carries the created or affected entity:

```typescript
// Before — addExpression returned void
premise.addExpression(expr)

// After — result is the added expression (with checksum attached)
const { result: added, changes } = premise.addExpression(expr)
```

### Full method signature reference

**ArgumentEngine:**

| Method                             | `result` type               |
| ---------------------------------- | --------------------------- |
| `createPremise(extras?)`           | `PremiseManager`            |
| `createPremiseWithId(id, extras?)` | `PremiseManager`            |
| `removePremise(id)`                | `TCorePremise \| undefined` |
| `setConclusionPremise(id)`         | `TCoreArgumentRoleState`    |
| `clearConclusionPremise()`         | `TCoreArgumentRoleState`    |

**PremiseManager:**

| Method                                     | `result` type                               |
| ------------------------------------------ | ------------------------------------------- |
| `addVariable(v)`                           | `TCorePropositionalVariable`                |
| `removeVariable(id)`                       | `TCorePropositionalVariable \| undefined`   |
| `addExpression(e)`                         | `TCorePropositionalExpression`              |
| `appendExpression(parentId, e)`            | `TCorePropositionalExpression`              |
| `addExpressionRelative(siblingId, pos, e)` | `TCorePropositionalExpression`              |
| `removeExpression(id)`                     | `TCorePropositionalExpression \| undefined` |
| `insertExpression(e, left?, right?)`       | `TCorePropositionalExpression`              |
| `setExtras(extras)`                        | `Record<string, unknown>`                   |

### Using changesets for persistence

The `changes` object tells you exactly which database rows need to be inserted, updated, or deleted after a mutation:

```typescript
const { result, changes } = premise.removeExpression(exprId)

if (changes.expressions) {
    for (const expr of changes.expressions.removed) {
        await db.expressions.delete(expr.id)
    }
    for (const expr of changes.expressions.modified) {
        await db.expressions.update(expr.id, expr)
    }
}
```

Changesets capture cascading side effects. For example, removing an expression may trigger operator collapse, which modifies or removes ancestor expressions. All of those changes appear in `changes.expressions`.

---

## 2. Role state simplification

### Supporting premises are now derived

`TCoreArgumentRoleState` no longer contains `supportingPremiseIds`. The type is now:

```typescript
{ conclusionPremiseId?: string }
```

A premise is considered **supporting** if it is an inference premise (`implies` or `iff` root expression) and is not the conclusion. A premise is a **constraint** if it has any other root type or is empty. This classification is determined dynamically from the expression tree, not stored.

### Removed methods

- `engine.addSupportingPremise(id)` — removed entirely
- `engine.removeSupportingPremise(id)` — removed entirely

### Still available

- `engine.listSupportingPremises()` — still works, now computed instead of stored
- `engine.setConclusionPremise(id)` — sets the conclusion
- `engine.clearConclusionPremise()` — clears the conclusion

### Behavioral consequence

Any inference premise that was previously unassigned to a role is now automatically classified as supporting. If your code relied on inference premises existing without a role, those premises will now appear in `listSupportingPremises()` and participate in evaluation as supporting premises.

### Updating persistence

If you store role state, drop the `supportingPremiseIds` column or field. Only `conclusionPremiseId` needs to be persisted.

### Removed validation codes

These `TCoreValidationCode` values no longer exist:

- `ARGUMENT_SUPPORTING_PREMISE_NOT_FOUND`
- `ARGUMENT_ROLE_OVERLAP`

Remove any code that checks for or handles these codes.

### Diff changes

`TCoreRoleDiff` no longer includes `supportingAdded` or `supportingRemoved`. It now contains only:

```typescript
{ conclusion: { before: string | undefined, after: string | undefined } }
```

---

## 3. Checksums

Every entity now carries an optional `checksum` field, and both `PremiseManager` and `ArgumentEngine` expose aggregate `checksum()` methods for hierarchical sync detection.

### Entity-level checksums

Expressions, variables, and premises returned from getters and changesets include a `checksum` string computed from the entity's own fields (not its children):

```typescript
const expr = premise.getExpression(id)
console.log(expr?.checksum) // e.g. "a3f7c012"
```

The checksum is a FNV-1a 32-bit hash of deterministically serialized field values (sorted JSON keys).

### Aggregate checksums

```typescript
premise.checksum() // combines all entity checksums within the premise
engine.checksum() // combines all premise checksums + role state + argument metadata
```

Aggregate checksums are lazy — they're only recomputed when read after a mutation has marked them dirty. This avoids wasted work during bulk operations like hydration.

### Configurable fields

By default, checksums are computed from the standard schema fields. To include custom fields (e.g., database metadata), pass a config at construction:

```typescript
const engine = new ArgumentEngine(argument, {
    checksumConfig: {
        expressionFields: [
            "id",
            "type",
            "parentId",
            "position",
            "myCustomField",
        ],
        variableFields: ["id", "symbol", "myOtherField"],
    },
})
```

The config type:

```typescript
interface TCoreChecksumConfig {
    expressionFields?: string[]
    variableFields?: string[]
    premiseFields?: string[]
    argumentFields?: string[]
    roleFields?: string[]
}
```

Omitted fields fall back to built-in defaults.

---

## 4. New exports

The following are now exported from the package entry point:

**Types:**

- `TCoreMutationResult`
- `TCoreChangeset`
- `TCoreEntityChanges`
- `TCoreChecksumConfig`

**Functions:**

- `computeHash(input: string): string` — FNV-1a hash, returns 8-char hex
- `canonicalSerialize(value: unknown): string` — deterministic JSON with sorted keys
- `entityChecksum(entity: Record<string, unknown>, fields: string[]): string` — compute a checksum for an arbitrary entity

These utilities are available for consumers that need to compute checksums outside the engine (e.g., comparing a database row against an engine entity).

---

## Migration checklist

1. Update all mutating method call sites to destructure `{ result, changes }`.
2. Remove calls to `addSupportingPremise()` and `removeSupportingPremise()`.
3. Remove any stored `supportingPremiseIds` from your persistence layer.
4. Remove handling of `ARGUMENT_SUPPORTING_PREMISE_NOT_FOUND` and `ARGUMENT_ROLE_OVERLAP` validation codes.
5. Update any `TCoreRoleDiff` usage to remove `supportingAdded`/`supportingRemoved` references.
6. If using `diffArguments`, update role diff assertions to the new `{ conclusion }` shape.
7. Optionally adopt checksums for sync detection between instances.
8. Optionally use changesets for efficient incremental persistence.
