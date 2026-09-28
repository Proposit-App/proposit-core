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
- `SOURCE_ANCHOR_NOTE_CODES.mentionUnclaimed`
  (`SOURCE_ANCHOR_MENTION_UNCLAIMED`): `finalizeResponseV2` adds one warning
  per mention in `input.mentions` that no canonical claim's `mentionIds` names,
  with `context: { mentionId, quote }`, under the same conditions as
  `notAttempted`. `claim-reference-validation` never compared the mention
  output with the claims' `mentionIds`, so this was silent before.

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

- `finalizeResponseV2` resolved every copy of a repeated `mentionId`, so one
  mention could produce two or more `SOURCE_ANCHOR_UNRESOLVED`, `AMBIGUOUS` or
  `APPROXIMATE` notes, and its anchor came from whichever copy resolved last.
  Only the first copy is resolved now, and later copies are ignored, so each id
  gets at most one resolution note and the first copy's anchor, even when the
  first copy fails and a later one would have resolved.
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
  200-premise build to 30 s, which failed on slow runners. It now builds 40
  and 160 premises (fastest of two runs each, CPU time) and requires the
  larger build to cost under 30x the smaller. Building is quadratic today,
  because every `createPremise` re-validates the whole argument: 14.7-16.4x
  for 4x the premises, measured in the test. With an extra validation pass
  per premise added to make the build cubic, it measured 50.9x with no time
  limit (a 440 s run); under the 120 s limit the same slowdown fails by
  timing out instead. The test pins that cost; it does not fix it. Its time
  limit is 120 s, there only to stop a hang, and so is the anchor-cost ratio
  test's, which could exceed vitest's default 5 s on a very busy machine while
  its ratio held.

## Internal

- `pnpm run docs` (and so `build` and `check`) now compares every declaration
  and re-export typedoc documents against the checked-in
  `docs/api-surface.txt`, with its kind, its number of call, construct and
  index signatures, and whether an accessor has a getter and a setter, and
  fails on any difference. That includes fields and signatures of object
  types written inline anywhere: in a union, a generic's type argument, a
  tuple, a conditional or mapped type, a method's parameter or return type,
  or a type parameter's constraint. A declaration found under a type
  parameter's default is listed only when its source position is not already
  listed, since defaults mostly repeat declarations written elsewhere.
  `scripts/check-api-surface.mjs` does the comparison over typedoc's JSON
  output, written to the gitignored `.typedoc/`. A stray `@internal` comment
  that hides a public member, which `excludeInternal` otherwise does silently,
  now fails the build. After an intended API change, run
  `pnpm run api-surface:update` and commit the list.
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
- `ArgumentEngine`'s remaining read-only routines moved into module functions
  under `src/lib/core/argument/`: the restore-time checksum checks
  (`checksum-verification.ts`), the claim/variable reads and default
  assignment (`claim-variables.ts`, keeping the grounded and axiomatic-only
  variable sets side by side), the circular-binding check (`circularity.ts`),
  premise-argument parsing (`premise-args.ts`) and the display rendering
  (`display.ts`). Public methods keep their signatures and JSDoc on the class
  and delegate; `argument-engine.ts` is about 390 lines shorter.
