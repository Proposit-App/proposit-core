# Forking breaks bindings into another argument

## What is wanted

Forking an argument that holds a variable bound to a premise in a **different** argument (made with `bindVariableToExternalPremise` or `bindVariableToArgument`) throws, so such an argument cannot be forked at all. The maintainer asked for the fix to ship now, as a patch release, rather than wait for the next major version.

Reproduced at `90578ec3`: `forkArgumentEngine` on an engine holding one external binding fails with `Bound premise "undefined" does not exist in this argument`.

A sweep of every place that tests `isPremiseBound` found three more that match a binding by premise id alone without checking that the premise is in this argument, so an external binding whose remote premise id equals a local premise id is treated as internal:

- `getVariablesBoundToPremise` — used when a premise is removed, so removing a local premise would also delete that external binding;
- the circularity check (`src/lib/core/argument/circularity.ts`);
- `orderChangeset`'s placement of variables bound to a premise the changeset inserts.

These are the same mistake and ship in the same patch.

## Constraints

- Patch release (5.4.3); no public API change.
- Bug fix: a failing test reproducing each defect first.
- The release waits for consumer-side validation of the tarball.

## Notes

- References: asked; none provided. Found while specifying `2026-10-02-add-response-arguments-that-answer-a-pinned-version-of-another-argument-through-links`, whose response arguments are built from external bindings.
