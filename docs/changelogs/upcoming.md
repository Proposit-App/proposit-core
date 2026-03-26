# Changelog

<changes starting-hash="b6f5a20" ending-hash="f1e4e2b">

## Added

- `PremiseEngine.changeOperator(expressionId, newOperator, sourceChildId?, targetChildId?, extraFields?)` — compound operator mutation method handling simple change, merge (dissolve into same-type parent), and split (extract children into new sub-operator with formula buffer). Added to `TExpressionMutations` interface in `src/lib/core/interfaces/premise-engine.interfaces.ts`.
- `ExpressionManager.reparentExpression(expressionId, newParentId, newPosition)` — public wrapper around private `reparent` method.
- `ExpressionManager.deleteExpression(expressionId)` — removes a single childless expression without triggering operator collapse.
- `ExpressionManager.changeOperatorType(expressionId, newOperator)` — changes operator type without `PERMITTED_OPERATOR_SWAPS` restriction, with root-only validation for `implies`/`iff`.
- 10 new tests in `test/core.test.ts` under `"changeOperator"` covering no-op, simple change, merge, split, checksums, extraFields, and error cases.
- `flushAndBuildChangeset` now includes premise checksum updates as `premises.modified` entries when the premise's `combinedChecksum` changes after expression mutations.
- 7 new tests in `test/core.test.ts` under `"premise checksum in changeset"` covering addExpression, removeExpression, wrapExpression, toggleNegation, insertExpression, no-op updateExpression, and changeOperator.

</changes>
