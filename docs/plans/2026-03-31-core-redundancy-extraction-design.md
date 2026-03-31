# Core Redundancy Extraction Design

Mechanical extraction of 5 high-impact redundancy patterns identified in the `src/lib/core/` brain review. Pure refactoring — no behavioral changes, no public API changes.

## 1. `VersionedLibrary<TEntity>` base class

**Problem:** `ClaimLibrary` (245 lines) and `SourceLibrary` (246 lines) are line-for-line duplicates. All 14 methods are structurally identical, differing only in type names, error codes, snapshot property keys, and checksum config keys.

**Solution:** New file `src/lib/core/versioned-library.ts` with an abstract generic base class.

Abstract members subclasses supply:

| Member | Type | Purpose |
|--------|------|---------|
| `entityLabel` | `string` | For error messages ("Claim" / "Source") |
| `schema` | `TSchema` | For `Value.Check` in `validate()` |
| `checksumFieldsKey` | `keyof TChecksumConfig` | Selects `claimFields` vs `sourceFields` |
| `schemaInvalidCode` | `string` | Error code for schema violations |
| `frozenSuccessorCode` | `string` | Error code for frozen-successor violations |
| `snapshotKey` | `string` | Property name in snapshot objects |

Concrete methods in the base: `create`, `update`, `freeze`, `get`, `getCurrent`, `getAll`, `getVersions`, `snapshot`, `validate`, `withValidation`, `restoreFromSnapshot`, `maxVersion`, `computeChecksum`.

`ClaimLibrary` and `SourceLibrary` become ~30-line subclasses that supply the abstract values and preserve their existing public API, type signatures, and `fromSnapshot` static factories.

## 2. `PremiseEngine.finalizeExpressionMutation(collector)`

**Problem:** ~8 expression-mutation methods in `PremiseEngine` end with the same 5-line sequence: `syncRootExpressionId` -> `markDirty` -> `flushAndBuildChangeset` -> `syncExpressionIndex` -> `onMutate`.

**Solution:** Private method `finalizeExpressionMutation(collector: ChangeCollector): TCoreChangeset` that runs the sequence and returns the changeset. The try/finally with `setCollector(null)` stays at each call site since it wraps the full mutation body. The one-off `updateExpression` variant (conditional `markDirty`) stays inline.

## 3. `PremiseEngine.assertVariableExpressionValid(expression)`

**Problem:** 5 expression-mutation methods repeat the same ~20-line block: check variable exists via `hasVariable`, then check circularity via `circularityCheck`.

**Solution:** Private method `assertVariableExpressionValid(expression: TExpressionInput<TExpr>): void`. Called once per method; `wrapExpression` calls it for `newSibling` only. `assertBelongsToArgument` calls remain inline (since `wrapExpression` has two with different targets).

## 4. `ExpressionManager.registerFormulaBuffer(sourceExpr, parentId, position)`

**Problem:** The formula-buffer-insertion pattern (generate ID, build formula expression, attach checksum, register in 3 maps, notify collector) is duplicated ~6 times across `addExpression`, `insertExpression`, and `wrapExpression`.

**Solution:** Private method `registerFormulaBuffer(sourceExpr: TExpr, parentId: string | null, position: number): string` that performs the full registration and returns the formula ID. Each call site becomes a one-liner.

## 5. `ExpressionManager.detachExpression(expressionId, expression)`

**Problem:** The 5 core map operations for removing an expression from the tree (delete from `expressions`, remove from parent's child index, remove from parent's position index, delete own child index, delete own position index) are repeated ~6 times in `removeExpression`, `collapseIfNeeded`, and `deleteExpression`.

**Solution:** Private method `detachExpression(expressionId: string, expression: TExpr): void` performing only the 5 map operations. Callers handle collector notification, dirty set cleanup, and parent dirtying — these vary by call site.

## 6. `ArgumentEngine.finalizeVariableMutation(collector)`

**Problem:** ~14 variable/premise mutation methods in `ArgumentEngine` end with the same sequence: `markDirty` -> `toChangeset` -> `markReactiveDirty` -> `notifySubscribers`.

**Solution:** Private method `finalizeVariableMutation(collector: ChangeCollector): TCoreChangeset` that runs the sequence and returns the changeset. `markAllPremisesDirty()` stays at each call site since not all mutations need it.

## Constraints

- No public API changes.
- No behavioral changes — all tests must continue to pass without modification.
- Each extraction is independently mergeable.
- The `VersionedLibrary` extraction should land first since it touches separate files from the others.
