# Sources Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sources as first-class, argument-scoped, checksummed entities with variable and expression associations, a SourceManager, full changeset/diff/snapshot/validation integration, CLI commands, and an IEEE extensions subproject.

**Architecture:** SourceManager mirrors VariableManager as a shared argument-scoped dependency. Sources and two association types are new entity schemas. The 5th generic type parameter `TSource` threads through all downstream types. Cascading deletes flow from target removal → association removal → orphan source removal.

**Tech Stack:** TypeScript, TypeBox (schemas), Vitest (tests), pnpm

**Spec:** `docs/plans/2026-03-12-sources-design.md`

---

## File Map

### New files
| Path | Responsibility |
|------|---------------|
| `src/lib/schemata/source.ts` | `CoreSourceSchema`, `CoreVariableSourceAssociationSchema`, `CoreExpressionSourceAssociationSchema` + TS types |
| `src/lib/core/source-manager.ts` | `SourceManager<TSource>` — storage, indices, mutations, queries, snapshot/restore, orphan cleanup |
| `src/lib/core/interfaces/source-management.interfaces.ts` | `TSourceManagement` interface contract for ArgumentEngine |
| `src/extensions/ieee/index.ts` | Barrel export for IEEE extensions |
| `src/extensions/ieee/references.ts` | `IEEEReferenceSchema` — 31 IEEE reference type schemas |
| `src/extensions/ieee/source.ts` | `IEEESourceSchema` — extends CoreSourceSchema with url + citation |
| `src/cli/storage/sources.ts` | Disk I/O: read/write source meta, read/write association files |
| `src/cli/commands/sources.ts` | CLI source commands: add, remove, list, show, link, unlink |

### Modified files
| Path | Changes |
|------|---------|
| `src/lib/schemata/index.ts` | Re-export source schemata |
| `src/lib/types/mutation.ts` | Add `TSource` 5th generic param to `TCoreChangeset` and `TCoreMutationResult`; add 3 new changeset categories |
| `src/lib/types/checksum.ts` | Add `sourceFields`, `variableSourceAssociationFields`, `expressionSourceAssociationFields` to `TCoreChecksumConfig` |
| `src/lib/consts.ts` | Add source/association defaults to `DEFAULT_CHECKSUM_CONFIG`; extend `createChecksumConfig` keys |
| `src/lib/types/diff.ts` | Add `TSource` 5th generic param to `TCoreArgumentDiff`, `TCoreDiffOptions`; add 3 new diff fields + comparators |
| `src/lib/types/reactive.ts` | Add `TSource` 5th generic param to `TReactiveSnapshot`; add source + association records |
| `src/lib/core/change-collector.ts` | Add `TSource` 5th generic param; add 6 new accumulator methods |
| `src/lib/core/interfaces/index.ts` | Re-export source-management interfaces |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | Add `TSource` to all interfaces; compose `TSourceManagement` |
| `src/lib/core/interfaces/premise-engine.interfaces.ts` | Add `TSource` to all interfaces; add source convenience methods |
| `src/lib/core/argument-engine.ts` | Own SourceManager; implement TSourceManagement; extend cascades in removeVariable, removePremise |
| `src/lib/core/premise-engine.ts` | Accept SourceManager dep; add convenience methods; extend removeExpression cascade |
| `src/lib/core/diff.ts` | Diff sources + both association types; add 3 default comparators |
| `src/lib/index.ts` | Export new schemas, types, SourceManager |
| `src/cli/schemata.ts` | `CliSourceSchema` extending CoreSourceSchema with `url: string` |
| `src/cli/engine.ts` | Hydrate sources + associations from disk |
| `src/cli/config.ts` | `getSourcesDir()`, `getSourceDir()` path helpers |
| `src/cli/router.ts` | Route `sources` subcommand |
| `test/core.test.ts` | All new tests (SourceManager, engine integration, cascades, diff, validation) |

---

## Chunk 1: Core Types & Schemas

### Task 1: Source and association schemas

**Files:**
- Create: `src/lib/schemata/source.ts`
- Modify: `src/lib/schemata/index.ts`

- [ ] **Step 1: Create source schema file**

Create `src/lib/schemata/source.ts` with three schemas. Use the project's `typebox` bare import (not `@sinclair/typebox`) and the `UUID` helper from `./shared.js`. Use `Type.String()` for checksum (not `Type.Optional`) — matching `CorePremiseSchema`. The `TOptionalChecksum<T>` utility type handles optionality at the TS level.

```typescript
import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreSourceSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        checksum: Type.String({
            description: "Source-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A source entity providing evidentiary support for variables or expressions.",
    }
)
export type TCoreSource = Static<typeof CoreSourceSchema>

export const CoreVariableSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    variableId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String({
        description: "Association checksum for sync detection.",
    }),
})
export type TCoreVariableSourceAssociation = Static<
    typeof CoreVariableSourceAssociationSchema
>

export const CoreExpressionSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    expressionId: UUID,
    premiseId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String({
        description: "Association checksum for sync detection.",
    }),
})
export type TCoreExpressionSourceAssociation = Static<
    typeof CoreExpressionSourceAssociationSchema
>
```

`CoreSourceSchema` has `additionalProperties: true` for extensibility; association schemas do not (fixed-shape).

- [ ] **Step 2: Export from schemata barrel**

In `src/lib/schemata/index.ts`, add:
```typescript
export * from "./source.js"
```

- [ ] **Step 3: Export from library barrel**

