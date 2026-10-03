# Rework: forking breaks bindings into another argument

Decided 2026-10-02 by the maintainer (relayed by the requester): **rework**.

## What verification found

The four sites the spec named are fixed, each new test failed before its fix, and the fix is intact on `feat/response-arguments`. `pnpm run check` passed at `0e7b6ea3` (2940 tests passed, 13 skipped). Two gaps remain:

1. **A fifth site with the same defect.** `wireEmptyBoundPremiseCheck` (`src/lib/core/argument-engine.ts:347-360`) looks the bound premise up in this argument without checking `boundArgumentId`. Every variable bound to a premise in another argument, once used in a premise, gets a false `EXPR_BOUND_PREMISE_EMPTY` warning from `validateEvaluability`. When the outside premise id happens to match a local premise, the warning reflects that unrelated local premise instead. It is a warning, never a throw. The spec did not list this site.
2. **Criterion 1's internal-binding half has no test of its own.** It rests on an older test that checks only that `boundPremiseId` is remapped. Nothing pins that `boundArgumentId` becomes the forked argument's id and `boundArgumentVersion` becomes 0.

## What the rework must do

On `feat/response-arguments`, so both ship in 6.0.0 (5.4.3 is already released):

- Fix the fifth site test first: a failing test reproduces the false warning for a variable bound to a premise in another argument, then the check skips bindings into another argument.
- Add the missing test for criterion 1's internal half: after forking, an internal binding's `boundArgumentId` is the fork's argument id and `boundArgumentVersion` is 0.
- Update `outcome.md` with both, and the changelog under Fixed.

## Record of the 5.4.3 release

`outcome.md` planned that the tarball would go to the consumer for validation before the version bump, merge and tag. **Whether that validation happened is unconfirmed.** Neither the maintainer nor any record can confirm that the consumer checked 5.4.3's tarball before it was published. The only record is the consumer re-pinning to 5.4.3 after publication. Nothing here should claim the release was validated beforehand.
