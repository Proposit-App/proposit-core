# Release Notes

## Auto-reposition on position collision

Expression tree operations that compute sibling positions via midpoint bisection (`addExpressionRelative`, `appendExpression`) now automatically redistribute sibling positions when a collision is detected. This eliminates the need for consumers to implement position-widening logic externally.

The behavior is controlled by the new `repositionOnCollision` flag in `TAutoNormalizeConfig`. It is enabled by default when `autoNormalize` is `true`.

When repositioning occurs, all affected siblings appear in `changes.expressions.modified` alongside the new expression in `changes.expressions.added`.

Additionally, `insertExpression` now uses midpoint-spaced child positions instead of hardcoded 0 and 1, and `promoteChild` computes better spacing using the midpoint of the promoted node's neighbors.
