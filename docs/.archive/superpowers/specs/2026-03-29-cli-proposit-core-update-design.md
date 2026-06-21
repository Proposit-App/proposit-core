# CLI Update for PropositCore (0.8.0)

Update the CLI to use PropositCore as the in-memory orchestrator, add missing commands for engine features introduced since v0.5.x, and fix `premises create`/`premises delete` to go through the engine.

## PropositCore Integration

The hydration/persistence layer in `src/cli/engine.ts` adopts PropositCore:

- `hydrateLibraries()` becomes `hydratePropositCore()`. Reads claims, sources, claimSources, and forks from disk. Returns a `PropositCore` instance.
- `hydrateEngine()` takes the PropositCore (or builds one), hydrates an engine as before, and registers it in `core.arguments` via `.register()`.
- `persistLibraries()` becomes `persistCore()`. Writes claims, sources, claimSources, and forks.
- Existing callers that use `hydrateLibraries()` switch to `hydratePropositCore()`. The returned object exposes `.claims`, `.sources`, `.claimSources` so call sites need minimal changes.

The existing disk layout is unchanged. PropositCore is purely an in-memory coordinator.

## New Commands

### `arguments fork <argument_id>`

Forks an argument via `core.forkArgument(argumentId, newArgumentId)`. Hydrates PropositCore and the source engine, performs the fork (which clones referenced claims, sources, associations, and creates fork records), persists the new engine and updated libraries. Outputs the new argument ID.

### `expressions toggle-negation <premise_id> <expression_id>`

Calls `pm.toggleNegation(expressionId)`. Wraps or unwraps the target expression in a NOT node. Writes premise data only (existing expression command pattern).

### `expressions change-operator <premise_id> <expression_id> <new_operator>`

Calls `pm.changeOperator(expressionId, newOperator, sourceChildId?, targetChildId?)`. Handles simple change, merge, and split internally. Optional `--source-child-id` and `--target-child-id` flags for split behavior. Writes premise data only.

### `<arg> <ver> validate`

Runs `engine.validate()` (invariant validation, distinct from `validateEvaluability()`). Outputs violations or "ok". Supports `--json`.

## Changes to Existing Commands

### `premises create`

Goes through the engine instead of direct disk writes.

**Before:** Writes meta.json and data.json directly to disk. No engine involved.

**After:** Hydrates engine, calls `engine.createPremiseWithId(id, extras)`, persists full engine. A premise-bound variable is auto-created with a collision-avoiding symbol (`P1`, `P2`, etc.). Optional `--symbol <sym>` to override the auto-generated symbol.

### `premises delete`

Goes through the engine instead of manual role cleanup + directory deletion.

**Before:** Reads roles, clears conclusion if matching, deletes premise directory.

**After:** Hydrates engine, calls `engine.removePremise(premiseId)`, persists full engine, then deletes the removed premise's directory from disk. Cascade behavior (removing bound variables and their referencing expressions in other premises) is handled by the engine; `persistEngine()` writes the updated state of all remaining premises correctly.

### `diff`

Hydrates a PropositCore with ForkLibrary. Uses `core.diffArguments()` which automatically injects fork-aware entity matchers when fork records exist linking the two arguments. Falls back to standard ID-based matching when no fork records exist. No UX change.

## Storage

### New file: `<stateDir>/forks.json`

Contains the ForkLibrary snapshot:

```json
{
  "arguments": [...],
  "premises": [...],
  "expressions": [...],
  "variables": [...],
  "claims": [...],
  "sources": [...]
}
```

Read/write functions added to `storage/libraries.ts` alongside existing library I/O. Empty or missing file is treated as an empty ForkLibrary (backward compatible).

### No changes to existing files

- `claims.json`, `sources.json`, `claim-sources.json` -- unchanged
- `arguments/<id>/<ver>/` directory structure -- unchanged
- `arguments/<id>/<ver>/variables.json` -- now also contains auto-created premise-bound variables
- `arguments/<id>/<ver>/premises/<pid>/` -- unchanged

### Backward compatibility

- Existing arguments with no fork records work fine (empty ForkLibrary).
- Existing premises created before auto-variable creation have no bound variables -- the engine hydrates from what's on disk.
- The placeholder claim generation in `hydrateEngine()` continues to handle old variables with missing claims.

## Smoke Test Updates

- Account for auto-variables created by `premises create` (variable counts and list outputs change).
- Add `arguments fork` section: fork, verify new ID, list to confirm.
- Add `expressions toggle-negation` section: toggle on, render, toggle off, render.
- Add `expressions change-operator` section: change operator type, render.
- Add `validate` section: run on well-formed argument, expect "ok".
- Update `premises delete` to verify cascade removes bound variables.
- Update `diff` section to exercise fork-aware diff (fork, modify, diff).

## Files to Modify

- `src/cli/engine.ts` -- PropositCore hydration/persistence
- `src/cli/config.ts` -- add forks file path helper
- `src/cli/commands/arguments.ts` -- add `fork` command
- `src/cli/commands/expressions.ts` -- add `toggle-negation`, `change-operator`
- `src/cli/commands/premises.ts` -- rewrite `create` and `delete` to go through engine
- `src/cli/commands/diff.ts` -- use PropositCore.diffArguments()
- `src/cli/commands/render.ts` -- use PropositCore instead of loose libraries
- `src/cli/commands/claims.ts` -- use PropositCore instead of hydrateLibraries
- `src/cli/commands/sources.ts` -- use PropositCore instead of hydrateLibraries
- `src/cli/storage/libraries.ts` -- add forks read/write
- `src/cli/router.ts` -- register `validate` command
- `scripts/smoke-test.sh` -- update for new commands and behavioral changes

## New Files

- `src/cli/commands/validate.ts` -- validate command

## Not In Scope

- `expressions wrap` -- excluded per user decision
- Global PropositCore validate command
- CLI storage format migration (disk layout stays as-is)
- `bindVariableToExternalPremise` / `bindVariableToArgument` CLI commands (cross-argument binding is an advanced feature; fork handles the common case)
