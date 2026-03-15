# Claim-Source Associations Design

## Motivation

Source associations are semantically misaligned at two levels:

1. **Variable-source associations** are argument-scoped, but a source supports the truth of a *proposition* (claim), not a particular use of that proposition in an argument. Both claims and sources are global library entities — the association should be global too.

2. **Expression-source associations** are unnecessary. If you want to cite evidence for a structural relationship (e.g., `A implies B`), you reify that relationship as a claim, assign it to a variable P, and cite sources for the claim. For example, a premise `P implies (A implies B)` uses P (backed by a sourced claim) to establish the relationship. This keeps all sourcing at one level.

This design replaces both association types with a single global `ClaimSourceLibrary<TAssoc>`, and deletes `SourceManager` entirely.

## Decisions

| Question | Decision |
|----------|----------|
| Scope | Replace variable-source with claim-source. Delete expression-source associations entirely. Delete `SourceManager`. |
| Where associations live | New standalone `ClaimSourceLibrary<TAssoc>` class. |
| Versioning/freeze | No. Associations are create-or-delete only. Version-pinning on `claimVersion` + `sourceVersion` within each association captures the temporal relationship. |
| Validation | Yes. `ClaimSourceLibrary` takes `TClaimLookup` and `TSourceLookup` and validates on add. |
| Extensibility | Generic `TAssoc extends TCoreClaimSourceAssociation`. Consumers extend the base schema with additional fields and use `filter()` for custom queries. |

## Schema

New `CoreClaimSourceAssociationSchema` in `src/lib/schemata/source.ts`:

```typescript
export const CoreClaimSourceAssociationSchema = Type.Object(
    {
        id: UUID,
        claimId: UUID,
        claimVersion: Type.Number({
            description: "The version of the claim this association pins to.",
        }),
        sourceId: UUID,
        sourceVersion: Type.Number({
            description: "The version of the source this association pins to.",
        }),
        checksum: Type.String({
            description: "Association checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "An association between a claim and a source. Extended via generics for additional fields (e.g., createdBy).",
    }
)
export type TCoreClaimSourceAssociation = Static<
    typeof CoreClaimSourceAssociationSchema
>
```

Deleted schemas:
- `CoreVariableSourceAssociationSchema` and `TCoreVariableSourceAssociation`
- `CoreExpressionSourceAssociationSchema` and `TCoreExpressionSourceAssociation`

## `ClaimSourceLibrary<TAssoc>` class

New file: `src/lib/core/claim-source-library.ts`

### Constructor

```typescript
class ClaimSourceLibrary<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    constructor(
        claimLookup: TClaimLookup,
        sourceLookup: TSourceLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    )
}
```

### Data structures

- `associations: Map<assocId, TAssoc>` — primary store
- `claimToAssociations: Map<claimId, Set<assocId>>` — reverse index
- `sourceToAssociations: Map<sourceId, Set<assocId>>` — reverse index

### Mutations (create-or-delete only)

- `add(assoc: Omit<TAssoc, "checksum">): TAssoc` — validates claim exists via `TClaimLookup.get(claimId, claimVersion)` and source exists via `TSourceLookup.get(sourceId, sourceVersion)`. Computes checksum. Throws on duplicate ID, missing claim, or missing source.
- `remove(id: string): TAssoc` — removes from store and indexes, returns removed association. Throws if not found.

### Queries

- `getForClaim(claimId: string): TAssoc[]` — all associations for a claim (across all versions)
- `getForSource(sourceId: string): TAssoc[]` — all associations for a source
- `get(id: string): TAssoc | undefined` — single association by ID
- `getAll(): TAssoc[]` — all associations
- `filter(predicate: (a: TAssoc) => boolean): TAssoc[]` — generic filtering for consumer-defined fields (e.g., `a => a.createdBy === userId`)

### Snapshot/restore

- `snapshot(): TClaimSourceLibrarySnapshot<TAssoc>` — returns `{ claimSourceAssociations: TAssoc[] }`
- `static fromSnapshot<TAssoc>(snapshot, claimLookup, sourceLookup, options?): ClaimSourceLibrary<TAssoc>`

### Read-only interface

```typescript
interface TClaimSourceLookup<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    getForClaim(claimId: string): TAssoc[]
    getForSource(sourceId: string): TAssoc[]
    get(id: string): TAssoc | undefined
}
```

Added to `src/lib/core/interfaces/library.interfaces.ts` alongside `TClaimLookup` and `TSourceLookup`.

## Integration

