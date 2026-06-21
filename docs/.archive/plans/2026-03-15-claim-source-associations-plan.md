# Claim-Source Associations Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all source associations (variable-source and expression-source) with a global `ClaimSourceLibrary<TAssoc>` and delete `SourceManager` entirely.

**Architecture:** New `ClaimSourceLibrary<TAssoc>` is a standalone generic association store (create-or-delete, no versioning) that validates against `ClaimLookup` and `SourceLookup`. `SourceManager`, `TSourceManagement`, and all expression-source code are deleted. `ArgumentEngine` receives a read-only `TClaimSourceLookup<TAssoc>` instead.

**Tech Stack:** TypeScript, Typebox schemas, Vitest

**Spec:** `docs/plans/2026-03-15-claim-source-associations-design.md`

---

## Chunk 1: New Code (Additive Only)

### Task 1: Schema, types, and interfaces

Add the new schema and type infrastructure. Old schemas stay temporarily for compilation.

**Files:**

- Modify: `src/lib/schemata/source.ts` (add new schema)
- Modify: `src/lib/types/checksum.ts` (add `claimSourceAssociationFields`)
- Modify: `src/lib/consts.ts` (add default fields and `createChecksumConfig` key)
- Modify: `src/lib/core/interfaces/library.interfaces.ts` (add interfaces)
- Modify: `src/lib/core/interfaces/index.ts` (re-export new interfaces)

- [ ] **Step 1: Add `CoreClaimSourceAssociationSchema` to `src/lib/schemata/source.ts`**

Add after line 41 (after `TCoreVariableSourceAssociation` type), before `CoreExpressionSourceAssociationSchema`:

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

- [ ] **Step 2: Add `claimSourceAssociationFields` to `TCoreChecksumConfig` in `src/lib/types/checksum.ts`**

Add after `variableSourceAssociationFields` (line 18):

```typescript
claimSourceAssociationFields?: Set<string>
```

- [ ] **Step 3: Add default checksum fields in `src/lib/consts.ts`**

Add after line 35 (after `variableSourceAssociationFields` block):

```typescript
claimSourceAssociationFields: new Set([
    "id",
    "claimId",
    "claimVersion",
    "sourceId",
    "sourceVersion",
]),
```

Add `"claimSourceAssociationFields"` to the `keys` array in `createChecksumConfig` (line 63).

- [ ] **Step 4: Add interfaces to `src/lib/core/interfaces/library.interfaces.ts`**

Add import and interfaces at end of file:

```typescript
import type { TCoreClaimSourceAssociation } from "../../schemata/source.js"

/** Narrow read-only interface for claim-source association lookups. */
export interface TClaimSourceLookup<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> {
    getForClaim(claimId: string): TAssoc[]
    getForSource(sourceId: string): TAssoc[]
    get(id: string): TAssoc | undefined
}

/** Serializable snapshot of a ClaimSourceLibrary. */
export type TClaimSourceLibrarySnapshot<
    TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation,
> = {
    claimSourceAssociations: TAssoc[]
}
```

- [ ] **Step 5: Re-export from `src/lib/core/interfaces/index.ts`**

Add `TClaimSourceLookup` and `TClaimSourceLibrarySnapshot` to the `library.interfaces.js` re-export block (lines 25-30).

