# Outcome — group the variables that cannot interact

Four commits on `main`, `5431f0d..e892cc7`. Version stays `4.0.0` pending the
version decision at closeout; not published, not pushed.

| Commit | Task |
| --- | --- |
| `5431f0d` | T1 — the differential oracle and the pins |
| `31bf444` | T2 + T3 — the closure, the partition, the fold |
| `f6fef12` | T5 — the dependency contract on `TEvaluablePremise.evaluate` |
| `e892cc7` | T7 — Documentation Sync |

## What shipped

`isPremiseSetSatisfiable` splits its premises into groups sharing no reachable
variable, walks each over its own columns, and folds: any group `false` →
`false`; else any `null` → `null`; else `true`. `SATISFIABILITY_VARIABLE_CEILING`
bounds the largest group rather than the total. A variable no premise reaches
gets no column anywhere, which is where the conclusion-only variables both call
sites over-supply are dropped.

Three functions where there was one: `collectReachableVariables` (the closure),
`partitionIntoGroups` (union-find over the reachable sets), `walkGroup` (the old
loop, unchanged except for taking its columns as a parameter). Neither call site
changed — the fix is in the callee, so a third caller inherits it.

## Deviations from the plan

**T2 and T3 landed as one commit.** The plan had the closure land alone, before
anything used it. It cannot: an unreferenced module-private function fails
`@typescript-eslint/no-unused-vars`, so that commit would have left `pnpm run
lint` red — violating the plan's own rule that the suite is green at every
boundary. Merged rather than committed broken. The plan was wrong about this,
not the implementation.

**T6 measured, and the result is weaker than the design assumed.** See below.

## The vacuous pin, again

Criterion 4's first draft passed before the change. A satisfiable premise set
returns on its **first satisfying row**, and the spare column does not move
which mask that is — so the extra variable cost nothing observable and the test
proved only that the early return works.

Rewritten around an unsatisfiable set, which forces the full walk: 4 premise
evaluations without the spare variable, 8 with it, before the change; 4 and 4
after. T1 then failed 4 of 16, all on `expect`.

This is the second item in two days where a first-draft pin passed before the
fix. Both times the cause was the same shape — a fixture whose *outcome* was
right for reasons unrelated to what the test claimed to measure. Worth treating
as a standing check rather than a lesson learned: **run the new tests against
the unchanged code and read which ones fail, before writing the fix.**

## The pins discriminate — and one of them is the only thing that would

T4, both breakages run against the full 2436-test suite and reverted:

| Breakage | Fails |
| --- | --- |
| Drop the `boundPremiseId` recursion from the closure | **2** — both coupling tests in this item's file, and nothing else |
| Restrict the forced-true write to a group's own columns | **3** — two here, plus the pre-existing "keeps the axiomatic set when the caller supplies its own forced-true set" |

The first line is the finding. Dropping the transitive closure — the obvious
simplification, and the one a reader would make while tidying — produces a
**wrong `true`**: a contradictory premise set reported as satisfiable, which
un-suppresses derivation argument-wide. Nothing in the pre-existing suite
catches it. Without this item's coupling fixture that change ships green.

The second breakage was already covered, which is the ordinary case and the
reason the contrast is worth recording.

## The measurement, and what it does not support

T6, instrumented and reverted, over every argument in `examples/arguments/`:

| Argument | Free vars | Enumerated | Groups | Rows before | Rows after |
| --- | --- | --- | --- | --- | --- |
| `education-reform` | 5 | 5 | [5] | 32 | 32 |
| `exam-performance` | 4 | 3 | [3] | 16 | **8** |
| `free-speech-misinformation` | 4 | 4 | [3, 1] | 16 | **10** |
| `monopoly-regulation` | 4 | 4 | [4] | 16 | 16 |
| `axiom-backed-derivation`, `derivation-example` | — | — | — | — | — |

The last two never reach the walk: their surviving premise set is empty and the
function returns `true` at its first line.

**Two of the four measurable examples do not decompose at all.** The spec
asserted that "the ordinary shape of an argument" is premises clustering around
small groups of claims; on this evidence that is true of one example out of
four, and a second benefits only from the conclusion-only-variable drop. The
reduction is real and answer-preserving, but these fixtures do not demonstrate
the case the item was argued on.

They are also all four or five variables, where `2^n` is 16 or 32 and nothing
was ever expensive. The arguments this was written for — the ~14-variable one in
`proposit-server` that hits the 10,000-assignment cap — are not in this
repository, so the claim that decomposition helps *there* remains untested.
Recorded as an open question rather than a result.

What the measurement does establish: the reduction never costs rows (worst case
is one group containing everything, which is the previous behavior), and the
ceiling change is unconditional — an argument past 16 variables that decomposes
is now answered where it was declined, whatever the shape of these six examples.

## Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Differential against a copy of the flat walk, all three outcomes | Met — 7 oracle cases |
| 2 | Coupled-through-a-bound-variable set still `false` | Met, and confirmed discriminating |
| 3 | Two groups of `k` walk `≤ 2·2^k`, one premise per group | Met — 128 evaluations flat, ≤16 grouped |
| 4 | A conclusion-only variable adds no rows | Met after the rewrite above |
| 5 | Over the ceiling, decomposable, determinate → answered | Met — 18 variables in two groups of 9, `true` |
| 6 | One group over the ceiling → `null`, unless another is `false` | Met — both cases |
| 7 | Forced-true reaches every group | Met, and confirmed discriminating |
| 8 | The contract on `TEvaluablePremise.evaluate` | Met |
| 9 | `pnpm run check` green, existing suites unmodified | Met — see below |
| 10 | Rows before and after on a real argument | Met — and see the caveat above |

## Evidence

- `pnpm run check` green: typecheck, prettier, eslint, **2424 passed / 12
  skipped across 92 files**, build, typedoc. Baseline before this item was 2408;
  the 16 new tests account for the difference exactly.
- **No existing test was edited.** Criterion 9's real content is that the hot
  path — `evaluateArgument` calls this on every evaluation — did not move under
  2408 pre-existing tests.
- T1 failed 4 of 16 before T3, all on `expect`, none on fixture construction.

## Documentation Sync

Four entries fired, as predicted. `docs/api-reference.md` at both sites the plan
named (the `premiseSetSatisfiable` field description, and
`isPremiseSetSatisfiable`'s own entry — each said the ceiling applied to the
total). `AGENTS.md` gained the invariant. Both `upcoming.md` files.

`argument-engine.interfaces.ts` was the plan's flagged judgment call and did
**not** fire on re-check: `checkValidity`'s JSDoc never described the
satisfiability precompute's ceiling, so it stayed accurate. The other eight
entries did not fire.

## Not verifiable here

No browser pass and no end-to-end evidence. This is an engine change whose
consumer-visible effect — `proposit-server`'s exhaustive check stopping early
less often — needs a published core and a repin to observe. Acceptance of this
item is acceptance of the engine change and its pins, not of a reader-facing
result.
