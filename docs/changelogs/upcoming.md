# upcoming changelog

## Changed

- `src/lib/core/expression-manager.ts` (2,042 → 1,397 lines) split into
  four files: the class shell, `expression-manager-dirty-set.ts` (checksum
  dirty-set bookkeeping), `expression-manager-invariants.ts` (the
  whole-tree `validate()` scan), and `expression-manager-checks.ts`
  (per-mutation structural-check functions for `insertExpression`,
  `wrapExpression`, `repositionSiblings`, `updateExpression`,
  `removeAndPromote`, `addExpressionRelative`). Internal-only — no import
  path, public API, or behavior change.
