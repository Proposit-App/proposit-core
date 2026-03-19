# Subjective Logic Evaluation

**Date:** 2026-03-18
**Status:** Design approved
**Breaking:** Yes (return types, removed fields)

## Summary

Replace the Kleene three-valued evaluation system with Jøsang's subjective logic. Variables are assigned opinion tuples `(belief, disbelief, uncertainty, baseRate)` instead of `true`/`false`/`null`. The existing Kleene values are the three corner cases of the opinion simplex, so this is a strict generalization — not an addition alongside it.

`checkValidity()` is unchanged (classical corner-case enumeration). Uncertainty propagation analysis is deferred to a future feature once consumers have experience with opinion-based evaluation.

## Design decisions

| Decision                          | Choice                               | Rationale                                                                                                          |
| --------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Relationship to existing evaluate | Replacement, not separate method     | Kleene is a special case of subjective logic                                                                       |
| Input format                      | Accept `TOpinion \| boolean \| null` | Backward-compatible sugar; `toOpinion()` normalizes                                                                |
| Return type                       | All values become `TOpinion`         | Consistent; consumers use `projectProbability()` for scalars                                                       |
| Aggregate classification flags    | Remove from evaluation result        | Flags like `isCounterexample` are not the evaluator's concern; derived opinions speak for themselves               |
| `checkValidity()`                 | Keep as-is                           | Corner-case enumeration is still classical validity; counterexample detection rebuilt from corner opinion equality |
| Uncertainty analysis              | Deferred                             | Ship evaluation first, let usage inform analysis API                                                               |
| Base rate                         | Included (4-tuple)                   | Required for probability projection; defaults to 0.5                                                               |

## Section 1: Opinion type and operators

### TOpinion

```typescript
{
    belief: number // [0, 1]
    disbelief: number // [0, 1]
    uncertainty: number // [0, 1]
    baseRate: number // [0, 1], default 0.5
}
// Constraint: belief + disbelief + uncertainty = 1
```

### Corner constants

```typescript
OPINION_TRUE = { belief: 1, disbelief: 0, uncertainty: 0, baseRate: 0.5 }
OPINION_FALSE = { belief: 0, disbelief: 1, uncertainty: 0, baseRate: 0.5 }
OPINION_UNCERTAIN = { belief: 0, disbelief: 0, uncertainty: 1, baseRate: 0.5 }
```

### Operators

All in a new `subjective.ts` alongside `kleene.ts`:

- **`subjectiveNot(a)`** — complement: swap belief/disbelief, keep uncertainty, baseRate becomes `1 - a.baseRate`
- **`subjectiveAnd(a, b)`** — independent conjunction:
    - `b_out = a.belief * b.belief`
    - `d_out = a.disbelief + b.disbelief - a.disbelief * b.disbelief`
    - `u_out = a.belief * b.uncertainty + a.uncertainty * b.belief + a.uncertainty * b.uncertainty`
    - `baseRate_out = a.baseRate * b.baseRate`
- **`subjectiveOr(a, b)`** — direct formula (equivalent to De Morgan but avoids unnecessary NOT/AND overhead in n-ary reduce):
    - `b_out = a.belief + b.belief - a.belief * b.belief`
    - `d_out = a.disbelief * b.disbelief`
    - `u_out = a.disbelief * b.uncertainty + a.uncertainty * b.disbelief + a.uncertainty * b.uncertainty`
    - `baseRate_out = a.baseRate + b.baseRate - a.baseRate * b.baseRate`
- **`subjectiveImplies(a, b)`** — material implication: `OR(NOT a, b)`
- **`subjectiveIff(a, b)`** — biconditional: `AND(IMPLIES(a, b), IMPLIES(b, a))`

### Utilities

- **`toOpinion(value: boolean | null, baseRate?: number)`** — maps Kleene values to corner opinions
- **`isValidOpinion(o)`** — checks non-negative, sums to 1 within floating-point tolerance (`1e-9`)
- **`projectProbability(o)`** — `o.belief + o.baseRate * o.uncertainty`

## Section 2: Assignment and input format

`TCoreVariableAssignment` changes from `Record<string, TCoreTrivalentValue>` to `Record<string, TOpinion | boolean | null>`. `TCoreExpressionAssignment.variables` uses this updated type. The evaluator normalizes all values to `TOpinion` via `toOpinion()` at the start of evaluation.

`rejectedExpressionIds` unchanged — rejection forces `OPINION_FALSE`, skips children.

`checkValidity()` unchanged — generates boolean assignments via bitmask, normalized to corner opinions internally.

## Section 3: Evaluation return types

### TCorePremiseEvaluationResult

Fields that change from `TCoreTrivalentValue` to `TOpinion`:

- `rootValue`
- `expressionValues` (values in the record)
- `variableValues` (values in the record)

### TCorePremiseInferenceDiagnostic

All `TCoreTrivalentValue` fields become `TOpinion`:

