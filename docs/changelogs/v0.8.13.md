# Changelog

### Bug Fixes

- **expression-manager:** Extract `registerExpression` to bypass grammar normalization during expression loading in `fromData`/`fromSnapshot`. `loadInitialExpressions` now calls `registerExpression` directly instead of `addExpression`, eliminating BFS ordering dependency and preventing checksum drift when `wrapInsertFormula` is enabled.
- **expression-manager:** Fix `normalize()` Pass 3 to re-add formula buffer positions after `reparent` and mark formula buffers dirty for checksum recomputation.
- **argument-engine:** Thread caller-supplied `grammarConfig` to all premise engines and expression managers in `fromSnapshot`, ensuring post-load validation and mutations use the correct grammar rules.
