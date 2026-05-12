# v0.12.1 release notes

Five small follow-ups on the v0.12.0 axiomatic-claim work, all bug-fixes or
internal cleanups. No wire-format changes; no migration; safe drop-in.

## Fixes

### `populateFromSupports` deduplicates supporting claims

If a derived claim was cited twice from the same source — e.g., two citation
connections from claim A to supporting claim B — `populateFromSupports`
previously emitted two OR children pointing at the same supporting variable.
The OR is now built from the unique set of supporting-claim IDs in source
order (citations first, then axioms), so each supporting claim appears
exactly once.

### Stricter rejection of caller assignments on axiomatic-bound variables

The evaluate-time guard that rejects caller-supplied assignments for
axiomatic-bound variables now uses `Object.hasOwn`, so an explicit
`{ [varId]: undefined }` is rejected with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`
just like any other explicit assignment. Previously the `!== undefined` guard
let an explicit `undefined` slip through and be silently coerced to `true`.

### `InvariantViolationError` on connection-library `remove`

`ClaimCitationLibrary.remove` and `ClaimAxiomLibrary.remove` now throw
`InvariantViolationError` with the new codes `CITATION_NOT_FOUND` /
`AXIOM_NOT_FOUND` when the supplied id is unknown, instead of a plain
`Error`. This makes the connection libraries fully uniform with every other
error path in the codebase. The in-tree CLI consumers pre-check existence
and never reached the previous throw, so their behavior is unchanged.

### Migration marker check surfaces real errors

The v0.12 CLI migration's marker-detection step (`fs.access(.proposit-v0.12)`)
now distinguishes ENOENT ("not yet migrated") from real errors like EACCES.
A permissions error on the marker file will now fail loudly on the first
invocation instead of silently re-running the migration every time.

## Internal

- `ArgumentEngine`'s two axiom-bound iteration loops (`applyAxiomaticForcedAssignments`
  and `getAxiomaticBoundVariableIds`) now share a single private helper.
