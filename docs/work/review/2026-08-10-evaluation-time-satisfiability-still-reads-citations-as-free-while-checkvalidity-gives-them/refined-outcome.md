# Refined outcome — accepted

Accepted by the user on 2026-08-10, under a standing instruction to drive this
batch to completion. `825fec8..4bdc4ad`, four commits on `main`.

## The decision

All seven acceptance criteria met, `pnpm run check` green at **2432 passed / 12
skipped across 93 files** (baseline 2424, the 8 new tests accounting for the
difference), no existing test edited.

Two things carried the decision beyond the count.

**The trap the spec predicted actually fired.** The naive one-line version — the
grounded set straight into `forcedTrueVariableIds` — was built and run against
the full suite. It passes every satisfiability assertion and inverts
`reachedWithoutAssertion`, so an argument would report reaching its conclusion
*on its own merits using a value the reader supplied*. The spec was written
around a hazard that turned out to be real, and the separate option is what
avoids it.

**The blast radius the spec accepted is zero.** 114 published arguments
measured; the `false` set is the same two arguments before and after. Since
pinning citations `true` can only shrink the model set, any new blocking would
have shown there. The user accepted a behaviour change that no current content
exercises — worth knowing, and the reason this closes without consumer
verification.

## The pin that missed, and what it changes going forward

The first attempt at the discriminating pin passed against the naive version:
it asserted on `variableProvenance`, and the defect lives in `claimAttribution`.
That is the third first-draft pin in two days to measure something adjacent to
its own claim.

The standing check now lives in `AGENTS.md` under Testing — name the exact field
the change writes, assert on that field, and where a plausible wrong fix exists,
build it and confirm the pin fails. It is recorded there rather than in this
item because it is not about citations; the next person to write a pin in this
repo is who needs it.

## Closeout choices

**Merge route.** Direct on `main`, no branch, no PR.

**Documentation.** Complete at implementation time; four triggers fired as
predicted, including the `evaluate` JSDoc that stated the coupling this change
breaks apart.

**Version.** Folds into the unpushed `v4.0.1` — the tag was cut earlier today
and exists nowhere but this machine, so this work joins it rather than stacking
a second patch on top. The tag is moved to the head of this work and the
changelog range extended at closeout, not during implementation.

**Capabilities.** No ledger write; core carries no capability ledger.

**Follow-ups.** None new. Three items from the approved batch remain: re-check
the root sourced-claim matrix against this change, adopt `getVariableIdForClaim`
into core, and merge the shared operator-queue pair.

## Note on the tarball

The first consumer build for the measurement carried version `4.0.1` and none of
this change: `pnpm pack` tars the existing `dist/` without building. Caught by
verifying the installed package by content. Anything that validates a consumer
against a local build has to check content, not version — the version string is
written by `pnpm version` and proves nothing about what was compiled.