### `ArgumentEngine` changes

Adds `TAssoc` as a 7th generic parameter (after existing `TSource` and `TClaim`), and replaces the `SourceManager` dependency with a read-only `TClaimSourceLookup<TAssoc>`:

```typescript
class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
    TClaim extends TCoreClaim = TCoreClaim,
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    constructor(
        argument: TOptionalChecksum<TArg>,
        claimLibrary: TClaimLookup<TClaim>,
        sourceLibrary: TSourceLookup<TSource>,
        claimSourceLibrary: TClaimSourceLookup<TAssoc>,
        options?: TLogicEngineOptions
    )
}
```

`ArgumentEngine` does not mutate claim-source associations. It can query them (e.g., "what sources support the claim behind variable P?") but `ClaimSourceLibrary` is managed externally.

Removed from `ArgumentEngine`:
- `sourceManager` private field — deleted entirely
- All `TSourceManagement` method implementations (both variable-source and expression-source)
- `ArgumentEngine` no longer implements `TSourceManagement`
- Source association checksums removed from argument checksum computation

`TArgumentEngineSnapshot`:
- Remove `sources?: TSourceManagerSnapshot` field entirely
- No replacement — claim-source associations are global, not argument-scoped

All static factory and restoration methods:
- `fromSnapshot(snapshot, claimLibrary, sourceLibrary, claimSourceLibrary, options?)` — adds `claimSourceLibrary` parameter, removes all source association restoration code
- `fromData(data, claimLibrary, sourceLibrary, claimSourceLibrary, options?)` — adds `claimSourceLibrary` parameter
- `rollback(snapshot)` — internal reconstruction passes stored `claimSourceLibrary` reference, removes all source association restoration code

### `SourceManager` deletion

The entire `src/lib/core/source-manager.ts` file is deleted. All types it exports are removed:
- `SourceManager` class
- `TSourceManagerSnapshot` interface
- `TSourceAssociationRemovalResult` interface

### `TSourceManagement` interface deletion

The entire `src/lib/core/interfaces/source-management.interfaces.ts` file is deleted. Update `src/lib/core/interfaces/index.ts` to remove its re-exports.

### `PremiseEngine` changes

All source cascade logic is removed from `PremiseEngine`:
- `sourceManager` field/parameter — deleted
- In `removeExpression`: remove the cascade block that calls `sourceManager.removeAssociationsForExpression()` and notifies the collector
- In `removeExpressionSourceAssociation`: delete method entirely
- The `PremiseEngine` constructor no longer receives a `SourceManager`

### `ChangeCollector` changes

In `src/lib/core/change-collector.ts`:
- Remove `variableSourceAssociations` private field and its `addedVariableSourceAssociation()`/`removedVariableSourceAssociation()` methods
- Remove `expressionSourceAssociations` private field and its `addedExpressionSourceAssociation()`/`removedExpressionSourceAssociation()` methods
- Remove both from `toChangeset()` output

### `TCoreChangeset` changes

In `src/lib/types/mutation.ts`:
- Remove `variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>` field
- Remove `expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>` field

### `TReactiveSnapshot` changes

In `src/lib/types/reactive.ts`:
- Remove `variableSourceAssociations: Record<string, TCoreVariableSourceAssociation>` field
- Remove `expressionSourceAssociations: Record<string, TCoreExpressionSourceAssociation>` field
- No replacement — claim-source associations are global (not argument-scoped), so they do not belong in argument-level reactive snapshots

### Diff module changes

In `src/lib/types/diff.ts`:
- Remove `variableSourceAssociations` field from `TCoreArgumentDiff`
- Remove `expressionSourceAssociations` field from `TCoreArgumentDiff`
- Remove `compareVariableSourceAssociation` field from `TCoreDiffOptions`
- Remove `compareExpressionSourceAssociation` field from `TCoreDiffOptions`
- No replacement — claim-source associations are global, so they do not belong in argument-level diffs

In `src/lib/core/diff.ts`:
- Remove `defaultCompareVariableSourceAssociation` comparator function
- Remove `defaultCompareExpressionSourceAssociation` comparator function
- Remove all source association diffing from `diffArguments`

### Cascade changes

- `removeVariable()` no longer cascades to any source associations. Still cascades expression deletion (operator collapse) as before.
- `removePremise()` no longer cascades to expression-source associations. Still cascades expression deletion as before.
- `removeExpression()` no longer cascades to expression-source associations. Only structural cascade (operator collapse) remains.
- No cascade from claim-source side — associations are global and independent of argument lifecycle.