Verify `src/lib/index.ts` already re-exports `"./schemata/index.js"` (it does). No change needed — the new types will be available automatically.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS — no consumers of these types yet.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemata/source.ts src/lib/schemata/index.ts
git commit -m "feat: add CoreSourceSchema and association schemas"
```

### Task 2: Add source checksum config

**Files:**
- Modify: `src/lib/types/checksum.ts`
- Modify: `src/lib/consts.ts`

- [ ] **Step 1: Add source fields to TCoreChecksumConfig**

In `src/lib/types/checksum.ts`, add three new optional fields:

```typescript
/** Fields to hash for source entities. Defaults to ["id", "argumentId", "argumentVersion"]. */
sourceFields?: Set<string>
/** Fields to hash for variable-source associations. */
variableSourceAssociationFields?: Set<string>
/** Fields to hash for expression-source associations. */
expressionSourceAssociationFields?: Set<string>
```

- [ ] **Step 2: Add defaults to DEFAULT_CHECKSUM_CONFIG**

In `src/lib/consts.ts`, add to `DEFAULT_CHECKSUM_CONFIG`:

```typescript
sourceFields: new Set(["id", "argumentId", "argumentVersion"]),
variableSourceAssociationFields: new Set([
    "id", "sourceId", "variableId", "argumentId", "argumentVersion",
]),
expressionSourceAssociationFields: new Set([
    "id", "sourceId", "expressionId", "premiseId", "argumentId", "argumentVersion",
]),
```

- [ ] **Step 3: Extend createChecksumConfig keys array**

In the `keys` array of `createChecksumConfig`, add `"sourceFields"`, `"variableSourceAssociationFields"`, `"expressionSourceAssociationFields"`.

- [ ] **Step 4: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/types/checksum.ts src/lib/consts.ts
git commit -m "feat: add source and association checksum config"
```

### Task 3: Expand TCoreChangeset and TCoreMutationResult with TSource

Note: task numbering shifted by +1 from the original due to the inserted Task 2. All subsequent task references use the new numbering.

**Files:**
- Modify: `src/lib/types/mutation.ts`

- [ ] **Step 1: Add TSource generic parameter to TCoreChangeset**

Add `TSource extends TCoreSource = TCoreSource` as the 5th parameter. Add three new optional categories:

```typescript
import type { TCoreSource, TCoreVariableSourceAssociation, TCoreExpressionSourceAssociation } from "../schemata/index.js"

export interface TCoreChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
    TSource extends TCoreSource = TCoreSource,
> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    roles?: TCoreArgumentRoleState
    argument?: TArg
    sources?: TCoreEntityChanges<TSource>
    variableSourceAssociations?: TCoreEntityChanges<TCoreVariableSourceAssociation>
    expressionSourceAssociations?: TCoreEntityChanges<TCoreExpressionSourceAssociation>
}
```

- [ ] **Step 2: Add TSource to TCoreMutationResult**

Thread `TSource` through `TCoreMutationResult`:

```typescript
export interface TCoreMutationResult<
    TResult,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
    TSource extends TCoreSource = TCoreSource,
> {
    result: TResult
    changes: TCoreChangeset<TExpr, TVar, TPremise, TArg, TSource>
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS — defaults preserve backward compatibility.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/mutation.ts
git commit -m "feat: add TSource generic to TCoreChangeset and TCoreMutationResult"
```

### Task 4: Expand diff types with TSource

**Files:**
- Modify: `src/lib/types/diff.ts`

- [ ] **Step 1: Add TSource to TCoreArgumentDiff**

Add `TSource extends TCoreSource = TCoreSource` as the 5th parameter. Add three new fields:

```typescript
sources: TCoreEntitySetDiff<TSource>
variableSourceAssociations: TCoreEntitySetDiff<TCoreVariableSourceAssociation>
expressionSourceAssociations: TCoreEntitySetDiff<TCoreExpressionSourceAssociation>
```

- [ ] **Step 2: Add TSource to TCoreDiffOptions**

Add `TSource extends TCoreSource = TCoreSource` as the 5th parameter. Add three new optional comparator fields:

```typescript
compareSource?: TCoreFieldComparator<TSource>
compareVariableSourceAssociation?: TCoreFieldComparator<TCoreVariableSourceAssociation>
compareExpressionSourceAssociation?: TCoreFieldComparator<TCoreExpressionSourceAssociation>
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: FAIL — `diffArguments` in `diff.ts` returns `TCoreArgumentDiff` which now requires the three new fields. This is expected; we'll fix it in Chunk 4.

Note the failures and proceed — they'll be resolved when we implement the diff logic.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types/diff.ts
git commit -m "feat: add TSource generic to diff types"
```

### Task 5: Expand reactive snapshot types with TSource

**Files:**
- Modify: `src/lib/types/reactive.ts`

- [ ] **Step 1: Add TSource to TReactiveSnapshot**

Add `TSource extends TCoreSource = TCoreSource` as the 5th parameter. Add three new fields:

```typescript
sources: Record<string, TSource>
variableSourceAssociations: Record<string, TCoreVariableSourceAssociation>
expressionSourceAssociations: Record<string, TCoreExpressionSourceAssociation>
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: Additional failures from consumers of `TReactiveSnapshot` (e.g., `argument-engine.ts`). Expected — will be resolved during engine integration.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/reactive.ts
git commit -m "feat: add TSource generic to TReactiveSnapshot"
```

### Task 6: Expand ChangeCollector with TSource

**Files:**
- Modify: `src/lib/core/change-collector.ts`

- [ ] **Step 1: Add TSource generic and 6 new accumulator methods**

Add `TSource extends TCoreSource = TCoreSource` as the 5th generic parameter. Add internal state for the three new categories and methods:

