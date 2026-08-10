# Plan — a separate set for the satisfiability question

Five tasks. The whole risk is that the naive one-line version passes two
acceptance criteria and fails two others, so T1 writes the trap tests before
anything changes and T3 proves they would have caught it.

## T1 — The failing tests, including the two the naive fix would break

**Changes:** new `test/evaluation/citation-satisfiability.test.ts`.

Four groups, and the plan is explicit about which fail before the change and
which fail only against the *wrong* change:

| Criterion | Fails before T2 | Fails against the naive widening |
| --- | --- | --- |
| 1 — `evaluate()` reports the premise set unsatisfiable | **yes** | no |
| 2 — `evaluate()` and `checkValidity` agree | **yes** | no |
| 3 — a reader's citation assignment still reads `asserted` | no | **yes** |
| 5 — still accepts a citation assignment, still throws for an axiom | no | no |
| 6 — a caller's own forced-true set reaches the walk | no | no |

Criterion 4 (the reached-without-assertion counterfactual) is deliberately
listed with 3 in T3 rather than here — see below.

The fixture for 1 and 2 is one argument: a citation-bound claim plus a premise
satisfiable only when that claim is false, asserted against both
`evaluate().premiseSetSatisfiable` and `checkValidity`'s precompute.

**Verified by:** running the file at T1 — expect exactly the criterion-1 and -2
assertions failing, on `expect`, and 3/5/6 green.

## T2 — `satisfiabilityForcedTrueVariableIds`

**Changes:**

- `TCoreArgumentEvaluationOptions` (`src/lib/types/evaluation.ts`) gains the
  optional field.
- `evaluateArgument` (`argument-evaluation.ts:637`) passes
  `options.satisfiabilityForcedTrueVariableIds ?? options.forcedTrueVariableIds`
  to `isPremiseSetSatisfiable`. Sites `:746` (`isReaderAsserted`) and `:776`
  (`conclusionClaimVariableIds`) are **not** touched and must read
  `forcedTrueVariableIds` unchanged.
- `ArgumentEngine.evaluate` (`argument-engine.ts:2850`) keeps
  `forcedTrueVariableIds` axiomatic-only and supplies the grounded set as
  `satisfiabilityForcedTrueVariableIds`, unioning a caller's own set into both.

The fallback keeps `checkValidity` — which passes only `forcedTrueVariableIds` —
behaving exactly as today.

**Verified by:** criteria 1 and 2 flip to green; 3, 5, 6 stay green;
`pnpm run test` green.

## T3 — Prove the two trap criteria discriminate

**Changes:** none committed. Implement the **naive** version — grounded set
passed as `forcedTrueVariableIds` in `ArgumentEngine.evaluate`, no new option —
and confirm it fails criterion 3, and criterion 4 once written.

Criterion 4 belongs here rather than in T1 because its fixture cannot be written
honestly in advance: it has to be an argument whose `reachedWithoutAssertion`
actually moves under the naive version, and finding that shape means running the
naive version to see what moves. Writing the assertion first would be guessing
at a value and then justifying it.

So: build the naive version, find a fixture whose `reachedWithoutAssertion`
differs between it and the real fix, write criterion 4 around that fixture,
confirm it fails naive and passes real, revert the naive version.

If **no such fixture exists** — if the counterfactual turns out not to move —
say so plainly in the outcome and drop criterion 4 rather than inventing a test
that passes either way. A criterion that cannot be made to fail is not a
criterion, and the previous two items both shipped a fixture that looked like a
pin and was not.

**Verified by:** failure counts recorded in `outcome.md`; `git diff` clean after
the revert.

## T4 — Measure the blast radius

**Changes:** none. Instrument locally, record, revert.

The spec accepts that more arguments become blocked. That should be a number:
count how many published arguments in the local `proposit-server` database
change `premiseSetSatisfiable` under this change. Requires the tarball pinned
into the server and a script over the local database.

If the count is zero, that is the result and it goes in the outcome — it would
mean the fix is correct and currently unobservable, which is worth knowing
before the next publish.

## T5 — Documentation Sync

One pass after T1–T4. Evaluated against every `AGENTS.md` entry; four fire.

| File | Trigger | Why |
| --- | --- | --- |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | `Public-Engine-API` | `evaluate`'s JSDoc (`:605-609`) states the coupling this item breaks apart — "passed down as `forcedTrueVariableIds` so they are pinned in the satisfiability search **and** never read back as reader assertions". Those are now two sets and two sentences. |
| `docs/api-reference.md` | `Public-API` | The new option is public surface; and the `premiseSetSatisfiable` passage must say a citation is given at evaluate time too. |
| `AGENTS.md` | `Routing` | A new easy-to-violate invariant: `forcedTrueVariableIds` means three things at once — pinned in the walk, not-reader-asserted, and out of the counterfactual — so widening it to fix the first silently changes the other two. The existing "'Grounded' and 'unassignable' are different sets" entry also needs its evaluation half amended. |
| `docs/release-notes/upcoming.md`, `docs/changelogs/upcoming.md` | `Public-API`, `Any-Code-Change` | Reader-visible: an argument that only works if a cited source is wrong now blocks. |

Not firing: both `README.md` entries, `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`,
the three other `interfaces/*.ts` entries, `proposit-core.ts`,
`argument-library.ts`, `fork-library.ts`, `fork-namespace.ts`,
`examples/arguments/*.yaml`.

## Verification

Beyond `pnpm run check`:

- **T3 is the item.** Nothing in the suite proves a test would have caught the
  wrong fix; only building the wrong fix does.
- **T4's measurement.** The user accepted a behaviour change whose scale is
  unknown. Only counting answers it.
- **Consumer impact is not verified here.** More blocked reviews is a
  reader-facing change in `proposit-server` and `proposit-mobile`; this item
  ships the engine half. Whether the blocked-review surface reads well on an
  argument that newly blocks is a consumer question, and the root item
  `2026-08-06-rejecting-a-sourced-claim-leaves-soundness-undetermined` is where
  that lands — it must be re-checked once this ships, because its pinned matrix
  covers exactly this shape.
