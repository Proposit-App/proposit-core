# Architecture & Internals

Reference for proposit-core internal design. Covers class structure, data representations, invariants, and implementation details.

---

## Class Hierarchy

```
ArgumentEngine
  ├─ VariableManager (shared, owned by engine)
  └─ PremiseManager (one per premise, receives shared VariableManager)
       └─ ExpressionManager (expression tree)
```

| Class               | File                                | Exported?        |
| ------------------- | ----------------------------------- | ---------------- |
| `ArgumentEngine`    | `src/lib/core/ArgumentEngine.ts`    | Yes (public API) |
| `PremiseManager`    | `src/lib/core/PremiseManager.ts`    | Yes (public API) |
| `ExpressionManager` | `src/lib/core/ExpressionManager.ts` | No (internal)    |
| `VariableManager`   | `src/lib/core/VariableManager.ts`   | No (internal)    |
| `ChangeCollector`   | `src/lib/core/ChangeCollector.ts`   | No (internal)    |

- `ArgumentEngine` owns a single `VariableManager` instance and passes it by reference to every `PremiseManager` it creates. All premises share the same variable registry.
- Each `PremiseManager` owns one `ExpressionManager` for its expression tree.
- Constructor: `new ArgumentEngine(argument, options?)` where `options?: { checksumConfig?: TCoreChecksumConfig }`.

---

## Expression Tree Representation

Three internal maps in `ExpressionManager`:

```typescript
expressions: Map<string, TExpressionInput>
// Main store. Entities lack checksums; checksums attached lazily by getters.

childExpressionIdsByParentId: Map<string | null, Set<string>>
// Fast child lookup. The null key holds root expression IDs.

childPositionsByParentId: Map<string | null, Set<number>>
// Tracks which positions are occupied under each parent.
```

Expressions are **immutable value objects**. To move one, delete and re-insert or use internal `reparent()`.

### Expression Types (Discriminated Union)

`TPropositionalExpression` narrows on `type`:

| `type`       | Extra fields                         | Notes                                   |
| ------------ | ------------------------------------ | --------------------------------------- |
| `"variable"` | `variableId: string`                 | Leaf node referencing a variable        |
| `"operator"` | `operator: TCoreLogicalOperatorType` | `and`, `or`, `not`, `implies`, `iff`    |
| `"formula"`  | (none)                               | Transparent unary wrapper (parentheses) |

### Input Types (Distributive Omit)

These preserve discriminated-union narrowing via conditional type distribution:

- `TExpressionInput` -- `Omit<TPropositionalExpression, "checksum">` (storage type)
- `TExpressionWithoutPosition` -- `Omit<TPropositionalExpression, "position" | "checksum">` (for `appendExpression`, `addExpressionRelative`)
- `TExpressionUpdate` -- `{ position?, variableId?, operator? }` (for `updateExpression`)

---

## Midpoint-Based Positions

File: `src/lib/utils/position.ts`

```typescript
POSITION_MIN = 0
POSITION_MAX = Number.MAX_SAFE_INTEGER // 2^53 - 1
POSITION_INITIAL = Math.floor(POSITION_MAX / 2)

midpoint(a, b) = a + (b - a) / 2 // overflow-safe
```

| Scenario                       | Position                                  |
| ------------------------------ | ----------------------------------------- |
| First child (no siblings)      | `POSITION_INITIAL`                        |
| Append (after last sibling)    | `midpoint(last.position, POSITION_MAX)`   |
| Prepend (before first sibling) | `midpoint(POSITION_MIN, first.position)`  |
| Between two siblings           | `midpoint(left.position, right.position)` |

Approximately 52 bisections at the same insertion point before losing IEEE 754 double precision.

### Intent-Based Insertion API

- `appendExpression(parentId, expression)` -- appends as last child, position computed automatically.
- `addExpressionRelative(siblingId, "before" | "after", expression)` -- inserts relative to an existing sibling.
- `addExpression(expression)` -- low-level escape hatch with explicit position.

All three exist on both `ExpressionManager` and `PremiseManager`.

---

## Root-Only Operators

`implies` and `iff` must always have `parentId: null`. They cannot be nested inside another expression. Enforced in both `addExpression` and `insertExpression`. Attempting to add them with a non-null `parentId` throws.

---

## Formula Nodes

The `formula` expression type is a **transparent unary wrapper** -- equivalent to parentheses around its single child.

- Must have exactly one child.
- Collapse rules apply identically to `formula` and `operator` nodes.
- During evaluation, `formula` nodes propagate their child's value transparently.

---

## Operator Collapse

Triggered by `removeExpression(id, deleteSubtree)`. After removal, `collapseIfNeeded(parentId)` runs on the parent:

| Children remaining | Action                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 0                  | Delete the operator/formula. Recurse to grandparent.                                                                                       |
| 1                  | Delete the operator/formula. Promote surviving child (inherits `parentId` + `position`). No recursion (grandparent child count unchanged). |
| 2+                 | No action.                                                                                                                                 |

### removeExpression Behavior

The `deleteSubtree` parameter (required boolean) controls behavior:

