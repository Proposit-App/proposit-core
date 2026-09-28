# Upcoming

## Added

- `composeChangesets(first, then)`, exported from the package root: combines
  the changesets of two successive mutations into one, giving each entity a
  single bucket (a new entity stays added; modified then removed becomes
  removed; added then removed disappears). Use it rather than
  `mergeChangesets`, which throws on an id in two buckets, to combine a
  sequence of mutations.
- `TLlmOutputCheckFailure` is re-exported from `src/lib/index.ts`, which clears
  the typedoc warning that `checkArgumentStructure` referenced an undocumented
  type.
- `SOURCE_ANCHOR_NOTE_CODES.notAttempted` (`SOURCE_ANCHOR_NOT_ATTEMPTED`):
  `finalizeResponseV2` adds one warning per claim whose `mentionIds` name no
  mention in `input.mentions`, with `context: { claimMiniId }`. Skipped when
  `input.mentions` is absent or the input has no text (the latter is already
  covered by the single `SOURCE_ANCHOR_INPUT_UNAVAILABLE`).

## Changed

- No changeset names an entity more than once. `ChangeCollector` records
  each entity in one bucket by the same rule as `composeChangesets`, so a
  new entity no longer also appears under `modified`, and an expression
  changed twice in one call (permissive `changeOperator` on a nested
  operator listed its root twice) appears once.
- `ArgumentEngine.removePremise` lists the removed premise's own expressions
  under `expressions.removed`. Before, only the premise was listed, and a
  consumer applying the changeset kept its expressions.
- In `assistive` behavior, the changeset a mutation returns now includes
  what assistive normalization changed after it: expressions it removed
  (the formula buffer and operator AN-4 absorbs, for example), formula
  buffers it added, and the expressions and premises it moved or whose
  checksums changed, in any premise. Before, the changeset was built before
  normalization ran, so none of that was in it. An expression the call added
  and normalization removed appears in no bucket. In `permissive` behavior,
  where normalization does not run, this part changes nothing.
  Normalization now runs from an internal per-premise follow-up
  (`PremiseEngine.setMutationFollowUp`, `@internal`) rather than from
  `onMutate`, so setting `onMutate` on an engine-owned premise no longer
  turns normalization off.
- `PremiseEngine.deleteExpressionsUsingVariable`,
  `ArgumentEngine.removeVariable` and `removePremise`'s bound-variable
  cascade return everything their inner removals changed, such as the child
  promoted when an operator collapses, not only what was removed. This
  applies in both behaviors, so these calls return more in `permissive`
  behavior too. So does a derivation `createPremise`, which now keeps the
  whole changeset of the root expression it adds.
- Changesets from successive mutations can now name the same entity more
  often (one mutation adds an expression, the next one's normalization moves
  it). `mergeChangesets` throws when an id lands in two buckets, so combining
  such a sequence needs care; applying the changesets in order is safe.
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
