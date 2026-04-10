# Changelog

## Auto-reposition on position collision (`9981cdc..918f109`)

- `9981cdc` feat(grammar): add `repositionOnCollision` flag to `TAutoNormalizeConfig`
- `cbafd47` feat(expression-manager): add `repositionSiblings` private method and collision handling in `addExpressionRelative`
- `463401f` feat(expression-manager): add collision handling to `appendExpression`
- `7e3ee50` fix(expression-manager): use midpoint-spaced positions in `insertExpression` instead of hardcoded 0 and 1
- `f8d6322` feat(expression-manager): improve `promoteChild` positioning with midpoint of neighbors
- `918f109` test: add comprehensive coverage for `repositionOnCollision` flag
