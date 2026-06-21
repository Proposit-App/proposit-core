# Argument Diff — Design

A library function that computes a structured diff between two versions of the same argument, reporting added, removed, and modified objects with field-level change detail.

## Input

A standalone function that accepts two `ArgumentEngine` instances:

```typescript
function diffArguments(
    engineA: ArgumentEngine,
    engineB: ArgumentEngine,
    options?: TCoreDiffOptions
): TCoreArgumentDiff
```

Calls `toData()` on both engines internally to obtain serializable snapshots for comparison.

## Object matching

Objects are matched across versions by UUID. Same UUID in both versions = same object; its fields are compared for modifications.

## Diff granularity

Field-level changes are reported for each modified object. A `TCoreFieldChange` records the field name, before value, and after value. Expressions are scoped per-premise — each modified premise includes a nested diff of its own expressions.

Roles (conclusion and supporting premise assignments) are tracked as their own diff category, separate from premise changes.

## Pluggable comparators

Default comparators are exported so consumers can compose custom ones. A downstream project that extends entity metadata can call the default comparator and append additional field changes:

```typescript
diffArguments(engineA, engineB, {
    comparePremise: (before, after) => [
        ...defaultComparePremise(before, after),
        // check custom fields
    ],
})
```

## Types

All types live in `src/lib/types/diff.ts` as plain TypeScript interfaces.

### Core generic types

```typescript
// A single field-level change on an entity
interface TCoreFieldChange {
    field: string
    before: unknown
    after: unknown
}

// Field-level diff for a single matched entity
interface TCoreEntityFieldDiff<T> {
    before: T
    after: T
    changes: TCoreFieldChange[]
}

// Set-level diff for a collection of ID-keyed entities
interface TCoreEntitySetDiff<T extends { id: string }> {
    added: T[]
    removed: T[]
    modified: TCoreEntityFieldDiff<T>[]
}
```

### Domain-specific types

```typescript
// Premise diff includes nested expression diffs
interface TCorePremiseDiff extends TCoreEntityFieldDiff<TCorePremise> {
    expressions: TCoreEntitySetDiff<TCorePropositionalExpression>
}

interface TCorePremiseSetDiff {
    added: TCorePremise[]
    removed: TCorePremise[]
    modified: TCorePremiseDiff[]
}

// Role changes
interface TCoreRoleDiff {
    conclusion: { before: string | undefined; after: string | undefined }
    supportingAdded: string[]
    supportingRemoved: string[]
}

// Top-level diff result
interface TCoreArgumentDiff {
    argument: TCoreEntityFieldDiff<TCoreArgumentMeta>
    variables: TCoreEntitySetDiff<TCorePropositionalVariable>
    premises: TCorePremiseSetDiff
    roles: TCoreRoleDiff
}
```

### Comparator types

```typescript
type TCoreFieldComparator<T> = (before: T, after: T) => TCoreFieldChange[]

interface TCoreDiffOptions {
    compareArgument?: TCoreFieldComparator<TCoreArgumentMeta>
    compareVariable?: TCoreFieldComparator<TCorePropositionalVariable>
    comparePremise?: TCoreFieldComparator<TCorePropositionalExpression>
    compareExpression?: TCoreFieldComparator<TCorePropositionalExpression>
}
```

## Default comparators

Each comparator checks the mutable fields for its entity type:

- **Argument** (`defaultCompareArgument`): `title`, `description`
- **Variable** (`defaultCompareVariable`): `symbol`
- **Premise** (`defaultComparePremise`): `title`, `rootExpressionId`
- **Expression** (`defaultCompareExpression`): `parentId`, `position`, `operator` (for operator type), `variableId` (for variable type)

A field is reported as changed only when `before !== after`.

## Diff algorithm

1. Call `toData()` on both engines to get `TCoreArgumentEngineData` snapshots.
2. Compare argument metadata using the argument comparator.
3. Index variables by ID from both snapshots. Compute added, removed, and modified sets.
4. Index premises by ID from both snapshots. Compute added, removed, and modified sets.
5. For each modified premise, index its expressions by ID and compute added, removed, and modified expressions.
6. Compare roles: conclusion before/after, supporting set diffed for added/removed IDs.

## File layout

- `src/lib/types/diff.ts` — all diff type definitions
- `src/lib/core/diff.ts` — `diffArguments`, default comparators, internal helpers
- Re-exported from `src/lib/index.ts` and `src/index.ts`

## Testing

Tests added in `test/ExpressionManager.test.ts` in a new `describe("diffArguments")` block at the bottom, covering:

- Two identical engines produce an empty diff
- Added/removed/modified variables
- Added/removed/modified premises
- Modified expressions within a premise
- Role changes (conclusion and supporting)
- Custom comparators extending default behavior
