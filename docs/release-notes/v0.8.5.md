# Release Notes

## Internal code quality improvements

Reduced code duplication across the core library by extracting shared patterns into reusable helpers. No changes to the public API or behavior.

- `ClaimLibrary` and `SourceLibrary` now extend a shared `VersionedLibrary` base class, eliminating ~400 lines of duplicated versioning logic.
- New public export: `VersionedLibrary` and `TVersionedEntity` for consumers who want to build custom versioned libraries using the same pattern.
- Expression tree operations in `ExpressionManager` are more maintainable via extracted `registerFormulaBuffer` and `detachExpression` helpers.
- `PremiseEngine` mutation methods consolidated via `assertVariableExpressionValid` and `finalizeExpressionMutation` helpers.
- `ArgumentEngine` mutation methods consolidated via `finalizeChanges` helper.
