# Release Notes

## ForksLibrary

- **New: ForksLibrary** — A standalone library for managing fork records. Fork records track the provenance of argument forks (source argument, timestamp, creator).
- **New: `forkArgumentEngine()`** — Standalone function for low-level argument forking without fork record management.
- **New: `forkId` field** — All entity schemas (arguments, premises, expressions, variables) now carry an optional `forkId` field referencing their fork record.
- **Changed: `canFork()` is now public** — Subclass overrides still work. ForksLibrary calls it as a guard before forking.
- **Breaking: `ArgumentEngine.forkArgument()` removed** — Use `ForksLibrary.forkArgument()` instead. The new API creates a fork record, delegates the engine fork, and stamps `forkId` on all forked entities.
- **Breaking: `TForkArgumentResult` removed** — `ForksLibrary.forkArgument()` returns `{ engine, remapTable, fork }` directly.