- [ ] **Step 6: Verify compilation**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/schemata/source.ts src/lib/types/checksum.ts src/lib/consts.ts src/lib/core/interfaces/library.interfaces.ts src/lib/core/interfaces/index.ts
git commit -m "feat: add CoreClaimSourceAssociationSchema and supporting types"
```

---

### Task 2: `ClaimSourceLibrary` class (TDD)

Build the new class test-first. Implementation code is in the spec under "`ClaimSourceLibrary<TAssoc>` class".

**Files:**

- Create: `src/lib/core/claim-source-library.ts`
- Modify: `test/core.test.ts` (add new describe block at bottom)

**Note:** Test imports use extensionless paths (matching existing test file convention). `.js` extensions are only required in `src/cli/` and `src/lib/`.

- [ ] **Step 1: Write failing tests for `add`, `remove`, queries, snapshot, and generic extension**

Add a new `describe("ClaimSourceLibrary")` block at the end of `test/core.test.ts`. Add import at top of file:

```typescript
import { ClaimSourceLibrary } from "../src/lib/core/claim-source-library"
```

Add the full test block with helpers and all test cases — see spec sections "Mutations", "Queries", "Snapshot/restore" for the API surface to test. Tests should cover:

- `add` — happy path, duplicate ID, missing claim, missing source
- `remove` — happy path, not found, index cleanup
- `getForClaim`, `getForSource`, `getAll`, `filter` — query coverage
- `snapshot`/`fromSnapshot` — round-trip
- Generic `TAssoc` extension — extended fields preserved through add, snapshot, filter

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | tail -20`
Expected: FAIL (cannot find `ClaimSourceLibrary`)

- [ ] **Step 3: Implement `ClaimSourceLibrary`**

Create `src/lib/core/claim-source-library.ts` with the full class implementation. Follow the `SourceLibrary` and `ClaimLibrary` patterns for checksum computation and `fromSnapshot` (bypass validation in `fromSnapshot`, load directly into backing store).

The class implements `TClaimSourceLookup<TAssoc>`.

- [ ] **Step 4: Run all tests**

Run: `pnpm run test`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/claim-source-library.ts test/core.test.ts
git commit -m "feat: add ClaimSourceLibrary class with full test coverage"
```

---

## Chunk 2: Delete Source Associations and SourceManager

### Task 3: Delete `SourceManager` and `TSourceManagement`

Remove the files and all their re-exports.

**Files:**

- Delete: `src/lib/core/source-manager.ts`
- Delete: `src/lib/core/interfaces/source-management.interfaces.ts`
- Modify: `src/lib/core/interfaces/index.ts` (remove re-exports)
- Modify: `src/lib/index.ts` (remove exports of `SourceManager`, `TSourceManagerSnapshot`, `TSourceAssociationRemovalResult`, `TSourceManagement`)

- [ ] **Step 1: Delete `src/lib/core/source-manager.ts`**
- [ ] **Step 2: Delete `src/lib/core/interfaces/source-management.interfaces.ts`**
- [ ] **Step 3: Remove re-exports from `src/lib/core/interfaces/index.ts`**
- [ ] **Step 4: Remove exports from `src/lib/index.ts`** — `SourceManager`, `TSourceManagerSnapshot`, `TSourceAssociationRemovalResult`, all source management types
- [ ] **Step 5: Commit (compilation will fail — expected)**

```bash
git add -A
git commit -m "refactor: delete SourceManager and TSourceManagement"
```

---

### Task 4: Remove source associations from types and helpers

Clean up all type files, `ChangeCollector`, and diff module.

**Files:**

- Modify: `src/lib/schemata/source.ts` (delete old schemas)
- Modify: `src/lib/types/checksum.ts` (remove old fields)
- Modify: `src/lib/types/mutation.ts` (remove association fields from `TCoreChangeset`)
- Modify: `src/lib/types/reactive.ts` (remove association fields from `TReactiveSnapshot`)
- Modify: `src/lib/types/diff.ts` (remove association fields from `TCoreArgumentDiff`, `TCoreDiffOptions`)
- Modify: `src/lib/core/change-collector.ts` (remove all source association tracking)
- Modify: `src/lib/core/diff.ts` (remove source comparators and diffing)
- Modify: `src/lib/consts.ts` (remove old checksum fields from defaults and `createChecksumConfig` keys)
- Modify: `src/lib/index.ts` (remove diff comparator exports)

- [ ] **Step 1: Delete old schemas from `src/lib/schemata/source.ts`**

Delete `CoreVariableSourceAssociationSchema`, `TCoreVariableSourceAssociation`, `CoreExpressionSourceAssociationSchema`, `TCoreExpressionSourceAssociation`.

- [ ] **Step 2: Remove old checksum config fields**

In `src/lib/types/checksum.ts`: remove `variableSourceAssociationFields` and `expressionSourceAssociationFields`.

In `src/lib/consts.ts`: remove both field sets from `DEFAULT_CHECKSUM_CONFIG` and their entries from the `keys` array in `createChecksumConfig`.

- [ ] **Step 3: Remove association fields from `TCoreChangeset` in `src/lib/types/mutation.ts`**

Remove `variableSourceAssociations` and `expressionSourceAssociations` fields and their imports.

- [ ] **Step 4: Remove association fields from `TReactiveSnapshot` in `src/lib/types/reactive.ts`**

Remove `variableSourceAssociations` and `expressionSourceAssociations` fields and their imports.

- [ ] **Step 5: Remove association fields from diff types in `src/lib/types/diff.ts`**

Remove `variableSourceAssociations` and `expressionSourceAssociations` from `TCoreArgumentDiff`. Remove `compareVariableSourceAssociation` and `compareExpressionSourceAssociation` from `TCoreDiffOptions`. Remove imports.

- [ ] **Step 6: Remove all source tracking from `ChangeCollector` in `src/lib/core/change-collector.ts`**

Remove `variableSourceAssociations` and `expressionSourceAssociations` private fields, all four `added*`/`removed*` methods, and their inclusion in `toChangeset()`.

- [ ] **Step 7: Remove source diffing from `src/lib/core/diff.ts`**

Delete `defaultCompareVariableSourceAssociation` and `defaultCompareExpressionSourceAssociation` functions. Remove all source association diffing from `diffArguments`. Remove their exports from `src/lib/index.ts`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: remove all source association types, comparators, and tracking"
```

