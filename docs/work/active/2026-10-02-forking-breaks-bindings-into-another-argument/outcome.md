# Outcome: forking breaks bindings into another argument

All four sites are fixed on `fix/fork-external-bindings`, one commit per site, each together with its test.

## Each test failed first, for the stated reason

| Test | Failure before the fix |
|---|---|
| `test/core/forks.test.ts` — `forkArgumentEngine` keeps the binding | `Bound premise "undefined" does not exist in this argument.` |
| `test/core/forks.test.ts` — `PropositCore.forkArgument` succeeds | the same error |
| `test/core/variables.test.ts` — not among the variables bound to local `p1` | `expected [ …(2) ] to not include 'v-ext'` |
| `test/core/variables.test.ts` — survives removing local `p1` | `expected undefined to be defined` (the cascade deleted it) |
| `test/core/variables.test.ts` — placed in local `p1` | `Circular binding: variable "v-ext" is bound to this premise` |
| `test/changeset/order-changeset.test.ts` — not held back | `expected 1 to be less than 0` (the update came after the insert) |

## Changes

- `src/lib/core/fork.ts`: remap a premise-bound variable only when it is bound into the source argument.
- `src/lib/core/argument-engine.ts` (`getVariablesBoundToPremise`), `src/lib/core/argument/circularity.ts` and `src/lib/utils/changeset-order.ts`: require `boundArgumentId` to be this argument before matching a local premise.
- Documentation:
  - `docs/api-reference.md`: `forkArgumentEngine` and `getVariablesBoundToPremise`;
  - `skills/proposit-core/docs/forking-and-diffs.md`;
  - the `getVariablesBoundToPremise` JSDoc in `argument-engine.interfaces.ts`;
  - changelog and release notes, under Fixed.
  Other documentation entries do not fire, as the plan records.

## Checks

- `pnpm run check` passes.
- `pnpm run test`: 2751 passed, 13 skipped.

## Release

- The target is 5.4.3. It also carries the unreleased entries already in `upcoming.md` from the repository cleanup.
- The tarball goes to the consumer for validation.
- The version bump, merge and tag wait for that verdict.

**What happened to the release.** 5.4.3 was released and tagged `v5.4.3`. Whether the consumer validated its tarball before publication is **unconfirmed**: neither the maintainer nor any record can confirm it. The only record is the consumer re-pinning to 5.4.3 after publication.

## Rework (2026-10-02)

Verification found two gaps (`rework.md`). Both are fixed on `feat/response-arguments` and ship in 6.0.0, not in a 5.4.x release.

- **A fifth site.** `wireEmptyBoundPremiseCheck` (`src/lib/core/argument-engine.ts`) looked a bound premise up among this argument's own premises without checking `boundArgumentId`. So `validateEvaluability` warned `EXPR_BOUND_PREMISE_EMPTY` for every variable bound to a premise in another argument. When a local premise shared the id, the warning described that unrelated premise instead. Now it checks only bindings into this argument. Commit `0d985319`.
  - Seen failing first: both new tests in `test/core/variables.test.ts` ("the empty-bound-premise warning for a binding into another argument") failed. In each, the issues filtered to `EXPR_BOUND_PREMISE_EMPTY` held one warning instead of none.
- **Criterion 1's internal half.** New test `forkArgumentEngine moves a binding into this argument onto the fork` (`test/core/forks.test.ts`): the forked variable's `boundPremiseId` is the remapped premise, `boundArgumentId` is the fork's id, and `boundArgumentVersion` is 0. Commit `5261f311`.
  - It pins behaviour that was already correct, so it passed on the tree as it was. To prove it can fail, `fork.ts` was changed for one run to keep the original `boundArgumentVersion`. This test failed and the other 42 in the file passed, which confirms nothing else pinned that field.
- **Documentation:** changelog and release notes, under Fixed, in `upcoming.md`.
