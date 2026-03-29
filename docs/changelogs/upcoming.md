# Changelog

## CLI PropositCore Update

Commits: `3752c58..11dae56`

### New features

- `feat(cli): add ForkLibrary read/write storage` — `readForkLibrary()`/`writeForkLibrary()` in `src/cli/storage/libraries.ts` for persisting fork provenance to `forks.json`
- `feat(cli): premises create/delete go through engine` — `premises create` calls `engine.createPremiseWithId()` (auto-creates premise-bound variable); `premises delete` calls `engine.removePremise()` (cascades to bound variables/expressions)
- `feat(cli): add expressions toggle-negation and change-operator commands` — New subcommands on `expressions` for toggling NOT wrapper and changing operator types
- `feat(cli): add validate command for invariant checking` — `<arg> <ver> validate` runs `engine.validate()`, outputs violations or "ok", supports `--json`
- `feat(cli): add arguments fork command` — `arguments fork <id>` uses `PropositCore.forkArgument()` to create independent copies with full claim/source/association cloning

### Refactoring

- `refactor(cli): replace hydrateLibraries with hydratePropositCore` — `engine.ts` rewritten: `hydratePropositCore()` returns a `PropositCore` instance, `persistCore()` writes all libraries. `hydrateEngine()` uses `ArgumentEngine.fromSnapshot()` to prevent auto-variable duplication during hydration.
- `refactor(cli): update all callers to use hydratePropositCore/persistCore` — `arguments.ts`, `claims.ts`, `sources.ts`, `render.ts`, `diff.ts`, `parse.ts` updated. `diff` uses `core.diffArguments()` for cross-argument diffs (fork-aware matching) and standalone `diffArguments()` for same-argument diffs.

### Bug fixes

- `variables create` now auto-creates a frozen claim in the claim library instead of passing `claimId: ""`
- `engine.ts` strips hierarchical checksum fields (`descendantChecksum`, `combinedChecksum`) from premise meta when persisting (prevents schema validation failure)
- `engine.ts` sets `autoNormalize: true` in grammar config so `insertExpression` auto-wraps operators in formula buffers

### Tests

- Smoke test updated: accounts for auto-variables from `premises create`, adds sections for toggle-negation, change-operator, validate, arguments fork, fork-aware diff
- All 1044 unit tests pass