- `implies` variant: `leftValue`, `rightValue`, `rootValue`, `antecedentTrue`, `consequentTrue`, `isVacuouslyTrue`, `fired`, `firedAndHeld`
- `iff` variant: `leftValue`, `rightValue`, `rootValue`, `bothSidesTrue`, `bothSidesFalse`, plus all fields in `leftToRight`/`rightToLeft` `TCoreDirectionalVacuity` (including `implicationValue`)

### TCoreArgumentEvaluationResult

**Removed fields:**

- `isAdmissibleAssignment`
- `allSupportingPremisesTrue`
- `conclusionTrue`
- `isCounterexample`
- `preservesTruthUnderAssignment`

**Retained fields:**

- `ok`, `validation`, `assignment`, `referencedVariableIds`
- `conclusion`, `supportingPremises`, `constraintPremises`

### TCoreCounterexample and TCoreValidityCheckResult

Unchanged. The `result` field inside `TCoreCounterexample` naturally contains opinion-valued premise results. Counterexample detection in `checkValidity()` uses corner opinion equality instead of the removed `isCounterexample` flag.

## Section 4: Evaluator implementation

### PremiseEngine.evaluate()

- Replace `kleene*` calls with `subjective*` calls in the operator switch
- Variable lookup: normalize through `toOpinion()` before returning
- Rejected expressions: return `OPINION_FALSE`
- Resolver callback signature: `(variableId: string) => TOpinion`
- `expressionValues` accumulator: `Record<string, TOpinion>`
- N-ary reduce initial values: `OPINION_TRUE` for AND, `OPINION_FALSE` for OR

### Inference diagnostics

Same structure, subjective operators. `isVacuouslyTrue = subjectiveNot(leftValue)`, `firedAndHeld = subjectiveAnd(leftValue, rightValue)`, etc.

### ArgumentEngine.evaluate()

- Resolver cache: `Map<string, TOpinion>`
- Remove aggregate flag computation
- Return per-premise results, assignment, and referencedVariableIds only

### ArgumentEngine.evaluate() — resolver detail

The resolver's fallback path for non-premise-bound variables (`assignment.variables[variableId] ?? null`) must normalize through `toOpinion()` before returning, consistent with the `TOpinion` return type.

### ArgumentEngine.checkValidity()

- No changes to enumeration logic
- Counterexample detection: instead of checking `result.isCounterexample === true`, recompute inline — conclusion `rootValue` has `belief === 0 && disbelief === 1` and all supporting/constraint premise `rootValue`s have `belief === 1 && disbelief === 0`. Uses strict `===` comparison (justified because boolean corner inputs produce exact corner outputs with no floating-point drift through the operator chain).
- Admissible assignment counting: instead of reading `result.isAdmissibleAssignment`, recompute inline by checking all constraint premise `rootValue`s equal `OPINION_TRUE` via strict `===`.

### Inference diagnostics helpers

`buildDirectionalVacuity()` and `implicationValue()` in `validation.ts` must be updated to use `subjective*` operators and accept/return `TOpinion` instead of `TCoreTrivalentValue`.

### kleene.ts and TCoreTrivalentValue

Both retained — may be referenced by consumers, can be deprecated later. `TCoreTrivalentValue` remains valid as an input type (accepted by `toOpinion()`).

## Section 5: Schema and validation

### TOpinion schema

Typebox object schema with four number fields, each constrained to `[0, 1]`. `baseRate` defaults to `0.5`.

### Runtime validation

`isValidOpinion()` checks:

- All four fields are numbers
- `belief`, `disbelief`, `uncertainty` are each in `[0, 1]`
- `baseRate` is in `[0, 1]`
- `belief + disbelief + uncertainty ≈ 1` within tolerance `1e-9`

Validation runs at the entry point of `evaluate()` on all opinion values in the assignment, throwing on invalid input.

### CLI

CLI `evaluate` command will need to accept opinion tuples for input. The CLI `analysis evaluate` output currently prints the removed aggregate flags (`isAdmissibleAssignment`, `allSupportingPremisesTrue`, `conclusionTrue`, `isCounterexample`) — this output must be redesigned to display per-premise opinion results instead. Both are CLI-layer concerns deferred to the implementation plan.

## Section 6: Testing strategy

### Operator unit tests

- Corner cases reproducing Kleene results (backward compatibility proof)
- Interior opinions with hand-computed expected values
- `b + d + u = 1` invariant on all outputs
- Edge cases: full uncertainty, near-zero components

### Evaluation integration tests

- Existing `evaluate()` tests updated: assertions compare against corner opinions instead of `TCoreTrivalentValue`
- Existing `checkValidity()` tests pass unchanged

### New opinion-specific tests

- Evaluate expression trees with interior opinions
- Verify propagation through operators, formulas, premise-bound variable resolution
- Invalid opinion rejection

### Utility tests

- `projectProbability` at corners and interior points
- `toOpinion` conversion
- `isValidOpinion` acceptance and rejection
