# Changelog

## Extras mutation changesets (`c52fd7c..HEAD`)

- `ChangeCollector.modifiedPremise()` — fills the gap between `addedPremise`/`removedPremise`
- `PremiseEngine.setExtras` now uses `ChangeCollector` and returns `premises.modified` in the changeset instead of `{}`
- `PremiseEngine.updateExtras` — shallow-merge variant of `setExtras`, delegates to `setExtras` internally
- `ArgumentEngine.getExtras/setExtras/updateExtras` — symmetric extras handling for arguments, using `collector.setArgument()`
- `TArgumentIdentity` interface expanded with `getExtras`, `setExtras`, `updateExtras` (3 new generic params with defaults — backward compatible)
- `TPremiseIdentity` interface expanded with `updateExtras`
- CLI `premises update` refactored from `readPremiseMeta`/`writePremiseMeta` to engine hydration + `updateExtras`/`setExtras` + `persistEngine`
- `setExtras` JSDoc corrected: "returns the previous extras" → "returns the new extras"
