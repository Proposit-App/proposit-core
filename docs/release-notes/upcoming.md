# Release Notes

## CLI Update for PropositCore

The CLI now uses PropositCore as its in-memory orchestrator, bringing several new capabilities and fixes.

### New commands

- **`arguments fork <id>`** — Creates an independent copy of an argument, cloning all referenced claims, sources, and associations. Fork provenance is tracked so that future diffs automatically match forked entities.
- **`expressions toggle-negation <premise_id> <expr_id>`** — Wraps or unwraps an expression in a NOT operator.
- **`expressions change-operator <premise_id> <expr_id> <new_op>`** — Changes an operator's type (e.g., `and` to `or`, `implies` to `iff`). Supports `--source-child-id` and `--target-child-id` for split behavior.
- **`validate`** — Runs structural invariant validation on an argument. Distinct from the existing evaluability analysis. Supports `--json`.

### Behavioral changes

- **`premises create`** now auto-creates a premise-bound variable for each new premise (symbol `P1`, `P2`, etc.). Use `--symbol <sym>` to override. Previously, premises were created without associated variables.
- **`premises delete`** now cascades through the engine — removing a premise also removes its bound variables and any expressions referencing those variables.
- **`diff`** automatically uses fork-aware entity matching for cross-argument diffs when fork provenance records exist. Same-argument version diffs are unaffected.

### Internal

- ForkLibrary state is now persisted to `forks.json` in the state directory.
- `variables create` now properly creates a frozen claim in the claim library instead of passing an empty claim ID.