### Checksum config

- `variableSourceAssociationFields` renamed to `claimSourceAssociationFields` in both `TCoreChecksumConfig` (`src/lib/types/checksum.ts`) and `DEFAULT_CHECKSUM_CONFIG` (`src/lib/consts.ts`)
- `expressionSourceAssociationFields` deleted from both
- Default claim-source fields: `["id", "claimId", "claimVersion", "sourceId", "sourceVersion"]`
- `createChecksumConfig` `keys` array updated accordingly

## Exports

### New exports

- `ClaimSourceLibrary` class
- `TCoreClaimSourceAssociation` type and `CoreClaimSourceAssociationSchema`
- `TClaimSourceLookup` and `TClaimSourceLibrarySnapshot` interfaces

### Removed exports

- `TCoreVariableSourceAssociation` type and `CoreVariableSourceAssociationSchema`
- `TCoreExpressionSourceAssociation` type and `CoreExpressionSourceAssociationSchema`
- `SourceManager` class, `TSourceManagerSnapshot`, `TSourceAssociationRemovalResult`
- `TSourceManagement` interface
- `defaultCompareVariableSourceAssociation` and `defaultCompareExpressionSourceAssociation` from diff module
- All source management methods from `ArgumentEngine`

## CLI layer

- `sources link-variable` command removed or replaced with `sources link-claim` calling `ClaimSourceLibrary.add()`
- `sources link-expression` command removed
- `sources unlink` simplified — only handles claim-source associations (expression-source no longer exists)
- Disk storage: `sources/variable-associations.json` and `sources/expression-associations.json` both removed. Replaced with global `claim-source-associations.json`, managed separately from argument-versioned directories
- `src/cli/storage/sources.ts`: remove all variable-association and expression-association functions. Add global claim-source association read/write functions (no `argumentId`/`version` parameters — global path)
- `src/cli/engine.ts`: remove all source association reads/writes from `hydrateEngine` and `persistEngine`. `ArgumentEngine` constructor call updated to pass `claimSourceLibrary`. `ClaimSourceLibrary` hydration/persistence managed independently with dedicated helpers

## Testing

Affected test blocks in `test/core.test.ts`:
- All `SourceManager` tests — remove entire describe block
- All `ArgumentEngine` variable-source and expression-source association tests — remove entirely
- All source cascade tests in `removeVariable`, `removePremise`, `removeExpression` — remove source-specific assertions, keep structural cascade assertions
- All `getAssociationsFor*` and `getAllVariableSourceAssociations`/`getAllExpressionSourceAssociations` tests — remove

Affected test blocks in `test/diff-renderer.test.ts`:
- Fixture objects that include `variableSourceAssociations` or `expressionSourceAssociations` — remove fields

New tests to add:
- `ClaimSourceLibrary` — add/remove, validation against `ClaimLookup`/`SourceLookup`, `getForClaim`, `getForSource`, `filter`, snapshot/restore, duplicate ID rejection, missing claim/source rejection
- Generic `TAssoc` extension — verify extended fields are preserved through add/snapshot/filter

## Documentation sync

Per CLAUDE.md Documentation Sync rules, the following files need updating:
- `docs/api-reference.md` — remove all source association sections (variable and expression), add `ClaimSourceLibrary` sections, update `ArgumentEngine` constructor/generics, remove `TSourceManagement`, update `TReactiveSnapshot`/`TCoreChangeset`/diff types
- `README.md` — update source association concept references
- `CLI_EXAMPLES.md` — replace `sources link-variable` and `sources link-expression` examples with `sources link-claim`
- `scripts/smoke-test.sh` — replace source association commands
- `CLAUDE.md` — update design rules: constructor signature, remove all source cascade rules, remove association immutability rule (now on ClaimSourceLibrary), update libraries-required-by-ArgumentEngine
- `src/lib/core/interfaces/argument-engine.interfaces.ts` — update JSDoc for changed constructor and removed `TSourceManagement` implementation
- `src/lib/core/interfaces/library.interfaces.ts` — add JSDoc for new `TClaimSourceLookup` and `TClaimSourceLibrarySnapshot`

## Breaking changes

Breaking public API change to `ArgumentEngine` constructor signature and generics, `TSourceManagement` deletion, `SourceManager` deletion, `TCoreChangeset`, `TCoreArgumentDiff`, `TCoreDiffOptions`, `TReactiveSnapshot`, checksum config, and schemas. Acceptable at current semver (0.x).
