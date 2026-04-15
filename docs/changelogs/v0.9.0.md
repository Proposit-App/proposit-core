# Changelog

- feat(review-helpers): add `collectArgumentReferencedClaims`, `PremiseEngine.getDecidableOperatorExpressions`, `canonicalizeOperatorAssignments`, and `TCoreArgumentEvaluationResult.propagatedVariableValues`. New errors: `InvalidArgumentStructureError`, `UnknownExpressionError`, `NotOperatorNotDecidableError`. Ordering for collected claims: supporting → conclusion → constraint (spec extended to cover constraint-only claims). `propagatedVariableValues` is gated on `includeDiagnostics: true` and keyed by `referencedVariableIds`.