- **`deleteSubtree: true`** -- Removes expression and all descendants. Then runs `collapseIfNeeded(parentId)`.
- **`deleteSubtree: false`** -- Removes expression and promotes its single child into its slot (inheriting `parentId` and `position`). Throws if >1 child. Validates that root-only operators (`implies`/`iff`) are not promoted into non-root positions. No collapse runs after promotion. Leaf removal with `deleteSubtree: false` runs collapse on the parent (same as `true`).

---

## insertExpression Mutation Order

`reparent(rightNodeId, ...)` runs **before** `reparent(leftNodeId, ...)`.

This handles the case where the right node is a descendant of the left node's subtree -- it must be detached first to avoid corrupting the tree.

---

## Premise Types

Derived dynamically from the root expression -- not stored on disk.

| Method           | Returns `true` when                                                        | Used for                           |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| `isInference()`  | Root is `implies` or `iff`                                                 | Supporting/conclusion chain        |
| `isConstraint()` | Root is anything else (`variable`, `not`, `and`, `or`) or premise is empty | Restricting admissible assignments |

---

## Derived Supporting Premises

Supporting premises are **not explicitly managed**. The methods `addSupportingPremise()` and `removeSupportingPremise()` were removed.

**Rule:** Any inference premise that is not the conclusion is automatically considered supporting.

`TCoreArgumentRoleState` contains only `{ conclusionPremiseId?: string }`. `listSupportingPremises()` derives the list dynamically on each call from the current set of premises.

---

## Auto-Conclusion Assignment

When the first premise is added to an `ArgumentEngine` (via `createPremise` or `createPremiseWithId`) and no conclusion is currently set, that premise is automatically designated as the conclusion.

- Auto-assignment is reflected in the mutation changeset.
- `setConclusionPremise()` overrides auto-assignment.
- Removing or clearing the conclusion re-enables auto-assignment for the next premise created.

---

## Mutation Changesets

Every mutating method on `PremiseManager` and `ArgumentEngine` returns `TCoreMutationResult<T>`:

```typescript
interface TCoreMutationResult<T> {
    result: T // direct answer (e.g. removed expression, new role state)
    changes: TCoreChangeset // all side effects
}
```

### TCoreChangeset Structure

```typescript
interface TCoreChangeset {
    expressions?: TCoreEntityChanges<TPropositionalExpression>
    variables?: TCoreEntityChanges<TPropositionalVariable>
    premises?: TCoreEntityChanges<TCorePremise>
    roles?: TCoreArgumentRoleState // present only when roles changed
    argument?: TCoreArgument // present only when argument metadata changed
}

interface TCoreEntityChanges<T> {
    added: T[]
    modified: T[]
    removed: T[]
}
```

### Internal Flow

1. `ChangeCollector` (not exported) accumulates entity changes during a mutation.
2. `toChangeset()` produces `TCoreRawChangeset` (uses input types without checksums: `TExpressionInput`, `TVariableInput`).
3. `attachChangesetChecksums()` converts to `TCoreChangeset` with checksums attached before returning to callers.

---

## Checksum System

Per-entity checksums provide lightweight change detection without deep comparison.

### How It Works

- All entity types carry a required `checksum: string` field in their schemas.
- Internally, managers store entities **without checksums** using input types (`TExpressionInput`, `TVariableInput`).
- Checksums are **attached lazily** by getters (`getExpression()`, `getVariables()`, `getArgument()`, `toData()`) and in changeset outputs.
- `PremiseManager.checksum()` and `ArgumentEngine.checksum()` use dirty flags for lazy recomputation.

### Checksum Utilities

File: `src/lib/core/checksum.ts`

| Function                                     | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| `computeHash(input: string): string`         | FNV-1a 32-bit hash. Returns 8-char hex string.       |
| `canonicalSerialize(value: unknown): string` | Deterministic JSON with sorted keys at all levels.   |
| `entityChecksum(entity, fields): string`     | Picks specified fields (sorted), serializes, hashes. |

### Configuration

File: `src/lib/checksum-config.ts`

- `DEFAULT_CHECKSUM_CONFIG` -- defines which fields are hashed per entity type.
- `createChecksumConfig(additional)` -- merges additional fields into defaults (union, not replace).
- `ArgumentEngine` constructor accepts `options?: { checksumConfig?: TCoreChecksumConfig }`.

`TCoreChecksumConfig` fields (all `Set<string>`, all optional):

- `expressionFields` -- default: `id`, `type`, `parentId`, `position`, `argumentId`, `argumentVersion`, `variableId`, `operator`
- `variableFields` -- default: `id`, `symbol`, `argumentId`, `argumentVersion`
- `premiseFields` -- default: `id`, `rootExpressionId`
- `argumentFields` -- default: `id`, `version`
- `roleFields` -- default: `conclusionPremiseId`

---

## ESM Import Requirements

The project uses `moduleResolution: "bundler"` in `tsconfig.json` but `src/cli.ts` is compiled and run directly by Node.js ESM.

**Rules:**

- All relative imports in `src/cli/` and `src/lib/` must end in `.js`.
- Directory imports must use the explicit index path: `schemata/index.js` not `schemata/`.
- Critical: `src/lib/utils/` (directory) and `src/lib/utils.ts` (file) both compile to `dist/lib/`, and Node.js ESM resolves the directory first if no extension is given.
