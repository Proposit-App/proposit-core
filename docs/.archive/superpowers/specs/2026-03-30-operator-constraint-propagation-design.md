# Operator Constraint Propagation Design

**Date:** 2026-03-30
**Status:** Approved

## Problem

The current evaluator uses Kleene three-valued logic to evaluate expressions bottom-up from variable assignments. Operators can be "rejected" (forced false), but there is no mechanism to assert that an operator relationship is true and propagate that constraint to derive unknown variable values.

Accepting or rejecting an operator expresses a judgment about whether the logical relationship is sound — not about the truth values of the components. For example, "Earth is round → sky is blue" has both true components and formally evaluates to true, but the implication relationship is nonsense.

Without propagation, operator acceptance is meaningless — the evaluator can't show what accepted relationships entail. Propagation is the mechanism that makes acceptance meaningful: "I accept A → B, I know A is true, therefore B must be true" (modus ponens).

## Schema Changes

### `TCoreExpressionAssignment` (engine type)

```typescript
// Before
interface TCoreExpressionAssignment {
    variables: Record<string, boolean | null>
    rejectedExpressionIds: string[]
}

// After
interface TCoreExpressionAssignment {
    variables: Record<string, boolean | null>
    operatorAssignments: Record<string, "accepted" | "rejected">
}
```

### `TCoreAnalysisFile` (CLI schema)

Same change — `rejectedExpressionIds` removed, `operatorAssignments` added. No migration path; hard switch.

### Operator states

- **Accepted:** The user asserts this relationship holds. Propagation pushes constraints downward to fill unknown variables.
- **Rejected:** The user asserts this relationship does not hold. The expression evaluates to false; children are not evaluated (existing behavior).
- **Unset (not in map):** Normal Kleene evaluation from children.

## Propagation Algorithm

Runs unconditionally inside `ArgumentEngine.evaluate()` as a preprocessing step before Kleene evaluation. No opt-in flag.

### Steps

1. Start with the user's variable assignments. Explicit values (true/false) are ground truth and are never overwritten.
2. For each accepted operator across all premises, push constraints downward based on the operator type and known child values:
    - `A → B` (accepted = true): if A = true → set B = true. If B = false → set A = false.
    - `A ∧ B` (accepted = true): set both A and B to true.
    - `A ∨ B` (accepted = true): if A = false → set B = true. If B = false → set A = true. Both unknown → no action.
    - `¬A` (accepted = true): set A to false.
    - `A ↔ B` (accepted = true): if A = true → set B = true. If A = false → set B = false. Vice versa.
3. "Set" means: if the variable is currently unknown (null), assign the derived value. If it already has a value (user-assigned or previously propagated), leave it unchanged.
4. Repeat steps 2–3 until no new values are derived (fixed point).
5. Feed the enriched assignment into the existing Kleene evaluator.

### Nested operators

When propagation resolves a child that is itself an operator (not a variable leaf), it resolves the operator's computed value but does not force-accept it. Constraints only flow through operators the user has explicitly accepted.

### Rejected operators

Rejected operators force to false. No downward propagation — children are irrelevant since the relationship is rejected.

### Contradictions

If the user's explicit variable assignments contradict an accepted operator (e.g., `A ∧ B` accepted but A = false), propagation does not override the user's choice. The contradiction surfaces naturally during Kleene evaluation: the accepted operator will evaluate to false in the results. No special diagnostic is needed.

## Engine API Changes

### `ArgumentEngine.evaluate()`

Propagation runs unconditionally — no new option. The existing `TCoreArgumentEvaluationResult.assignment` field reflects the post-propagation state, so callers can compare against the original to see which values were derived.

### `ArgumentEngine.checkValidity()`

Unchanged. Pure truth-table evaluation, ignores `operatorAssignments` entirely. Validity checking answers "is this argument form valid?" independent of any operator acceptance judgments.

## CLI Changes

### Removed commands

- `analysis reject <expression_id>`
- `analysis accept <expression_id>`
- `analysis reject-all`
- `analysis accept-all`

### New commands

- **`analysis set-operator <operator_expression_id> <accepted|rejected|unset>`** — sets or clears a single operator's state. Supports `--file` like other analysis commands.
- **`analysis set-all-operators <accepted|rejected|unset>`** — mass-sets all operator expressions across all premises. Supports `--file`.

### Modified commands

- **`analysis create`** — initializes `operatorAssignments: {}` instead of `rejectedExpressionIds: []`. When no filename argument is provided, auto-generates `analysis-1.json`, `analysis-2.json`, etc. by finding the next available number. The old default of `analysis.json` is removed.
- **`analysis show`** — displays operator assignments (accepted/rejected) instead of "Rejected operators."
- **`analysis operators`** — gains a column showing the current acceptance state from the analysis file (via `--file` option).
- **`analysis evaluate`** — no changes needed; the engine handles propagation internally. Passes `operatorAssignments` instead of `rejectedExpressionIds`.

### Unchanged commands

- **`analysis set`** — variable assignments, unchanged.
- **`analysis reset`** — variable reset, unchanged.
- **`analysis check-validity`** — pure validity, unchanged.

## Migration

No migration path. Hard switch to new schema. Existing analysis files on disk will be manually migrated after implementation.