---

### Task 5: Update `PremiseEngine`

Remove all source-related code from `PremiseEngine` and its interface.

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (remove sourceManager dep, cascade blocks, expression-source methods)
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` (remove expression-source methods from `TExpressionMutations`)

- [ ] **Step 1: Remove expression-source methods from `TExpressionMutations` interface**

In `src/lib/core/interfaces/premise-engine.interfaces.ts`: delete `addExpressionSourceAssociation`, `removeExpressionSourceAssociation`, `getSourceAssociationsForExpression`. Remove `TCoreExpressionSourceAssociation` import.

- [ ] **Step 2: Remove `sourceManager` from `PremiseEngine` constructor deps**

Remove `sourceManager?: SourceManager` from the `deps` parameter object type. Remove the `SourceManager` import. Remove `this.sourceManager` field and its assignment.

- [ ] **Step 3: Remove expression-source methods from `PremiseEngine`**

Delete `addExpressionSourceAssociation`, `removeExpressionSourceAssociation`, `getSourceAssociationsForExpression` method implementations.

- [ ] **Step 4: Remove source cascade from `removeExpression`**

In `removeExpression`, delete the block that calls `this.sourceManager.removeAssociationsForExpression()` and notifies the collector.

- [ ] **Step 5: Remove `sourceManager` from `PremiseEngine.fromSnapshot()`**

Remove the 5th `sourceManager?: SourceManager` parameter from the static `fromSnapshot` method.

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/interfaces/premise-engine.interfaces.ts
git commit -m "refactor: remove all source association code from PremiseEngine"
```

---

### Task 6: Update `ArgumentEngine`

Add `TAssoc` generic and `claimSourceLibrary` parameter. Remove all source management code.

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (heavy edits)

- [ ] **Step 1: Add `TAssoc` generic parameter and `claimSourceLibrary` to class and constructor**

Add 7th generic `TAssoc extends TCoreClaimSourceAssociation = TCoreClaimSourceAssociation`. Add `claimSourceLibrary: TClaimSourceLookup<TAssoc>` as 4th constructor parameter. Store as private field. Add necessary imports, remove `SourceManager` import.

