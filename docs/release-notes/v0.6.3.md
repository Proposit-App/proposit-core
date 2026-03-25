# Release Notes

## Bug Fixes

- **`wrapExpression` position spacing** — When wrapping an expression with a new operator, the two child expressions now get well-spaced positions instead of consecutive integers. This means subsequent insertions between them work correctly without needing a manual repositioning step.
