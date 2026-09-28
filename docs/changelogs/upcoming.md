# Upcoming

## Changed

- `PremiseEngine.changeOperator` with three or more children, no child ids,
  and a new operator of `and`, `or` or `xor` now takes the existing in-place
  path instead of throwing "sourceChildId and targetChildId are required for
  split". The condition uses a new `isVariadicOperator` helper in
  `expression-manager-checks.ts`, which `isPermittedOperatorSwap` now uses
  too. Splits, and the throw for a binary new operator or a single child id,
  are unchanged.
- The `changeOperator` JSDoc now says a merge needs fewer than two children
  (it said "exactly 2", which the code never did) and when a split applies.
- `scripts/smoke-test.sh` section 5f swaps the four-child root to `xor` and
  back again, instead of swapping while it had two children.

## Added

- `TLlmOutputCheckFailure` is re-exported from `src/lib/index.ts`, which clears
  the typedoc warning that `checkArgumentStructure` referenced an undocumented
  type.
