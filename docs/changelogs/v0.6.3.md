# Changelog

<changes starting-hash="d99ed9b" ending-hash="d99ed9b">

## Fixed

- `ExpressionManager.wrapExpression()` now assigns child positions using `POSITION_INITIAL` and `midpoint(POSITION_INITIAL, POSITION_MAX)` instead of hardcoded 0 and 1 (`src/lib/core/expression-manager.ts`)
- `PremiseEngine.validateEvaluability()` no longer checks for exact positions 0 and 1 on binary operators; validates 2 children with distinct positions instead (`src/lib/core/premise-engine.ts`)
- `PremiseEngine.evaluate()` uses sorted `children[0]`/`children[1]` instead of `find(position === 0/1)` for `implies`/`iff` left/right identification (`src/lib/core/premise-engine.ts`)
- `buildPremiseProfile()` uses sorted children instead of hardcoded position lookups for antecedent/consequent identification (`src/lib/core/relationships.ts`)

## Tests

- Added 2 tests for midpoint-spaced positions in `wrapExpression` (left-child and right-child variants) (`test/core.test.ts`)

</changes>
