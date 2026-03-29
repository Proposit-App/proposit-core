# Changelog

## unified-fork-library branch

### New files

- `src/lib/schemata/fork.ts` — fork record schemas (`TCoreEntityForkRecord`, `TCoreExpressionForkRecord`, `TCoreClaimForkRecord`, `TCoreSourceForkRecord` and their Typebox schemas)
- `src/lib/core/fork-namespace.ts` — `ForkNamespace<T>` class (keyed by `entityId`, Typebox schema validation, `create`/`get`/`getAll`/`getByForkId`/`remove`/`snapshot`/`validate`/`static fromSnapshot`)
- `src/lib/core/fork-library.ts` — `ForkLibrary` class with six `ForkNamespace` fields; `snapshot`/`validate`/`static fromSnapshot`
- `src/lib/core/argument-library.ts` — `ArgumentLibrary` class; `create`/`register`/`get`/`getAll`/`remove`/`snapshot`/`validate`/`static fromSnapshot`
- `src/lib/core/proposit-core.ts` — `PropositCore` class; top-level orchestrator with `forkArgument`/`diffArguments`/`snapshot`/`validate`/`static fromSnapshot`

### Deleted files

- `src/lib/core/forks-library.ts` — replaced by `ForkLibrary` + `PropositCore`
- `src/lib/core/diff.ts` (partial) — `createForkedFromMatcher` removed; fork-aware matching now internal to `PropositCore.diffArguments`

### Modified files

- `src/lib/schemata/argument.ts` — removed `forkedFromArgumentId`, `forkedFromArgumentVersion`, `forkId` from `CoreArgumentSchema`
- `src/lib/schemata/premise.ts` — removed `forkedFromPremiseId`, `forkId` from `CorePremiseSchema`
- `src/lib/schemata/propositional.ts` — removed `forkedFromExpressionId`, `forkedFromVariableId`, `forkId` from expression and variable schemas
- `src/lib/core/fork.ts` — `forkArgumentEngine` no longer sets `forkedFrom*` or `forkId` fields on entities; removed from diff module; pure ID-remapping only
- `src/lib/core/interfaces/library.interfaces.ts` — added `TArgumentLibrarySnapshot`, `TForkLibrarySnapshot`, `TPropositCoreSnapshot`, `TPropositCoreConfig`
- `src/lib/index.ts` / `src/index.ts` — removed `ForksLibrary`, `createForkedFromMatcher`, `TCoreFork`, `CoreForkSchema`, `TForkLookup`, `TForksLibrarySnapshot`; added `PropositCore`, `ArgumentLibrary`, `ForkLibrary`, `ForkNamespace` and all new fork record types/schemas

### Test coverage

- `test/core.test.ts` — added `describe` blocks for `ForkNamespace`, `ForkLibrary`, `ArgumentLibrary`, and `PropositCore` (forkArgument, diffArguments, snapshot/restore)
- Total: 1044 tests passing
