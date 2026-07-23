# Decompose ArgumentEngine and PremiseEngine into method-family seam files

Re-tracked from the archived request `2026-06-15-engine-class-decomposition` (lost
in the `docs/inbox → tcw work` migration). Surfaced by the root audit
`2026-07-17-audit-archived-docs-inbox-requests-for-dependencies-lost-in-the-tcw-migration`.

## Product changes

None. Internal refactor behind a stable public API.

## Technical changes

`ArgumentEngine` and `PremiseEngine` are the two largest, most invariant-dense
files in the repo and remain monolithic:

- `src/lib/core/argument-engine.ts` — ~3,063 lines
- `src/lib/core/premise-engine.ts` — ~2,216 lines

Split each into method-family seam files behind the existing public interface,
one method-family at a time. Preserve the public API surface
(`argument-engine.interfaces.ts` / `premise-engine.interfaces.ts`) unchanged.
The original request proposed seams such as `premise-lifecycle.ts`,
`checksum-orchestration.ts`, `PremiseChangeBatcher`, `PremiseChecksum` — treat
those as a starting sketch, not a contract.

## Constraints / regression risk (high)

- **Mutation-time throw semantics** must be preserved: mutations throw only on
  Structural violations; Evaluable/Derivable/Presentable issues never throw at
  mutation time.
- **Checksum ordering** (hierarchical-checksum protocol, `orderChangeset` FK-safe
  ordering) must not change.
- Scope incrementally; each slice fully green against the existing `test/` suite
  before the next. No behavior change — pure structural.

## Consumer impact

None intended — no wire-format, schema, or signature changes.

## Non-goals

- No new behavior or API. Add a characterization test only if a seam boundary
  exposes an untested invariant.

## Known decisions

- This item only restores *tracking*; scheduling/prioritizing the actual
  decomposition is a separate call. Priority left unset (backlog).
