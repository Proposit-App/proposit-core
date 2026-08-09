# Refined outcome — accepted

Accepted at the publish window for `@proposit/proposit-core` v4.0.0.

## Decision

Accepted as delivered, including the three deviations `outcome.md` records (the
`contested` graph colour, T9's stronger `null` rule, and the `fixtures.ts` arrow
property) and the four re-review follow-ups folded in — `contestedVariableIds`,
the `resolveValue` arity guards, the `∨` paraconsistency note, and the corrected
Fitting attribution.

## Evidence

- `pnpm run check` on merged `main` (`c9cef18`): typecheck, prettier, eslint,
  **2401 passed / 12 skipped across 86 files**, build and typedoc clean.
- The harness discriminates: with `mergeIntoChild` reverted to the old
  decline-to-overwrite rule the five confluence tests fail and the 300-run repro
  returns the reported `[true, false]` split; with the merge in place it returns
  a single `contested` and one provenance shape.
- Merged to `main` fast-forward; `v4.0.0` tagged at the release commit.

## Deferred follow-ups

- **The wire gate in `@proposit/shared`** (`src/schemas/review.ts`) rejects the
  new `"contested"` origin — carried by the shared slices in this same window,
  which is why the two repos publish together.
- **Reader-facing rendering of `contested`** is the consumers' call; core ships
  the value, the provenance and the guidance, and no label strings.
- **`getVariableIdForClaim`** is known-broken and escalated separately, which is
  why `contestedVariableIds` is variable-keyed rather than claim-keyed.

## Closeout

- No version bump: v4.0.0 was unpublished, so this work folded into it rather
  than stacking a second major on top. The `v4.0.0` tag was moved to the release
  commit once the branch merged.
- Capabilities: none declared.
