# Changelog

## Refactoring

- **`VersionedLibrary` base class** (`95593f2..1a0ee18`): Extracted shared versioning logic from `ClaimLibrary` and `SourceLibrary` into `src/lib/core/versioned-library.ts`. Both libraries are now thin subclasses (~37 lines each, down from ~245). Exported `VersionedLibrary` and `TVersionedEntity` from the library barrel. Made `maxVersion` and `computeChecksum` private; added `entityType` abstract member typed as `TInvariantViolationEntityType`.
- **`ExpressionManager.registerFormulaBuffer`** (`ab158a7`): Extracted formula-buffer-insertion pattern into a private helper with optional `formulaId` parameter for pre-allocated ID cases. Replaced 6 inline sites across `addExpression`, `insertExpression`, and `wrapExpression`. Net -78 lines.
- **`ExpressionManager.detachExpression`** (`07943fa`): Extracted the 5 core map operations for removing an expression from the tree. Replaced 5 inline sites (2 promotion sites correctly left inline due to position-preservation semantics). Net -25 lines.
- **`PremiseEngine.assertVariableExpressionValid`** (`2cca49a`): Extracted variable-existence + circularity guard into a private helper. Replaced 5 inline sites across `addExpression`, `appendExpression`, `addExpressionRelative`, `insertExpression`, `wrapExpression`. Net -84 lines.
- **`PremiseEngine.finalizeExpressionMutation`** (`5a2925b`): Extracted 5-step mutation epilogue (`syncRootExpressionId` → `markDirty` → `flushAndBuildChangeset` → `syncExpressionIndex` → `onMutate`) into a private helper. Replaced 11 sites across 8 methods. Net -39 lines.
- **`ArgumentEngine.finalizeChanges`** (`1c72c6f`): Extracted change finalization epilogue (`markDirty` → `toChangeset` → `markReactiveDirty` → `notifySubscribers`) into a private helper. Replaced 9 sites. Net -13 lines.
