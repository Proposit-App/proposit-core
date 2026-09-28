# Upcoming

## Added

- `TLlmOutputCheckFailure` is re-exported from `src/lib/index.ts`, which clears
  the typedoc warning that `checkArgumentStructure` referenced an undocumented
  type.
- `SOURCE_ANCHOR_NOTE_CODES.notAttempted` (`SOURCE_ANCHOR_NOT_ATTEMPTED`):
  `finalizeResponseV2` adds one warning per claim whose `mentionIds` name no
  mention in `input.mentions`, with `context: { claimMiniId }`. Skipped when
  `input.mentions` is absent or the input has no text (the latter is already
  covered by the single `SOURCE_ANCHOR_INPUT_UNAVAILABLE`).

## Changed

- `PremiseEngine.changeOperator` with three or more children, no child ids,
  and a new operator of `and`, `or` or `xor` now takes the existing in-place
  path instead of throwing "sourceChildId and targetChildId are required for
  split". The condition uses a new `isVariadicOperator` helper in
  `expression-manager-checks.ts`, which `isPermittedOperatorSwap` now uses
  too. The ids are tested with `=== undefined`, so an empty string (a CLI
  option given an empty value) still reaches the split path and its "required"
  error. Splits, and the throw for a binary new operator or a single child
  id, are unchanged.
- The `changeOperator` JSDoc now says a merge needs fewer than two children
  (it said "exactly 2", which the code never did), when a split applies, and
  that `implies` and `iff` can never be split out (the sub-operator would not
  be a root).
- `scripts/smoke-test.sh` section 5f swaps the four-child root to `xor` and
  back again, instead of swapping while it had two children.

## Fixed

- `PremiseEngine.changeOperator` returned `result: undefined` (typed
  `TExpr | null`) when, in `assistive` behavior, AN-4 absorbed the swapped
  operator into a same-operator grandparent through its formula buffer. It
  now returns `null`, as it does for a merge.

## Tests

- The origin library's anchor-cost test no longer holds 100 `addAnchor` calls
  to a fixed 300 ms, which failed on slower CI runners while the library was
  fine. It now times the same calls over documents 20x apart in size (fastest
  of three runs each) and requires the larger run to take under 3x as long.
  Measured locally: about 1.0x now, about 17x with the verified-body skip in
  `validate()` disabled.
- The pipeline overlap test drops its "stages started within 50 ms" check; the
  remaining assertions (each stage started before the other ended) already
  prove the overlap and do not depend on machine speed.
- The high-load build test in `test/core.test.ts` no longer holds a
  200-premise build to 30 s, which failed on slow runners. It now builds 60
  and 120 premises (fastest of two runs each, CPU time) and requires the
  larger build to cost under 5x the smaller. Building is quadratic today,
  because every `createPremise` re-validates the whole argument: about 3x per
  doubling locally, and the test failed with an extra validation pass per
  premise added to make it cubic. The test pins that cost; it does not fix
  it.

## Internal

- `PremiseEngine`'s read-only routines moved out of the class into module
  functions under `src/lib/core/premise/`, over a `TPremiseReadContext` — a
  plain context built per call; its two callbacks reach the engine's current
  ones: the formula-tree walks
  (`formula-tree.ts`), the evaluability check (`evaluability.ts`), evaluation
  (`evaluation.ts`) and the invariant sweep (`invariants.ts`). The class keeps
  one-line delegating methods, so its public surface is unchanged, and
  `premise-engine.ts` is about 530 lines shorter. `evaluate` still calls
  `this.validateEvaluability()` and `this.isInference()`, and `validate` still
  calls `this.toPremiseData()` first, so overriding any of them keeps its
  effect.
