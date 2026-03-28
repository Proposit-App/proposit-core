# Changelog

## Fixed

<changes starting-hash="1212d4a" ending-hash="1212d4a">
- `ExpressionManager.flushExpressionChecksums()` now records dirty ancestor expressions as `modifiedExpression` in the `ChangeCollector` when their `checksum`, `descendantChecksum`, or `combinedChecksum` values change during flush. Expressions already tracked as `added` are excluded to prevent duplication.
- Added `ChangeCollector.isExpressionAdded(id)` to check whether an expression ID is already in the `added` list.
- Updated existing test for `updateExpression` position change to expect parent in `modified` (parent's `descendantChecksum` changes when a child's position changes).
- Added 6 tests covering ancestor checksum propagation in changesets for `addExpression`, `appendExpression`, `addExpressionRelative`, checksum correctness, and no-duplication invariant.
</changes>
