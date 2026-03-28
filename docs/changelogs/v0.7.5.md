# Changelog

## ForksLibrary feature

- **`src/lib/schemata/fork.ts`** (new) — `CoreForkSchema`, `TCoreFork` type
- **`src/lib/core/forks-library.ts`** (new) — `ForksLibrary<TFork>` class with create/get/getAll/remove/snapshot/fromSnapshot/forkArgument
- **`src/lib/core/fork.ts`** (new) — `forkArgumentEngine()` standalone function extracted from `ArgumentEngine.forkArgument()`
- **`src/lib/schemata/argument.ts`** — Added `forkId` field to `CoreArgumentSchema`
- **`src/lib/schemata/propositional.ts`** — Added `forkId` field to expression, variable, and premise schemas
- **`src/lib/consts.ts`** — Added `forkId` to all entity checksum field sets; added `forkFields` set
- **`src/lib/types/checksum.ts`** — Added `forkFields` to `TCoreChecksumConfig`
- **`src/lib/core/interfaces/library.interfaces.ts`** — Added `TForkLookup`, `TForksLibrarySnapshot` interfaces
- **`src/lib/core/argument-engine.ts`** — `canFork()` changed from protected to public; `forkArgument()` removed
- **`src/lib/types/fork.ts`** — `TForkArgumentResult` removed
- **`src/lib/types/validation.ts`** — Added `"fork"` to `TInvariantViolationEntityType`; added `FORK_SCHEMA_INVALID` code