```typescript
addedSource(source: TSource): void
removedSource(source: TSource): void
addedVariableSourceAssociation(assoc: TCoreVariableSourceAssociation): void
removedVariableSourceAssociation(assoc: TCoreVariableSourceAssociation): void
addedExpressionSourceAssociation(assoc: TCoreExpressionSourceAssociation): void
removedExpressionSourceAssociation(assoc: TCoreExpressionSourceAssociation): void
```

Follow the existing pattern — each method pushes to the relevant `added`/`removed` array. `toChangeset()` includes the new categories only if non-empty.

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: May still have downstream failures from engines — expected.

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/change-collector.ts
git commit -m "feat: add TSource to ChangeCollector with source accumulator methods"
```

---

## Chunk 2: SourceManager

### Task 7: SourceManager — core storage, mutations, queries

**Files:**
- Create: `src/lib/core/source-manager.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for SourceManager basics**

Add a new `describe("SourceManager")` block at the bottom of `test/core.test.ts`. Import `TCoreSource`, `TCoreVariableSourceAssociation`, `TCoreExpressionSourceAssociation` from the schemata. Since `SourceManager` is not yet exported, the import will fail.

Write tests for:
- `addSource` / `getSource` / `getSources` — add a source, retrieve it by ID, list all
- `addVariableSourceAssociation` / `getAssociationsForVariable` — add association, query by variable
- `addExpressionSourceAssociation` / `getAssociationsForExpression` — add association, query by expression
- `getAssociationsForSource` — returns both types for a given source
- `removeSource` — cascades to remove all associations
- `removeVariableSourceAssociation` / `removeExpressionSourceAssociation` — individual removal
- Duplicate ID rejection for sources and associations

