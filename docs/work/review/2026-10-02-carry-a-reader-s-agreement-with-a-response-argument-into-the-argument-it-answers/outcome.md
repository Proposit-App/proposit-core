# Outcome: carry a reader's agreement with a response argument into the argument it answers

Implemented on `feat/response-arguments` against the approved spec (fifth revision) and its plan. It ships in 6.0.0 with the response item. Nothing is pushed or published.

## Commits, task by task

| Task | Commit | What |
|---|---|---|
| 1 | `2fada11b` | `createTargetExpander` and `evaluateCombinedNode` pulled out of `buildCombinedSet`, behaviour unchanged (132 response tests passed before and after) |
| 2 | `b4b5d57c` | `decomposeStatement`: a statement about one target expression as a cube of fixed column values, or `notExpressible` / `impossible` / `vacuous` / `tooLarge` |
| 3 | `db6a4545` | `ArgumentEngine.carryAnswers` into a standard argument; the carrying types; the engine's precondition shared with the checks (`responseLinkProblems`) |
| 4 | `4b1f0769` | Carrying into another response, as answers on its links |
| 5 | `b542ca5b` | `mergeCarriedInput`; `evaluateWithDefaults` takes `operatorAssignments` |
| 6 | `25ef18e1` | Criterion 9 in `test/evaluation/attribution.test.ts` |
| 7 | `6a5b8dbd` | Exports and `docs/api-surface.txt` |
| 8 | `ec9230b9` | Documentation; `df781419` the taxonomy entries |

## Checks

- `pnpm run check` passes at `ec9230b9`: 3028 tests passed, 13 skipped, 143 files passed and 5 skipped. That includes typecheck, lint, the build, and the API-surface check.
- `docs/api-surface.txt` was read line by line. It gains `carryAnswers` (on `ArgumentEngine` and `TArgumentEvaluation`), `mergeCarriedInput` and the carrying types, and loses nothing. Typedoc lists no parameters, so the new `evaluateWithDefaults` parameter does not appear in it.
- The full diff since the item started (`9c8710ab`), outside `docs/work`, was searched for private repository names and paths, ticket keys, and planning language in source, tests and commit messages. Nothing was found.

## Tests seen failing before the change

- **Task 2:** the whole file failed to load (`Cannot find module '../../src/lib/core/response/carry'`).
- **Task 3:** 43 of 55 failed (`carryAnswers is not a function`). The 12 that passed were Task 2's.
- **Task 4:** 7 of the 10 new tests failed. The 3 that passed were the inference `noLinkReached` case, the statement `noLinkReached` case, and "no variables or operator decisions". All three matched the placeholder, which reported every agreed link as `noLinkReached`. The fourth wrong implementation below shows the answer-direction tests are what pin Task 4.
- **Task 5:** all 7 new tests failed (`mergeCarriedInput is not a function`, and `evaluateWithDefaults` ignoring the decisions).
- **Task 6:** passed on the tree as it was, as the plan expected, because carried values already arrive in `variables`. Its proof is the fifth and sixth wrong implementations.

## Wrong implementations tried (each caught, then reverted)

1. **A claim's value placed on its first variable only.** Fails "contradicting a claim sets every variable of that claim false".
2. **The cube found with the response's grounded claims held true,** as `buildCombinedSet` does. It carried "Q false" for Y-cites-S-contradicting-`S ∧ Q`, which fails the grounded-column test.
3. **`accepted` carried for a nested reinforce.** Fails all three `nestedReinforce` tests, including the check that the nested operator's children keep their values.
4. **`accepted` carried at any root.** Fails all eight `nonConditionalRoot` tests (freeform `and`, `not`, `or` and `xor`; conclusion `and`, `not` and `or`; a wrapped `and` conclusion) and the freeform `and` conjunct check.
5. **Every link of the answered response read as positive** (Task 4). A contradict link was agreed when its statement was fixed true. Fails 4 tests.
6. **Carried values seeded through `forcedTrueVariableIds` rather than `variables`** (criterion 9, first case). `assertedByReader` became false.
7. **`accepted` carried at a non-conditional root** (criterion 9, second case). All three attribution cases reported `reachedWithoutAssertion: true`.
8. **`decomposeStatement` counting columns from the expander's shared map** (the fifth review's point about collecting E's own columns). Fails "counts only the expression's own columns against the ceiling".

## What the plan or spec got wrong

- **Criterion 2 asks for a conditional root under a formula wrapper; that cannot be built.** An `implies` or `iff` must sit at its premise's root with no parent, and the engine refuses it under a formula node (`Operator expression ... with "implies" must be a root expression`). The wrapped cases are tested where they can exist instead: an undercut of a wrapped `and` root, and a reinforce of a wrapped `and` conclusion root (`nonConditionalRoot`). The rule "root is read through formula nodes" is still exercised.
- **The spec names no refusal code for a standard (non-response) engine.** `carryAnswers` answers `invalid` with `LINK_TARGET_MISMATCH` ("is not a response, so it answers no argument"), which is accurate: no snapshot can be the one it answers. This adds no new code.
- **`noLinkReached` also covers a standard target** when a link's fixed values reach no variable that evaluation reads, for example a claim used only in an unpopulated naked-Q derivation premise. The spec defined the reason only for response targets, and the type's documentation now says both.
- **Public names beyond the spec's list:**
  - `TNotCarried`: the `notCarried` entry type, which the spec described but did not name;
  - its `conflictsWith` field, which is how "reason `conflict` naming the others" is given;
  - the result discriminant `intoResponse`;
  - `TMergedCarriedInput` always carries all of `variables`, `operatorAssignments` and `linkAnswers`, passing the reader's own through.
- **The plan did not mention** that the test fixtures had no `xor` builder. One line was added to `test/core/response-fixtures.ts`.

## Timing

`carryAnswers` on a response with 10 agreed statement links, each over a 16-column expression (5 conjunctions affirmed, 5 disjunctions contradicted, 160 values carried), took 270, 264, 264, 262 and 265 ms over five runs. That is a truth table of 65,536 rows per link, at the ceiling. A person should judge this against the speed decision already made for the checks. Carrying runs once per reader action, not per keystroke, so this should be acceptable.

## Capability ledger and taxonomy

- The capability ledger is empty (`tcw capabilities list` prints nothing).
- The taxonomy gains the vocabulary term `carried-value` and the feature `answer-carrying` (`tcw taxonomy check`: OK).
- `argument-evaluation` is unchanged: the new `evaluateWithDefaults` parameter is an API detail that its description does not cover.

## Not done here

- The combined review of everything batched into 6.0.0, which should look at carrying together with the claim-level contested roll-up, and at the at-most-one operator's case in `evaluateCombinedNode`.
- The backlog item `2026-10-02-decide-whether-accepting-a-non-conditional-conclusion-root-is-the-reader-s-assertion` stays blocked on the maintainer.
