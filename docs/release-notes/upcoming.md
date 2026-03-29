# Release Notes

## Breaking Changes

- **ForksLibrary removed** — replaced by `ForkLibrary` (namespaced fork record store) and `PropositCore` (orchestrator). Update any code that used `new ForksLibrary()` or `forksLib.forkArgument()`.
- **createForkedFromMatcher() removed** — fork-aware diffing is now automatic via `PropositCore.diffArguments()`, which uses `ForkLibrary` records as entity matchers.
- **Inline fork fields removed from entity schemas** — `forkedFrom*` and `forkId` fields are no longer present on argument, premise, expression, or variable schemas. Fork provenance lives entirely in `ForkLibrary`; use `forks.arguments.get(entityId)` (or the appropriate namespace) to look up provenance.
- **forkArgumentEngine() no longer sets forkedFrom fields** — only remaps entity IDs and internal references. Call `PropositCore.forkArgument()` for full orchestration including fork record creation.

## New Features

- **PropositCore** — top-level orchestrator that holds all five libraries (`ClaimLibrary`, `SourceLibrary`, `ClaimSourceLibrary`, `ForkLibrary`, `ArgumentLibrary`) and provides `forkArgument()`, `diffArguments()`, `snapshot()`, `validate()`, and `static fromSnapshot()`. Recommended entry point for new applications. Designed for subclassing.
- **ArgumentLibrary** — engine registry with lifecycle management. `create()` builds and registers a new `ArgumentEngine`. `register()` is for internal use (e.g., post-fork). `get()`, `getAll()`, `remove()`, `snapshot()`, `validate()`, and `static fromSnapshot()` are available.
- **ForkLibrary** — unified fork provenance store with six typed namespaces: `arguments`, `premises`, `expressions`, `variables`, `claims`, `sources`. Each namespace is a `ForkNamespace` instance. Immutable records, no checksums.
- **ForkNamespace** — standalone reusable class for managing fork records of a single entity type. Keyed by `entityId`. Methods: `create()`, `get()`, `getAll()`, `getByForkId()`, `remove()`, `snapshot()`, `validate()`, `static fromSnapshot()`.
- **PropositCore.forkArgument()** — full fork orchestration: clones referenced claims and sources (including associations), forks the engine, remaps variable claim references, creates fork records in all six namespaces, and registers the new engine. Returns `{ engine, remapTable, claimRemap, sourceRemap, argumentFork }`.
- **PropositCore.diffArguments()** — automatic fork-aware entity matching using `ForkLibrary` records. Caller-provided matchers in `options` take precedence over the fork-aware defaults.
- **Custom fork record fields** — applications extend fork record types via generics and pass per-namespace extras (`argumentForkExtras`, `premiseForkExtras`, etc.) during `forkArgument()`.
- **New fork record types** — `TCoreEntityForkRecord` (base), `TCoreArgumentForkRecord`, `TCorePremiseForkRecord`, `TCoreVariableForkRecord`, `TCoreExpressionForkRecord` (adds `forkedFromPremiseId`), `TCoreClaimForkRecord` (adds `forkedFromEntityVersion`), `TCoreSourceForkRecord` (adds `forkedFromEntityVersion`).
- **New snapshot types** — `TArgumentLibrarySnapshot`, `TForkLibrarySnapshot`, `TPropositCoreSnapshot`.