- [ ] **Step 2: Remove `TSourceManagement` from `implements` clause**

Remove `TSourceManagement<TArg, TPremise, TExpr, TVar>` from the `implements` list.

- [ ] **Step 3: Delete `sourceManager` private field and all its usages**

Remove `private sourceManager: SourceManager` field, its initialization in the constructor, and `sourceManager: this.sourceManager` from the `PremiseEngine` deps object in `createPremiseWithId()`.

- [ ] **Step 4: Delete all source association methods**

Delete all `TSourceManagement` method implementations: `addVariableSourceAssociation`, `removeVariableSourceAssociation`, `addExpressionSourceAssociation`, `removeExpressionSourceAssociation`, `getAssociationsForSource`, `getAssociationsForVariable`, `getAssociationsForExpression`, `getAllVariableSourceAssociations`, `getAllExpressionSourceAssociations`.

- [ ] **Step 5: Remove source cascade from `removeVariable`**

Delete the block that calls `this.sourceManager.removeAssociationsForVariable()`. Also remove the `expressionSourceAssociations` collector block that propagates expression-source changes from `deleteExpressionsUsingVariable`.

- [ ] **Step 6: Remove source cascade from `removePremise`**

Delete the block that calls `sourceManager.removeAssociationsForExpression()` for each removed expression.

- [ ] **Step 7: Remove source association validation from `validate()`**

Delete the block that validates variable-source and expression-source associations.

- [ ] **Step 8: Remove `reactiveDirty.sources` and reactive snapshot source code**

Remove `sources: boolean` from `reactiveDirty`. Remove all source-related dirty-marking. Remove source association record construction from `toReactiveSnapshot()` / `buildReactiveSnapshot()`.

- [ ] **Step 9: Remove source association checksums from argument checksum**

Remove the loop that adds variable-source and expression-source association checksums to the checksum map.

- [ ] **Step 10: Update `TArgumentEngineSnapshot`**

Remove `sources?: TSourceManagerSnapshot` field.

- [ ] **Step 11: Update `fromSnapshot` static method**

Add `claimSourceLibrary: TClaimSourceLookup<TAssoc>` parameter. Remove `SourceManager.fromSnapshot()` call. Remove `sourceManager` from `PremiseEngine.fromSnapshot()` calls. Add `TAssoc` to the method's generic signature.

- [ ] **Step 12: Update `fromData` static method**

Add `claimSourceLibrary: TClaimSourceLookup<TAssoc>` parameter. Remove source association loading. Add `TAssoc` to the method's generic signature.

- [ ] **Step 13: Update `rollback` method**

Remove source manager restoration. Pass stored `this.claimSourceLibrary` in reconstruction. Remove `sourceManager` from `PremiseEngine.fromSnapshot()` calls.

- [ ] **Step 14: Update `snapshot` method**

Remove `sources: this.sourceManager.snapshot()` from the returned snapshot.

- [ ] **Step 15: Verify compilation**

Run: `pnpm run typecheck`
Expected: PASS (all references now updated)

- [ ] **Step 16: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "refactor: replace SourceManager with TClaimSourceLookup in ArgumentEngine"
```

---

### Task 7: Update barrel exports and add `ClaimSourceLibrary` export

**Files:**

- Modify: `src/lib/index.ts`

- [ ] **Step 1: Add `ClaimSourceLibrary` export**

Add export from `./core/claim-source-library.js`. Verify `TCoreClaimSourceAssociation` and `CoreClaimSourceAssociationSchema` are re-exported via the existing `export * from "./schemata/index.js"` chain. Verify `TClaimSourceLookup` and `TClaimSourceLibrarySnapshot` are re-exported via the interfaces barrel.

- [ ] **Step 2: Remove stale exports**

Remove any remaining exports that reference deleted types.

- [ ] **Step 3: Verify compilation and run full lint**

Run: `pnpm run typecheck && pnpm eslint . --fix`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/index.ts
git commit -m "refactor: update barrel exports for claim-source migration"
```

