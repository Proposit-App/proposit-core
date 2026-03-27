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