Each test builds its own fixtures inline (no shared `beforeEach`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL — `SourceManager` not found.

- [ ] **Step 3: Implement SourceManager**

Create `src/lib/core/source-manager.ts`:

```typescript
import type {
    TCoreSource,
    TCoreVariableSourceAssociation,
    TCoreExpressionSourceAssociation,
} from "../schemata/index.js"

export interface TSourceManagerSnapshot<
    TSource extends TCoreSource = TCoreSource,
> {
    sources: TSource[]
    variableSourceAssociations: TCoreVariableSourceAssociation[]
    expressionSourceAssociations: TCoreExpressionSourceAssociation[]
}

export interface TSourceRemovalResult<
    TSource extends TCoreSource = TCoreSource,
> {
    removedVariableAssociations: TCoreVariableSourceAssociation[]
    removedExpressionAssociations: TCoreExpressionSourceAssociation[]
    removedOrphanSources: TSource[]
}

export class SourceManager<TSource extends TCoreSource = TCoreSource> {
    // Maps
    private sources: Map<string, TSource>
    private variableAssociations: Map<string, TCoreVariableSourceAssociation>
    private expressionAssociations: Map<string, TCoreExpressionSourceAssociation>

    // Reverse indices
    private sourceToAssociations: Map<string, Set<string>>
    private variableToAssociations: Map<string, Set<string>>
    private expressionToAssociations: Map<string, Set<string>>

    // ... constructor, mutations, queries, snapshot, fromSnapshot
}
```

Implement all methods per spec. Key behaviors:
- `removeSource(id)` removes source + all its associations via `sourceToAssociations` index
- `removeAssociationsForVariable(varId)` removes variable associations + runs orphan check on each affected source
- `removeAssociationsForExpression(exprId)` removes expression associations + runs orphan check
- Orphan check: if source has zero entries in `sourceToAssociations`, delete the source
- All removal methods return `TSourceRemovalResult` with the removed entities

- [ ] **Step 4: Export SourceManager from library barrel**

In `src/lib/index.ts`, add:
```typescript
export { SourceManager } from "./core/source-manager.js"
export type { TSourceManagerSnapshot, TSourceRemovalResult } from "./core/source-manager.js"
```

- [ ] **Step 5: Run tests**

Run: `pnpm run test`
Expected: PASS for SourceManager basics.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/source-manager.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: implement SourceManager with storage, mutations, and queries"
```

### Task 8: SourceManager — orphan cleanup

**Files:**
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for orphan cleanup**

In the `SourceManager` describe block, add tests for:
- Remove a variable association → source with zero remaining associations is auto-deleted
- Remove an expression association → source with zero remaining associations is auto-deleted
- Remove a variable association → source with other remaining associations survives
- `removeAssociationsForVariable` with multiple associations → orphaned sources included in return value
- `removeAssociationsForExpression` with multiple associations → orphaned sources included in return value

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL on orphan tests (if not yet implemented in step 3 above; otherwise PASS).

- [ ] **Step 3: Verify/fix orphan cleanup implementation**

Ensure the orphan check runs after every association removal. The `removeAssociationsForVariable` and `removeAssociationsForExpression` methods should:
1. Collect all affected source IDs before removing associations
2. Remove the associations
3. For each affected source, check if `sourceToAssociations.get(sourceId)` is empty
4. If empty, remove the source and include it in the `removedOrphanSources` return

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/core.test.ts src/lib/core/source-manager.ts
git commit -m "feat: add SourceManager orphan cleanup with tests"
```

### Task 9: SourceManager — snapshot and restoration

**Files:**
- Modify: `test/core.test.ts`
- Modify: `src/lib/core/source-manager.ts`

- [ ] **Step 1: Write failing tests for snapshot/restore**

Tests:
- `snapshot()` returns all sources + both association arrays
- `fromSnapshot()` rebuilds manager with correct state and indices
- Round-trip: add sources/associations → snapshot → fromSnapshot → queries return same data
- `fromSnapshot()` with orphaned source (zero associations) restores it verbatim (no cleanup)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Implement snapshot/fromSnapshot**

`snapshot()`: return `{ sources: [...this.sources.values()], variableSourceAssociations: [...this.variableAssociations.values()], expressionSourceAssociations: [...this.expressionAssociations.values()] }` sorted by ID.

`static fromSnapshot(data)`: construct a new `SourceManager`, populate all maps and rebuild all reverse indices from the data. No validation — verbatim restoration.

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add test/core.test.ts src/lib/core/source-manager.ts
git commit -m "feat: add SourceManager snapshot and restoration"
```

---

## Chunk 3: Engine Integration

### Task 10: Source management interface

**Files:**
- Create: `src/lib/core/interfaces/source-management.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts`

- [ ] **Step 1: Create TSourceManagement interface**

Create `src/lib/core/interfaces/source-management.interfaces.ts`:

```typescript
import type { TCoreSource, TCoreVariableSourceAssociation, TCoreExpressionSourceAssociation } from "../../schemata/index.js"
import type { TCoreMutationResult } from "../../types/mutation.js"
// ... other imports

export interface TSourceManagement<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TSource extends TCoreSource = TCoreSource,
> {
    addSource(source: TOptionalChecksum<TSource>): TCoreMutationResult<TSource, TExpr, TVar, TPremise, TArg, TSource>
    removeSource(sourceId: string): TCoreMutationResult<TSource | undefined, TExpr, TVar, TPremise, TArg, TSource>
    addVariableSourceAssociation(sourceId: string, variableId: string): TCoreMutationResult<TCoreVariableSourceAssociation, TExpr, TVar, TPremise, TArg, TSource>
    removeVariableSourceAssociation(associationId: string): TCoreMutationResult<TCoreVariableSourceAssociation | undefined, TExpr, TVar, TPremise, TArg, TSource>
    addExpressionSourceAssociation(sourceId: string, expressionId: string, premiseId: string): TCoreMutationResult<TCoreExpressionSourceAssociation, TExpr, TVar, TPremise, TArg, TSource>
    removeExpressionSourceAssociation(associationId: string): TCoreMutationResult<TCoreExpressionSourceAssociation | undefined, TExpr, TVar, TPremise, TArg, TSource>
    getSources(): TSource[]
    getSource(sourceId: string): TSource | undefined
    getAssociationsForSource(sourceId: string): { variable: TCoreVariableSourceAssociation[]; expression: TCoreExpressionSourceAssociation[] }
    getAssociationsForVariable(variableId: string): TCoreVariableSourceAssociation[]
    getAssociationsForExpression(expressionId: string): TCoreExpressionSourceAssociation[]
    getAllVariableSourceAssociations(): TCoreVariableSourceAssociation[]
    getAllExpressionSourceAssociations(): TCoreExpressionSourceAssociation[]
}
```

Note: Generic parameter ordering is `<TArg, TPremise, TExpr, TVar, TSource>` — matching the convention of sibling interfaces. `addSource` accepts `TOptionalChecksum<TSource>` (not `TExpressionInput` which is expression-specific). `getAllVariableSourceAssociations` and `getAllExpressionSourceAssociations` are needed by `diffArguments`.

Add JSDoc documentation to each method following the pattern in `argument-engine.interfaces.ts`.

- [ ] **Step 2: Add TSource to existing argument-engine interfaces**

In `argument-engine.interfaces.ts`, add `TSource extends TCoreSource = TCoreSource` as the 5th generic parameter to every interface (`TPremiseCrud`, `TVariableManagement`, `TArgumentExpressionQueries`, `TArgumentRoleState`, `TArgumentEvaluation`, `TArgumentLifecycle`, `TArgumentIdentity`). Thread it through all `TCoreMutationResult` and `TCoreChangeset` return types.

- [ ] **Step 3: Add TSource to premise-engine interfaces**

In `premise-engine.interfaces.ts`, add `TSource extends TCoreSource = TCoreSource` as the 5th generic parameter to every interface. Add source convenience methods to a new or existing interface:

```typescript
// Add to an appropriate interface (e.g., TExpressionMutations or a new TPremiseSourceManagement)
addExpressionSourceAssociation(sourceId: string, expressionId: string): TCoreMutationResult<TCoreExpressionSourceAssociation, ...>
removeExpressionSourceAssociation(associationId: string): TCoreMutationResult<TCoreExpressionSourceAssociation | undefined, ...>
getSourceAssociationsForExpression(expressionId: string): TCoreExpressionSourceAssociation[]
```

- [ ] **Step 4: Export from interfaces barrel**

In `src/lib/core/interfaces/index.ts`, add:
```typescript
export type * from "./source-management.interfaces.js"
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm run typecheck`
Expected: Failures in engine implementation files (they don't implement the new interface methods yet). This is expected.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/interfaces/
git commit -m "feat: add TSourceManagement interface and TSource to all engine interfaces"
```

### Task 11: ArgumentEngine — source management implementation

**Files:**
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for ArgumentEngine source CRUD**

Add a new `describe("ArgumentEngine source management")` block. Tests:
- `addSource` — adds source, returns it with checksum, appears in `getSources()`
- `addSource` duplicate ID — throws
- `removeSource` — removes source, returns it, no longer in `getSources()`
- `removeSource` nonexistent — returns undefined
- `addVariableSourceAssociation` — validates source and variable exist, creates association
- `addVariableSourceAssociation` invalid source — throws
- `addVariableSourceAssociation` invalid variable — throws
- `addExpressionSourceAssociation` — validates source, premise, and expression exist
- `addExpressionSourceAssociation` invalid expression — throws
- `removeVariableSourceAssociation` / `removeExpressionSourceAssociation` — removes, returns association
- Query methods: `getAssociationsForSource`, `getAssociationsForVariable`, `getAssociationsForExpression`

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Implement source management on ArgumentEngine**

In `argument-engine.ts`:
1. Add `TSource` as 5th generic parameter to the class
2. Add `private sourceManager: SourceManager<TSource>` field
3. Initialize `SourceManager` in constructor
4. Pass `sourceManager` to each `PremiseEngine` via deps
5. Implement all `TSourceManagement` methods:
   - `addSource`: attach checksum, delegate to `sourceManager.addSource()`, build changeset
   - `removeSource`: delegate to `sourceManager.removeSource()`, build changeset with cascaded associations
   - `addVariableSourceAssociation`: validate source exists (`sourceManager.getSource`), validate variable exists (`variableManager`), create association with ID + checksum, delegate to `sourceManager`
   - `addExpressionSourceAssociation`: validate source, get `PremiseEngine` for premiseId, validate expression exists in that premise, create association, delegate
   - Remove association methods: delegate to `sourceManager`, build changeset
   - Query methods: direct delegation

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS for source CRUD tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: implement source management on ArgumentEngine"
```

### Task 12: PremiseEngine — source convenience methods and cascade

**Files:**
- Modify: `src/lib/core/premise-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for PremiseEngine source methods**

Tests:
- `addExpressionSourceAssociation(sourceId, expressionId)` — fills premiseId, delegates correctly
- `addExpressionSourceAssociation` with nonexistent expression — throws
- `removeExpressionSourceAssociation` — delegates correctly
- `getSourceAssociationsForExpression` — returns correct associations
- `removeExpression` with expression-source association → association removed, orphan source removed
- `removeExpression` cascade (operator collapse) → associations removed for each collapsed expression

Note: PremiseEngine tests need an ArgumentEngine to set up the SourceManager dependency. Build fixtures using ArgumentEngine and access the PremiseEngine through it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Implement PremiseEngine source integration**

In `premise-engine.ts`:
1. Add `TSource` as 5th generic parameter
2. Accept `sourceManager?: SourceManager<TSource>` in constructor deps
3. Implement convenience methods:
   - `addExpressionSourceAssociation(sourceId, expressionId)`: validate expression exists in this premise via `this.expressions`, fill in `this.premiseId`, delegate to `sourceManager`
   - `removeExpressionSourceAssociation(associationId)`: delegate to `sourceManager`
   - `getSourceAssociationsForExpression(expressionId)`: delegate to `sourceManager`
4. Extend `removeExpression`: after each expression is actually removed, call `sourceManager.removeAssociationsForExpression(exprId)`. Capture removed associations and orphan sources, add to changeset.

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/premise-engine.ts test/core.test.ts
git commit -m "feat: add source convenience methods and cascade to PremiseEngine"
```

### Task 13: ArgumentEngine — cascade extensions (depends on Task 12)

**Files:**
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for source cascades**

Tests:
- `removeVariable` with variable-source association → association deleted, source orphaned and deleted
- `removeVariable` with variable-source association → source has other associations, source survives
- `removeVariable` cascade through expressions → expression-source associations also removed (handled transitively by PremiseEngine's extended `removeExpression` from Task 12)
- `removePremise` → expression-source associations for that premise's expressions are removed
- `removePremise` → orphaned sources are deleted
- `removeSource` → all variable and expression associations cascade-deleted
- Changeset from `removeVariable` includes removed associations and orphaned sources
- Changeset from `removePremise` includes removed expression-source associations and orphaned sources

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Extend removeVariable cascade**

In `removeVariable()`, after the existing expression cascade (which now transitively handles expression-source associations via PremiseEngine's `removeExpression`):
1. Call `sourceManager.removeAssociationsForVariable(variableId)` — this handles only *variable*-source associations (expression-source cleanup is already handled transitively in step above)
2. Capture the returned removed associations and orphan sources
3. Add them to the `ChangeCollector`

Note: orphan source cleanup in this step considers sources that may have lost all associations from *both* the expression cascade and the variable-association removal combined.

- [ ] **Step 4: Extend removePremise cascade**

In `removePremise()`, during the existing expression index cleanup loop (which iterates all expressions in the premise):
1. For each expression, call `sourceManager.removeAssociationsForExpression(expr.id)`
2. Capture returned removed associations and orphan sources
3. Add them to the `ChangeCollector`

- [ ] **Step 5: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: extend ArgumentEngine cascades for source cleanup"
```

---

## Chunk 4: Diff, Snapshot & Validation

### Task 14: Snapshot expansion

**Files:**
- Modify: `src/lib/core/argument-engine.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for snapshots with sources**

Tests:
- `snapshot()` includes sources and both association types
- `rollback()` restores sources and associations to previous state
- `fromSnapshot()` static factory rebuilds engine with sources and associations
- Round-trip: add sources/associations → snapshot → modify → rollback → verify restored

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Extend snapshot/rollback/fromSnapshot**

In `argument-engine.ts`:
1. Add `TSource` as the 5th generic parameter to `TArgumentEngineSnapshot`
2. `snapshot()`: include `sourceManager.snapshot()` fields in the returned snapshot
3. `rollback()`: reconstruct `SourceManager` from snapshot data using `SourceManager.fromSnapshot()`. Pass new `sourceManager` to each `PremiseEngine` rebuilt during rollback.
4. `fromSnapshot()`: same — rebuild `SourceManager` from snapshot, pass to each `PremiseEngine.fromSnapshot()` call
5. Update `PremiseEngine.fromSnapshot()` to accept `sourceManager` as an additional parameter and wire it into the deps
6. Reactive snapshot: include source/association records in `TReactiveSnapshot` construction. Add `sources: boolean` to `reactiveDirty` tracking. Update `markReactiveDirty` to set it when `changes.sources`, `changes.variableSourceAssociations`, or `changes.expressionSourceAssociations` are present. Update `buildReactiveSnapshot` to include source/association records.

`TArgumentEngineSnapshot` gains:
```typescript
sources: TSource[]
variableSourceAssociations: TCoreVariableSourceAssociation[]
expressionSourceAssociations: TCoreExpressionSourceAssociation[]
```

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: include sources in snapshots and rollback"
```

### Task 15: Diff expansion

**Files:**
- Modify: `src/lib/core/diff.ts`
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for source diffs**

Tests:
- Diff two engines: one has a source, the other doesn't → source appears in `added`
- Diff two engines: source removed → appears in `removed`
- Diff two engines: variable-source association added → appears in diff
- Diff two engines: expression-source association removed → appears in diff
- Custom `compareSource` comparator detects field changes on extended source types
- Default comparators for associations return empty changes (immutable associations)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Add default comparators and implement source diffing**

In `diff.ts`:
1. Add `defaultCompareSource`: returns empty array (no diffable fields on base type)
2. Add `defaultCompareVariableSourceAssociation`: compares `sourceId`, `variableId`
3. Add `defaultCompareExpressionSourceAssociation`: compares `sourceId`, `expressionId`, `premiseId`
4. In `diffArguments()`:
   - Add `TSource` as 5th generic parameter
   - Get sources from both engines via `getSources()`
   - Get all associations via `getAllVariableSourceAssociations()` and `getAllExpressionSourceAssociations()` (these two new query methods must be added to `TSourceManagement` and `ArgumentEngine` — add them in this task or back in Task 10/11)
   - Call `diffEntitySet()` for sources, variable associations, and expression associations
   - Include results in the returned `TCoreArgumentDiff`

Export the new default comparators from `src/lib/index.ts`.

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/diff.ts src/lib/index.ts test/core.test.ts
git commit -m "feat: add source and association diffing"
```

### Task 16: Validation expansion

**Files:**
- Modify: `src/lib/core/argument-engine.ts` (or wherever `validateEvaluability` lives)
- Modify: `test/core.test.ts`

- [ ] **Step 1: Write failing tests for source validation**

Tests:
- Engine with orphaned source (via snapshot restoration) → `SOURCE_ORPHANED` warning
- Engine with variable association pointing to nonexistent variable (via snapshot) → `SOURCE_VARIABLE_ASSOCIATION_INVALID_VARIABLE` error
- Engine with expression association pointing to nonexistent expression (via snapshot) → `SOURCE_EXPRESSION_ASSOCIATION_INVALID_EXPRESSION` error
- Engine with expression association pointing to nonexistent premise (via snapshot) → `SOURCE_EXPRESSION_ASSOCIATION_INVALID_PREMISE` error
- Engine with valid sources → no source-related validation issues

Build test fixtures by creating an engine, snapshotting, then manually constructing a corrupted snapshot with invalid associations.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test`
Expected: FAIL

- [ ] **Step 3: Implement validation checks**

In the `validateEvaluability` method (on `ArgumentEngine`), add checks after existing validation:

1. For each variable-source association, verify `variableManager.getVariable(assoc.variableId)` exists → else error `SOURCE_VARIABLE_ASSOCIATION_INVALID_VARIABLE`
2. For each expression-source association:
   - Verify premise exists (`this.premises.has(assoc.premiseId)`) → else error `SOURCE_EXPRESSION_ASSOCIATION_INVALID_PREMISE`
   - Verify expression exists in that premise → else error `SOURCE_EXPRESSION_ASSOCIATION_INVALID_EXPRESSION`
3. For each source, check if it has any associations → if zero, warning `SOURCE_ORPHANED`

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: PASS

- [ ] **Step 5: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck + lint + test + build)

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/argument-engine.ts test/core.test.ts
git commit -m "feat: add source validation checks"
```

---

## Chunk 5: CLI

### Task 17: CLI source schema and path helpers

**Files:**
- Modify: `src/cli/schemata.ts`
- Modify: `src/cli/config.ts`

- [ ] **Step 1: Add CliSourceSchema**

In `src/cli/schemata.ts`, add:

```typescript
import { CoreSourceSchema } from "../lib/schemata/index.js"