---

### Task 8: Test cleanup

Remove old source association tests, update test fixtures to pass new constructor arguments.

**Files:**

- Modify: `test/core.test.ts` (remove describe blocks, update fixtures)
- Modify: `test/diff-renderer.test.ts` (remove fixture fields)

- [ ] **Step 1: Create `TClaimSourceLookup` stub for tests**

Add near the top of `test/core.test.ts`:

```typescript
import type { TClaimSourceLookup } from "../src/lib/core/interfaces/library.interfaces"

const EMPTY_CLAIM_SOURCE_LOOKUP: TClaimSourceLookup = {
    getForClaim: () => [],
    getForSource: () => [],
    get: () => undefined,
}
```

- [ ] **Step 2: Update all `ArgumentEngine` constructor calls**

Search for `new ArgumentEngine(` and `ArgumentEngine.fromSnapshot(` and `ArgumentEngine.fromData(` throughout the test file. Add `EMPTY_CLAIM_SOURCE_LOOKUP` as the 4th argument (after `sourceLibrary`, before `options`).

- [ ] **Step 3: Remove all `SourceManager` test blocks**

Delete the entire `describe("SourceManager")` block and all its sub-describes.

- [ ] **Step 4: Remove all variable-source and expression-source test blocks from `ArgumentEngine` tests**

Delete `addVariableSourceAssociation`, `removeVariableSourceAssociation`, `addExpressionSourceAssociation`, `removeExpressionSourceAssociation`, `getAssociationsForVariable`, `getAssociationsForExpression`, `getAllVariableSourceAssociations`, `getAllExpressionSourceAssociations`, `getAssociationsForSource` test blocks.

- [ ] **Step 5: Update cascade tests**

In `removeVariable`, `removePremise`, `removeExpression` test blocks: remove assertions about source association removal. Keep structural cascade assertions.

- [ ] **Step 6: Remove source diff test blocks**

Delete `defaultCompareVariableSourceAssociation` and `defaultCompareExpressionSourceAssociation` describe blocks. Remove source association setup code (adding associations to engines before diffing) and assertions from `diffArguments` tests.

- [ ] **Step 7: Update `test/diff-renderer.test.ts` fixtures**

Remove `variableSourceAssociations` and `expressionSourceAssociations` fields from fixture objects.

- [ ] **Step 8: Remove stale imports**

Remove imports of `SourceManager`, `TSourceAssociationRemovalResult`, `TCoreVariableSourceAssociation`, `TCoreExpressionSourceAssociation`, and any other deleted types.

- [ ] **Step 9: Run full check**

Run: `pnpm run check`
Expected: All PASS (typecheck + lint + test + build)

- [ ] **Step 10: Fix any lint issues**

Run: `pnpm eslint . --fix && pnpm run prettify`

- [ ] **Step 11: Commit**

```bash
git add test/core.test.ts test/diff-renderer.test.ts
git commit -m "test: update tests for claim-source association migration"
```

---

## Chunk 3: CLI and Documentation

### Task 9: CLI layer

Update commands, storage, and engine hydration.

**Files:**

- Modify: `src/cli/commands/sources.ts`
- Modify: `src/cli/storage/sources.ts`
- Modify: `src/cli/engine.ts`
- Modify: `src/cli/config.ts`
- Modify: `src/cli/schemata.ts`

- [ ] **Step 1: Remove argument-scoped source storage**

In `src/cli/storage/sources.ts`: delete `readVariableAssociations`, `writeVariableAssociations`, `variableAssociationsPath`, `VariableAssociationSchema`, `readExpressionAssociations`, `writeExpressionAssociations`, `expressionAssociationsPath`, `ExpressionAssociationSchema`, and source-entity functions (`readSourceMeta`, `writeSourceMeta`, `listSourceIds`, `deleteSourceDir`).

