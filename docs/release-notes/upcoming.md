# Release Notes

## Post-Mutation Invariant Validation

Every engine and library now validates its own data after every mutation. If a mutation would produce invalid state, it is automatically rolled back and an `InvariantViolationError` is thrown. This guarantees that an engine never holds data that violates its configured rules.

### What's new

- **`validate()` on every engine and library** — call it at any time to get a full diagnostic report of all invariant violations. Returns `{ ok, violations }` with machine-readable codes and human-readable messages.
- **Automatic rollback on invalid mutations** — every mutation is wrapped in a snapshot-validate-rollback bracket. If validation fails, the engine reverts to its pre-mutation state.
- **Bulk loading now validates** — `fromSnapshot`, `fromData`, and `rollback` all validate the loaded state against the engine's grammar config. Invalid data is rejected.
- **`autoNormalize` now works in `insertExpression` and `wrapExpression`** — previously these methods always threw on formula-between-operators violations even when `autoNormalize` was true. They now auto-insert formula buffers, consistent with `addExpression`.
- **`fromData` defaults to strict grammar** — previously defaulted to `PERMISSIVE_GRAMMAR_CONFIG`. Now defaults to the config provided in options, or `DEFAULT_GRAMMAR_CONFIG` if none is provided.

### Breaking changes

- `fromData` no longer defaults to permissive grammar. Pass `PERMISSIVE_GRAMMAR_CONFIG` explicitly if you need the old behavior.
- `rollback` can now throw `InvariantViolationError` if the snapshot violates the engine's current grammar config.
- `fromSnapshot` can now throw `InvariantViolationError` if the loaded state is invalid under the provided grammar config.
