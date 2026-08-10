# Outcome — evaluation gives the citation too

Four commits on `main`, `825fec8..4bdc4ad`. Version stays `4.0.1` pending the
version decision at closeout; not published, not pushed.

| Commit | Task |
| --- | --- |
| `825fec8` | T1 — the failing tests |
| `0fa8840` | T2 — the separate satisfiability set |
| `6593eb1` | T3 — the attribution pins, re-aimed |
| `4bdc4ad` | T5 — Documentation Sync |

## What shipped

`TCoreArgumentEvaluationOptions` gains
`satisfiabilityForcedTrueVariableIds`, defaulting to `forcedTrueVariableIds` and
read at exactly one place — the `isPremiseSetSatisfiable` call
(`argument-evaluation.ts:660`). `ArgumentEngine.evaluate` passes the grounded set
there and keeps the axiomatic-only set for the two attribution sites.
`checkValidity` passes only `forcedTrueVariableIds` and is untouched: the
coupling is harmless there, because its rows are generated assignments with no
reader behind them.

## The trap fired, and my first pin missed it

T3 built the naive one-line version — grounded set straight into
`forcedTrueVariableIds` — and ran it against the full suite. **All 2431 tests
passed, including the criterion-3 pin written specifically to catch it.**

The pin was asserting on `variableProvenance[…].origin`, which
`forcedTrueVariableIds` does not touch. It feeds `isReaderAsserted`
(`argument-evaluation.ts:750`), which drives `conclusionAttribution.assertedByReader`
and which claims get a `claimAttribution` entry — a different mechanism one
level over.

Re-aimed, the naive version fails exactly two tests and nothing else:

| Assertion | Correct fix | Naive widening |
| --- | --- | --- |
| reader credited with asserting a cited conclusion claim | `true` | **`false`** |
| `reachedWithoutAssertion` after withholding that assertion | `false` | **`true`** |

The second is the one that matters: under the naive version the argument reports
reaching its conclusion **on its own merits, using a value the reader supplied.**

### The shape, named

Three times in two days a first-draft pin passed when it should have failed, and
the common cause is not forgetfulness — every one of them measured something
*adjacent* to the claim:

| Item | Pin measured | Defect lived in |
| --- | --- | --- |
| citations in `checkValidity` | a counterexample list already correct for the fixture | the enumeration set |
| satisfiability decomposition | a row count the early return made identical | the column set |
| this item | `variableProvenance` | `claimAttribution` |

Written into `AGENTS.md` under Testing as a standing check: name the exact field
the change writes, assert on **that** field, and where a plausible wrong fix
exists, build it and confirm the pin fails.

## The blast radius is zero, and the spec expected otherwise

The spec accepted that "more arguments become blocked" and asked for a number.
Measured over **114 published arguments** in a local `proposit-server` database,
comparing published `4.0.0` against this branch (which also carries the
satisfiability decomposition — the two are not separable in one build):

| `premiseSetSatisfiable` | before | after |
| --- | --- | --- |
| `true` | 94 | **107** |
| `null` — not determined | 16 | **3** |
| `false` — blocked | 2 | **2** |
| `undefined` | 2 | 2 |

**Nothing was newly blocked.** The `false` set is the same two arguments before
and after, which isolates this item's contribution cleanly: pinning citations
`true` can only shrink the model set, so any new blocking would appear here, and
none did. The `null` → `true` movement of thirteen arguments belongs to the
decomposition, not to this change.

So the behaviour the user accepted is currently unobservable on real content.
That is worth knowing before the next publish — it means the risk is theoretical
today, and the first argument to hit it will be one nobody has written yet.

**A measurement trap on the way there.** The first tarball built for this
reported version `4.0.1` and did not contain `satisfiabilityForcedTrueVariableIds`
at all: `pnpm pack` tars the existing `dist/` and does not build. The
measurement would have silently compared the old engine against itself. Caught
by checking the installed package **by content** rather than by version;
recorded as a durable note.

## Acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| 1 | `evaluate()` reports the contradicted-by-its-source set unsatisfiable | Met |
| 2 | `evaluate()` and `checkValidity` agree | Met |
| 3 | reader's citation assignment still credited to them | Met, and confirmed discriminating |
| 4 | reached-without-assertion counterfactual unchanged | Met, and confirmed discriminating |
| 5 | still accepts a citation assignment; still throws for an axiom | Met |
| 6 | a caller's own forced-true set reaches the walk | Met |
| 7 | `pnpm run check` green, existing suites unmodified | Met |

Criterion 4's fixture was written at T3 rather than T1, as the plan required —
it could not be written honestly in advance, because finding a shape whose
counterfactual actually moves meant running the naive version to see what moved.

## Evidence

- `pnpm run check` green: **2432 passed / 12 skipped across 93 files**. Baseline
  2424; the 8 new tests account for the difference.
- No existing test was edited.
- Naive version against the full suite: 2431 passed before the pins were
  re-aimed, 2 failed after — both in this item's file.

## Documentation Sync

Four entries fired, as predicted. `argument-engine.interfaces.ts` — its JSDoc
stated the coupling in one sentence ("pinned in the satisfiability search **and**
never read back as reader assertions") and now states two. `docs/api-reference.md`
documents the new option and why widening the old one is the mistake it exists
to prevent. `AGENTS.md` gained the three-meanings invariant, amended the
grounded/unassignable entry, and gained the testing check above. Both
`upcoming.md` files.

## Not verified here

No consumer surface. More blocked reviews would be reader-facing in
`proposit-server` and `proposit-mobile`; the measurement says there are none
today, so there is nothing to look at. The root item
`2026-08-06-rejecting-a-sourced-claim-leaves-soundness-undetermined` pins a
matrix covering this shape and must be re-checked against this change — that is
the next item, not a gap in this one.
