# Release Notes

## Review-helper APIs

Four new APIs make it easier to build argument-review UIs on top of `proposit-core` without duplicating traversal logic:

- `collectArgumentReferencedClaims(ctx)` — returns every distinct claim referenced by the argument, de-duped and ordered supporting → conclusion → constraint. Note: the helper includes constraint-only claims (walked after the conclusion) so they are not silently dropped.
- `PremiseEngine.getDecidableOperatorExpressions()` — returns the operator expressions a reviewer can accept or reject (excluding `"not"`), in pre-order tree order. Also available on the narrower `TEvaluablePremise` interface.
- `canonicalizeOperatorAssignments(ctx, input)` — expands `{ premiseScope, expressionOverrides }` into a flat per-expression assignment map. Expression overrides are accepted even when the containing premise is NOT in `premiseScope`. Throws `UnknownExpressionError` for unknown ids and `NotOperatorNotDecidableError` (with a `reason` of `"is-not-operator"` or `"not-an-operator-type"`) for unvotable targets.
- `TCoreArgumentEvaluationResult.propagatedVariableValues` — an opt-in map of the evaluator's authoritative propagated variable values (populated when `includeDiagnostics: true`). **The key set is `referencedVariableIds`**, i.e. claim-bound and externally-bound premise variables. Internally-bound premise variables are resolved lazily during evaluation and have no standalone truth value to surface here.

Three new error classes support the above: `InvalidArgumentStructureError`, `UnknownExpressionError`, `NotOperatorNotDecidableError` (with a `TNotOperatorNotDecidableReason` discriminator).
