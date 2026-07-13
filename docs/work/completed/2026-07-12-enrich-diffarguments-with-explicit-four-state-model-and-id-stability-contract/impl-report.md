# Implementation report — enrich `diffArguments` four-state model (core slice)

**Status:** DONE
**Scope:** Tasks 1–7 (Task 8 docs-sync and Task 9 version-cut intentionally NOT done).
**Commit range:** `1cc69bb..df80de1` (base `1cc69bb`; tcw-start `057bf83`, then 5 impl commits).
**Verification:** `pnpm run check` — 2003 passed | 14 skipped; typecheck + lint + build all green.

## What was built

Additive enrichment of `diffArguments` — no structural teardown; `added`/`removed`/`modified` arrays retained.

### Task 1 — `TCoreDiffState` discriminant (`src/lib/types/diff.ts`)
- Added `export type TCoreDiffState = "added" | "removed" | "modified-own" | "modified-within"` — **exactly four members, no `"unchanged"`** (per governing correction #1).
- Added required `state: "modified-own" | "modified-within"` to `TCoreEntityFieldDiff<T>`; `TCorePremiseDiff` and the always-present `TCoreArgumentDiff.argument` inherit it.
- Re-export is automatic: `src/lib/index.ts` does `export * from "./types/diff.js"` and `src/index.ts` re-exports the barrel — no explicit export lines needed.

### Tasks 2–3 — own-vs-within tagging (`src/lib/core/diff.ts`)
- Every `modified` push in `diffEntitySet` (both matcher branches) and `diffPremiseSet` (both branches) now sets `state`: `changes.length > 0 ? "modified-own" : "modified-within"` (premise keyed on `premiseChanges`).
- Argument root defaults to `modified-within` and flips to `modified-own` on own field changes. Committed together (Task 3) so the tree never sits non-compiling.

### Task 4 — conclusion role folded into argument own-state
- `conclusionChanged = rolesA.conclusionPremiseId !== rolesB.conclusionPremiseId`; argument `state` is `modified-own` when `argumentChanges.length > 0 || conclusionChanged`. Standalone `roles` field unchanged.

### Task 5 — reference-edge propagation (`propagateReferenceWithin`)
- Post-pass after the variable/premise diffs: builds `modifiedOwnVarIds` from `variables.modified` (keyed on `after.id`), then for each engine-B premise not already in `premises.modified` (keyed on after-side id) whose expression tree points at a changed variable, pushes a `modified-within` premise entry with empty `changes` and an empty `expressions` set-diff.
- `before`/`after` paired correctly: matched before-side premise via the same `premiseMatcher` (else by id); a newly-added premise (no before match) is skipped (stays in `.added`). Own/containment entries are left untouched.

### Task 6 — diff-stability regression lock
- Uses **identical deterministic-id engines** (injected `generateId`) as the id-preserving "copy" path, not `forkArgument` (fork deliberately remaps entity + claim ids, so a no-edit fork is legitimately non-empty in core; there is no `copyArgument` in core today).
- Empty-diff assertion follows governing correction #2: `isDiffEmpty(diff) === true` **plus** a `countByState` helper that tallies `modified-own`/`modified-within` over **entity records only** (variables, premises, expressions), **explicitly excluding the argument root's default `state`**.
- Single-edit assertion: one operator edit → exactly one `modified-own` (the expression) + one `modified-within` (its premise).
- `isDiffEmpty` (in `diff-renderer.ts`) was **not modified** — still driven by buckets/roles/`argument.changes`, never by `state`.

### Correction #3 — two-variables-per-claim single-origin (in Task 6 block)
- `buildSharedClaimEngine` binds one claim via both an authored claim-bound variable and a derivation premise deriving the same claim.
- **Result: ONE ORIGIN CONFIRMED — not a blocker.** The engine holds exactly one claim-bound variable for the claim (`ensureClaimBoundVariable` reuse), and a single `claimVersion` bump yields exactly one `modified-own` variable. The derivation premise's synthesized consequent reuses the authored variable rather than minting a second one, so no double-count survives into the diff.

### Task 7 — derivation non-leakage (OQ5)
- Unchanged derivation premise → no diff entry (`premises.modified` empty). A derivation premise touched by a claim edit is tagged `modified-within` exactly once, by the same uniform rule as any referencing premise — no synthesized/duplicated entries.

## Tests
`test/diff-state.test.ts` (new) — 13 tests, all passing. `test/diff-renderer.test.ts` fixtures updated to carry the new required `state` field. `test/diff-command.test.ts` unaffected (mocked diff returns are untyped).

## Notes / deviations
- **Task 5 "no double-mark" test** asserts the honest correct behavior: with default comparators a premise is never `modified-own` (`defaultComparePremise` returns `[]`), so a premise carrying an expression edit is `modified-within` via containment. The test verifies the reference pass does not duplicate it and does not clobber its containment detail — the true meaning of "own/containment wins over reference-within." (The plan's literal `state === "modified-own"` for a premise is unreachable with default comparators; the corrections govern and do not require it.)
- **Task 6 copy path** uses deterministic identical engines rather than `forkArgument`, because fork remaps ids/claim-ids by design and would never yield an empty diff for an argument with claim- or premise-bound variables. This still directly locks the contract: unchanged content → empty diff; single edit → one origin.
- Report written to the `active/` work-item folder (the item was moved out of `backlog/` by `tcw work start`).
