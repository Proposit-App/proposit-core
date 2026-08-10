# Outcome — citations are given in `checkValidity`

Four commits on `main`, `ebf1a23..e2c6d7d`. Version stays `4.0.0` pending the
version decision at closeout; not published, not pushed.

| Commit | Task |
| --- | --- |
| `ebf1a23` | T1 — the failing test |
| `0639739` | T2 — the grounded carve-out |
| `796f57a` | T3 — the evaluate-time boundary pins |
| `e2c6d7d` | T4 — Documentation Sync |

## What shipped

**The carve-out.** `getGroundedBoundVariableIds()` joins
`getAxiomaticBoundVariableIds()` on `ArgumentEngine`, built on the
`isGroundedVariable` predicate the default assignment already used.
`checkValidity` takes both `excludedVariableIds` and `forcedTrueVariableIds`
from it. Nothing in `src/lib/core/evaluation/` changed: the enumeration filter
already drops anything excluded before asking about binding, the row loop already
overwrites every forced id to `true`, and the satisfiability precompute already
reads both sets from the same variables — so the validity path followed for free
and the evaluation path did not.

**What was deliberately not touched.** `collectAxiomaticBoundVariables` and
`applyAxiomaticForcedAssignments` are byte-identical. That pre-pass *throws* on a
caller assignment, so widening it would have made a reader's assignment on any
citation-backed claim raise `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` — the trap the
spec was written around.

## Acceptance criteria

All eight met.

| # | Criterion | Where |
| --- | --- | --- |
| 1 | Citation's column dropped; half the rows | "drops the citation's column from the enumeration" |
| 2 | No counterexample carries a citation false | "never reports a failing case in which the cited claim is false" |
| 3 | Valid when the only countermodel needed the citation false | "finds an argument valid whose only counterexample needed the citation false" |
| 4 | Axiomatic unchanged, both halves | "still refuses a caller assignment…" + "excludes an axiomatic variable…" |
| 5 | `evaluate()` still accepts a citation assignment | "accepts a caller assignment on a citation-bound variable and reads it back" |
| 6 | Default assignment unchanged | "seeds a citation true in the default assignment" |
| 7 | Over-limit message quotes the reduced count | Follows from `checkedVariableIds.length`; no edit needed |
| 8 | Comments at both sites | `isGroundedVariable`, `getGroundedBoundVariableIds`, `checkValidity` |

## Evidence

- `pnpm run check` green: typecheck, prettier, eslint, **2408 passed / 12 skipped
  across 87 files**, build, typedoc. Baseline before this item was 2401.
- **T1 failed on assertions before T2**, not on fixture construction — verified
  by running the file at `ebf1a23`: 3 failed, all on `expect`.
- **The boundary pins were confirmed to discriminate.** Widening
  `collectAxiomaticBoundVariables` to include `"citation"` — the exact wrong fix
  — fails "accepts a caller assignment on a citation-bound variable" and
  *nothing else*: 1 failed, 6 passed. Reverted; `git diff` on the file is clean.
- One test in the first draft passed before the change (its lone counterexample
  already had the citation true, so it proved nothing). The fixture was replaced
  with `(C ∧ A) → Q`, which has three counterexamples while C is free — two of
  them reachable only by setting the cited claim false — and one after. Recorded
  because a vacuous pin is worse than no pin: it reads as coverage.

## Deviations from the plan

None in substance. Two API names in T3 were written from memory and corrected
against the source while running: `getDefaultAssignment` → `deriveDefaultAssignment`,
and `result.variableValues` → `result.assignment?.variables` (`variableValues`
exists, but on the per-premise result, not the argument result).

## Documentation Sync

Five entries fired, as predicted: `docs/api-reference.md` (the paragraph that
explicitly stated the old behaviour — "Citation-bound variables remain in the
enumeration set" — is replaced), `argument-engine.interfaces.ts` JSDoc,
`docs/release-notes/upcoming.md`, `docs/changelogs/upcoming.md`, and `AGENTS.md`
(a new invariant: "grounded" and "unassignable" are different sets). The seven
predicted not to fire did not.

## Known gap, recorded not forgotten

`evaluateArgument`'s own `isPremiseSetSatisfiable` call
(`argument-evaluation.ts:637`) still receives only the axiomatic set, so the
engine reads citations two ways across `checkValidity` and evaluation-time
satisfiability. Narrower than the inconsistency removed, and excluded on purpose:
pinning citations true there can only shrink the model set, so a premise set that
holds only with a cited claim false would flip from satisfiable to contradictory
— which suppresses derivation and drives the review's **blocked** state in the
clients. That is a product decision, not this item's. To be filed at closeout.

## Not observable end to end yet

No reader can reach this. `proposit-server`'s results stage disables the
exhaustive check on every real argument (its own item, being driven alongside
this one), so there is no browser verification to run until that lands.