- [ ] **Step 2: Add global claim-source association storage**

In `src/cli/storage/sources.ts`: add `readClaimSourceAssociations()`, `writeClaimSourceAssociations()`, and `claimSourceAssociationsPath()` using the global path `path.join(getStateDir(), "claim-source-associations.json")`. These do NOT take `argumentId`/`version` parameters.

- [ ] **Step 3: Remove argument-scoped source path helpers**

In `src/cli/config.ts`: remove `getSourcesDir()` and `getSourceDir()` if they only served source association storage.

- [ ] **Step 4: Remove source CLI schemas**

In `src/cli/schemata.ts`: remove `CliSourceMetaSchema` and any schemas referencing deleted association types.

- [ ] **Step 5: Update engine hydration/persistence**

In `src/cli/engine.ts`:

- Remove all source association reads/writes from `hydrateEngine` and `persistEngine`
- Update `ArgumentEngine` constructor call to pass a `TClaimSourceLookup` (hydrated from global storage or an empty lookup)
- Add `hydrateClaimSourceLibrary()` and `persistClaimSourceLibrary()` helper functions for global lifecycle

- [ ] **Step 6: Update source commands**

In `src/cli/commands/sources.ts`:

- Replace `link-variable` with `link-claim` calling `ClaimSourceLibrary.add()`
- Remove `link-expression` command
- Simplify `unlink` to only handle claim-source associations
- Update command to hydrate/persist `ClaimSourceLibrary` using the global helpers

- [ ] **Step 7: Build and smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Note: Known pre-existing failure at `variables create`. Verify no new failures.

- [ ] **Step 8: Commit**

```bash
git add src/cli/
git commit -m "refactor: update CLI for claim-source associations"
```

---

### Task 10: Documentation sync

Update all documentation per CLAUDE.md Documentation Sync rules.

**Files:**

- Modify: `docs/api-reference.md`
- Modify: `README.md`
- Modify: `CLI_EXAMPLES.md`
- Modify: `scripts/smoke-test.sh`
- Modify: `CLAUDE.md`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts` (JSDoc)
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts` (JSDoc)
- Modify: `src/lib/core/interfaces/library.interfaces.ts` (JSDoc — already added in Task 1)

- [ ] **Step 1: Update `docs/api-reference.md`**

Remove all source association sections (variable and expression). Add `ClaimSourceLibrary` class documentation. Update `ArgumentEngine` constructor signature (7 generics, 4 library params). Remove `TSourceManagement`. Remove `SourceManager`. Update `TCoreChangeset`, `TCoreArgumentDiff`, `TReactiveSnapshot`.

- [ ] **Step 2: Update `README.md`**

Replace source association concept references with claim-source.

- [ ] **Step 3: Update `CLI_EXAMPLES.md`**

Replace `sources link-variable` and `sources link-expression` examples with `sources link-claim`.

- [ ] **Step 4: Update `scripts/smoke-test.sh`**

Replace source association commands. Update expected JSON output paths.

- [ ] **Step 5: Update `CLAUDE.md`**

Update design rules: constructor signature, remove all source cascade rules, remove association immutability rule (now on `ClaimSourceLibrary`), update libraries-required-by-ArgumentEngine. Remove the `source-management.interfaces.ts` entry from the Documentation Sync section (the file is deleted in this migration).

- [ ] **Step 6: Update interface JSDoc**

Update JSDoc in `argument-engine.interfaces.ts` for changed constructor and removed `TSourceManagement`. Update JSDoc in `premise-engine.interfaces.ts` for removed expression-source methods.

- [ ] **Step 7: Run full check**

Run: `pnpm run check`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add docs/ README.md CLI_EXAMPLES.md scripts/smoke-test.sh CLAUDE.md src/lib/core/interfaces/
git commit -m "docs: update documentation for claim-source association migration"
```
