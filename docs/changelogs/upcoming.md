# Changelog

<changes starting-hash="f03dca7" ending-hash="f03dca7">

## Fixed

- `PremiseEngine` mutation methods (`addExpression`, `appendExpression`, `addExpressionRelative`, `updateExpression`, `removeExpression`, `insertExpression`, `wrapExpression`, `toggleNegation`) now return changesets with correct hierarchical checksums. Previously, `attachChecksum()` always set `descendantChecksum: null` and `combinedChecksum: checksum` (entity-only), and the `ChangeCollector` captured these premature values before `flushExpressionChecksums()` ran.
- Added `flushAndBuildChangeset()` private helper to `PremiseEngine` (`src/lib/core/premise-engine.ts`) that flushes expression checksums and re-reads corrected values into the changeset's `added` and `modified` arrays before returning.
- Replaced `collector.toChangeset()` with `this.flushAndBuildChangeset(collector)` in all 9 call sites across 8 mutation methods.

## Added

- 6 new tests in `test/core.test.ts` under `"changeset hierarchical checksums"` covering `wrapExpression`, `toggleNegation`, `addExpression`, `insertExpression`, `removeExpression`, and `updateExpression`.

</changes>
