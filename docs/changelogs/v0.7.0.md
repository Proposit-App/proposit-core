# Changelog

## Argument Forking (`335eb7c..15f4a99`)

### Schema changes

- Added optional nullable `forkedFrom` fields to all entity schemas:
    - `CoreArgumentSchema`: `forkedFromArgumentId`, `forkedFromArgumentVersion`
    - `CorePremiseSchema`: `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`
    - `BasePropositionalExpressionSchema`: `forkedFromExpressionId`, `forkedFromPremiseId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`
    - `CoreVariableBaseFields`: `forkedFromVariableId`, `forkedFromArgumentId`, `forkedFromArgumentVersion`
- All `forkedFrom` fields are `Type.Optional(Nullable(...))` for backward compatibility
- `DEFAULT_CHECKSUM_CONFIG` updated to include `forkedFrom` fields in all entity field sets

### New types

- `TForkArgumentOptions` — options for `forkArgument` (ID generator, config overrides)
- `TForkRemapTable` — maps original entity IDs to forked counterparts
- `TForkArgumentResult` — return type containing engine and remap table

### ArgumentEngine

- `canFork()` protected method — overridable validation hook, returns `true` by default
- `forkArgument(newArgumentId, claimLibrary, sourceLibrary, claimSourceLibrary, options?)` — creates independent copy with new UUIDs, remapped internal references, and `forkedFrom` provenance metadata

### Diff system

- `TCoreDiffOptions` extended with optional `premiseMatcher`, `variableMatcher`, `expressionMatcher` fields
- `diffEntitySet` and `diffPremiseSet` support custom matcher-based entity pairing
- `createForkedFromMatcher()` — built-in matcher that pairs entities via `forkedFrom` provenance fields

### Tests

- 24 new tests covering schema acceptance, fork provenance, internal reference remapping, remap table accuracy, engine independence, entity mutability, checksum divergence, and fork-aware diffing

## Cross-Argument Variable Binding (`657b25f..85a8ba7`)

### Utility function

- `isExternallyBound(variable, argumentId)` — returns `true` if a premise-bound variable references a premise in a different argument

### Auto-variable creation

- `createPremise(extras?, symbol?)` and `createPremiseWithId(id, extras?, symbol?)` now auto-create a premise-bound variable for the new premise
- Auto-generated symbols use `"P{n}"` pattern with collision avoidance
- `restoringFromSnapshot` private flag prevents duplicate variable creation during `fromSnapshot`/`fromData` restoration
- Interface `TPremiseCrud` updated with `symbol?` parameter on both methods

### ArgumentEngine

- `canBind(boundArgumentId, boundArgumentVersion)` protected method — overridable validation hook, returns `true` by default
- `bindVariableToExternalPremise(variable)` — registers a variable bound to a premise in another argument; evaluator-assigned semantics, no lazy resolution or circularity detection
- `bindVariableToArgument(variable, conclusionPremiseId)` — convenience wrapper that sets `boundPremiseId` and delegates to `bindVariableToExternalPremise`

### Evaluation

- Truth-table column filtering now includes externally-bound premise variables as free variables (alongside claim-bound)
- Resolver in `ArgumentEngine.evaluate()` only lazily resolves internal premise-bound variables; external ones read from the assignment
- `PremiseEngine.evaluate()` uses `isExternallyBound` to distinguish internal from external bindings

### Restoration

- `fromSnapshot` and `fromData` route external premise-bound variables through `bindVariableToExternalPremise` instead of `bindVariableToPremise`

### Tests

- 13 new tests covering `isExternallyBound`, auto-variable creation (default symbol, custom symbol, collision), external binding registration, internal binding rejection, `canBind` override, `bindVariableToArgument`, lazy vs evaluator-assigned evaluation, truth-table inclusion, and `fromSnapshot` round-trip