export const CliSourceSchema = Type.Intersect([
    CoreSourceSchema,
    Type.Object({ url: Type.String() }),
])
export type TCliSource = Static<typeof CliSourceSchema>
```

- [ ] **Step 2: Add path helpers**

In `src/cli/config.ts`, add (matching the existing `(argumentId, version)` parameter pattern):

```typescript
export function getSourcesDir(argumentId: string, version: number): string {
    return path.join(getVersionDir(argumentId, version), "sources")
}

export function getSourceDir(
    argumentId: string,
    version: number,
    sourceId: string
): string {
    return path.join(getSourcesDir(argumentId, version), sourceId)
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/schemata.ts src/cli/config.ts
git commit -m "feat: add CLI source schema and path helpers"
```

### Task 18: CLI source storage

**Files:**
- Create: `src/cli/storage/sources.ts`

- [ ] **Step 1: Implement source storage functions**

Create `src/cli/storage/sources.ts` following the pattern in `variables.ts` and `premises.ts`. All functions use `(argumentId: string, version: number, ...)` parameters — matching the existing storage convention:

```typescript
// Source meta I/O
export async function readSourceMeta(argumentId: string, version: number, sourceId: string): Promise<TCliSource>
export async function writeSourceMeta(argumentId: string, version: number, sourceId: string, data: TCliSource): Promise<void>
export async function listSourceIds(argumentId: string, version: number): Promise<string[]>
export async function deleteSourceDir(argumentId: string, version: number, sourceId: string): Promise<void>

// Association I/O
export async function readVariableAssociations(argumentId: string, version: number): Promise<TCoreVariableSourceAssociation[]>
export async function writeVariableAssociations(argumentId: string, version: number, data: TCoreVariableSourceAssociation[]): Promise<void>
export async function readExpressionAssociations(argumentId: string, version: number): Promise<TCoreExpressionSourceAssociation[]>
export async function writeExpressionAssociations(argumentId: string, version: number, data: TCoreExpressionSourceAssociation[]): Promise<void>
```

Use `getSourcesDir` / `getSourceDir` from config. Association files are `variable-associations.json` and `expression-associations.json` in the sources directory. Handle missing files gracefully (return empty arrays), matching the pattern in `variables.ts`.

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/storage/sources.ts
git commit -m "feat: add CLI source storage I/O"
```

### Task 19: CLI engine hydration and persistence

**Files:**
- Modify: `src/cli/engine.ts`

- [ ] **Step 1: Extend hydrateEngine to load sources and associations**

After loading variables and premises, add:
1. Read source IDs from disk via `listSourceIds()`
2. For each source, read meta and call `engine.addSource()`
3. Read variable associations via `readVariableAssociations()` and call `engine.addVariableSourceAssociation()` for each
4. Read expression associations via `readExpressionAssociations()` and call `engine.addExpressionSourceAssociation()` for each

Handle the case where the sources directory doesn't exist (no sources yet) — return empty arrays.

- [ ] **Step 2: Extend persistEngine to write sources and associations**

In `persistEngine()` (or equivalent persist function), add:
1. Create sources directory via `fs.mkdir(getSourcesDir(argumentId, version), { recursive: true })`
2. For each source from `engine.getSources()`, write meta via `writeSourceMeta()`
3. Write all variable associations via `writeVariableAssociations(argumentId, version, engine.getAllVariableSourceAssociations())`
4. Write all expression associations via `writeExpressionAssociations(argumentId, version, engine.getAllExpressionSourceAssociations())`

Without this, any source data added through engine methods would be lost after persist/hydrate cycles.

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli/engine.ts
git commit -m "feat: hydrate and persist sources and associations from disk"
```

### Task 20: CLI source commands

**Files:**
- Create: `src/cli/commands/sources.ts`
- Modify: `src/cli/router.ts` (or equivalent routing file)

- [ ] **Step 1: Implement source commands**

Create `src/cli/commands/sources.ts` with handlers for:

1. `add --url <url>` — generate UUID, create source, write meta, print result
2. `remove <sourceId>` — hydrate engine, call `removeSource()`, delete source dir, update association files
3. `list` — read all source metas, print table
4. `show <sourceId>` — read source meta + filter associations, print details
5. `link variable <sourceId> <variableId>` — hydrate engine, call `addVariableSourceAssociation()`, write updated associations
6. `link expression <sourceId> <expressionId>` — hydrate engine, resolve premiseId by iterating `engine.listPremises()` and checking each for the expression (or using expression index if available), then call `addExpressionSourceAssociation()`. `errorExit` if expression not found.
7. `unlink <associationId>` — hydrate engine, check if association ID exists in variable associations (via `getAllVariableSourceAssociations().find(...)`). If found, call `removeVariableSourceAssociation`. Otherwise try `removeExpressionSourceAssociation`. If neither finds it, `errorExit` with "Association not found."

Follow existing command patterns (error handling, output formatting, published version rejection).

- [ ] **Step 2: Wire routing**

In `src/cli.ts` (NOT `src/cli/router.ts`), import `registerSourceCommands` from `./cli/commands/sources.js` and add `registerSourceCommands(sub, argumentId, version)` alongside the other `register*Commands` calls (after `registerAnalysisCommands`).

- [ ] **Step 3: Run typecheck and lint**

Run: `pnpm run typecheck && pnpm run lint`
Expected: PASS (or fix lint issues with `pnpm eslint . --fix` + `pnpm run prettify`)

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/sources.ts src/cli.ts
git commit -m "feat: add CLI source commands"
```

### Task 21: CLI smoke test coverage

**Files:**
- Modify: `scripts/smoke-test.sh`

- [ ] **Step 1: Add source smoke tests**

Add test cases to `scripts/smoke-test.sh`:
1. Add a source with `--url`
2. List sources
3. Show a source
4. Link source to variable
5. Link source to expression
6. Unlink an association
7. Remove a source
8. Verify cascade (remove variable with linked source)

Follow existing smoke test patterns (build first, check exit codes).

- [ ] **Step 2: Run smoke tests**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "test: add source CLI smoke tests"
```

---

## Chunk 6: IEEE Extensions

### Task 22: Extensions subproject setup

**Files:**
- Create: `src/extensions/ieee/index.ts`

No separate `tsconfig` needed — the existing `tsconfig.build.json` already includes `src/**/*.ts` with `rootDir: ./src`, so files at `src/extensions/ieee/*.ts` compile automatically to `dist/extensions/ieee/*.js`.

- [ ] **Step 1: Create extensions directory structure**

```bash
mkdir -p src/extensions/ieee
```

- [ ] **Step 2: Create placeholder barrel**

Create `src/extensions/ieee/index.ts` with a placeholder comment. Content will be added in Tasks 23-24.

- [ ] **Step 3: Commit**

```bash
git add src/extensions/
git commit -m "feat: set up extensions subproject structure"
```

### Task 23: IEEE reference schemas

**Files:**
- Create: `src/extensions/ieee/references.ts`

- [ ] **Step 1: Port IEEEReferenceSchema from proposit-server**

Port the 31 reference type schemas from `.untracked/proposit-server/src/schemas/model/references.ts`. Adapt to use the project's existing TypeBox patterns.

Key adaptations when porting:
- Use `import Type, { type Static } from "typebox"` (not `@sinclair/typebox`)
- Rename all type aliases to use T-prefix per naming conventions: `TReferenceType`, `TBaseReference`, `TBookReference`, etc.
- Standardize schema construction on `Type.Intersect()` for consistency
- Drop server-specific exports (`ReferenceImportRequestSchema`, template strings, etc.)

Key types:
- `TReferenceType` — union of 31 string literals
- Individual reference schemas (e.g., `BookReferenceSchema`, `WebsiteReferenceSchema`, etc.)
- `IEEEReferenceSchema` — discriminated union of all 31 types

Each reference type has `type` as discriminator + type-specific fields (title, authors, year, publisher, url, etc.).

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extensions/ieee/references.ts
git commit -m "feat: port IEEE reference schemas from proposit-server"
```

### Task 24: IEEE source schema and barrel export

**Files:**
- Create: `src/extensions/ieee/source.ts`
- Modify: `src/extensions/ieee/index.ts`

- [ ] **Step 1: Create IEEESourceSchema**

In `src/extensions/ieee/source.ts`:

```typescript
import Type, { type Static } from "typebox"
import { CoreSourceSchema } from "../../lib/schemata/index.js"
import { Nullable } from "../../lib/schemata/shared.js"
import { IEEEReferenceSchema } from "./references.js"

export const IEEESourceSchema = Type.Intersect([
    CoreSourceSchema,
    Type.Object({
        url: Nullable(Type.String()),
        citation: IEEEReferenceSchema,
    }),
])
export type TIEEESource = Static<typeof IEEESourceSchema>
```

- [ ] **Step 2: Create barrel export**

In `src/extensions/ieee/index.ts`:

```typescript
export * from "./references.js"
export * from "./source.js"
```

- [ ] **Step 3: Configure package.json exports**

Add an exports entry in `package.json` so consumers can import from `@polintpro/proposit-core/extensions/ieee`. Use the same `types`/`import` conditional format as the existing `"."` entry:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./extensions/ieee": {
      "types": "./dist/extensions/ieee/index.d.ts",
      "import": "./dist/extensions/ieee/index.js"
    }
  }
}
```

- [ ] **Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck + lint + test + build)

- [ ] **Step 5: Commit**

```bash
git add src/extensions/ieee/ package.json
git commit -m "feat: add IEEE source extension with reference schemas"
```

---

## Chunk 7: Documentation & Final Verification

### Task 25: Documentation sync

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/api-reference.md`
- Modify: `README.md`
- Modify: `CLI_EXAMPLES.md`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts` (JSDoc)
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` (JSDoc)

- [ ] **Step 1: Update CLAUDE.md design rules**

Add source-related design rules to the "Key design rules" section:
- Sources are argument-scoped (like variables), not premise-scoped
- Association types are immutable (create or delete, no update)
- Orphan cleanup: removing all associations for a source auto-deletes the source
- Cascade order: target removal → association removal → orphan source removal

- [ ] **Step 2: Update api-reference.md**

Add sections for:
- `TCoreSource` and association types
- `SourceManager` class
- `TSourceManagement` interface methods on ArgumentEngine
- PremiseEngine convenience methods
- New diff comparators
- New validation codes

- [ ] **Step 3: Update README.md**

Add sources to the concepts section and usage examples.

- [ ] **Step 3b: Update CLI_EXAMPLES.md**

Add a walkthrough demonstrating source workflows: source creation, linking to variables and expressions, listing, showing, unlinking, and removal.

- [ ] **Step 4: Update interface JSDoc**

Ensure all new methods in `argument-engine.interfaces.ts` and `premise-engine.interfaces.ts` have complete JSDoc with `@param`, `@returns`, `@throws` tags.

- [ ] **Step 5: Add documentation sync entries to CLAUDE.md**

Add the new interface file to the Documentation Sync section if source-management interfaces warrant independent tracking.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/api-reference.md README.md CLI_EXAMPLES.md src/lib/core/interfaces/
git commit -m "docs: add sources to documentation and interface JSDoc"
```

### Task 26: Final verification

- [ ] **Step 1: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck + lint + test + build)

- [ ] **Step 2: Run smoke tests**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: PASS

- [ ] **Step 3: Verify exports**

Verify that all new public types and functions are accessible:
```typescript
import {
    CoreSourceSchema, TCoreSource,
    CoreVariableSourceAssociationSchema, TCoreVariableSourceAssociation,
    CoreExpressionSourceAssociationSchema, TCoreExpressionSourceAssociation,
    SourceManager,
    diffArguments, defaultCompareSource,
    // ... etc
} from "@polintpro/proposit-core"
```

- [ ] **Step 4: Final commit if any remaining changes**

```bash
git status  # should be clean
```
