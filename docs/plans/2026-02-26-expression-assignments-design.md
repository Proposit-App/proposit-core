# Expression Assignments Design

## Problem

The current variable assignment system has two limitations:

1. All variables must be assigned `true` or `false`. There is no way to express uncertainty ("not sure").
2. Users can only assign truth values to variables, not to logical relationships. A user might agree that both A and B are true but reject the claim that A implies B (e.g., "If I live in the US, then the earth is a sphere" -- true statements, nonsense relationship). The system should allow users to accept or reject any operator or formula in the expression tree.

## Design

### Core Types

**Three-valued variable assignments:**

```typescript
type TCoreTrivalentValue = boolean | null

interface TCoreExpressionAssignment {
  // Variable ID -> true/false/null (null = unset/not sure)
  variables: Record<string, TCoreTrivalentValue>
  // Expression IDs the user rejects (forced to false)
  rejectedExpressionIds: string[]
}
```

`TCoreExpressionAssignment` replaces the existing `TCoreVariableAssignment` (`Record<string, boolean>`).

**Semantics:**
- Variables: `true` (believe it), `false` (reject it), `null` (not sure)
- Operators/formulas: absent from `rejectedExpressionIds` means accepted (compute normally from children); present means rejected (evaluates to `false`, children not evaluated)

### Kleene Three-Valued Logic

`null` propagates through operators using Kleene's strong three-valued logic:

| A | B | A AND B | A OR B | NOT A | A -> B | A <-> B |
|---|---|---------|--------|-------|--------|---------|
| T | T | T | T | F | T | T |
| T | F | F | T | F | F | F |
| T | null | null | T | F | null | null |
| F | T | F | T | T | T | F |
| F | F | F | F | T | T | T |
| F | null | F | null | T | T | null |
| null | T | null | T | null | T | null |
| null | F | F | null | null | null | null |
| null | null | null | null | null | null | null |

### Evaluation Logic

**PremiseManager.evaluate():**
- Accepts `TCoreExpressionAssignment` instead of `TCoreVariableAssignment`.
- Variable nodes: look up in `assignment.variables`. If absent, treat as `null`.
- Operator/formula nodes: if ID is in `rejectedExpressionIds`, return `false` (skip children). Otherwise evaluate children with Kleene logic.
- `formula` nodes remain transparent when accepted (propagate child value).
- Missing variables evaluate to `null` instead of throwing. `strictUnknownKeys` still validates extra keys.

**Inference diagnostics:**
Diagnostic fields like `antecedentTrue`, `consequentTrue`, `isVacuouslyTrue`, `fired`, `firedAndHeld` become `TCoreTrivalentValue` to reflect indeterminate states.

**ArgumentEngine.evaluate():**
- Accepts `TCoreExpressionAssignment`.
- Summary flags become three-valued:
  - `isAdmissibleAssignment`: `null` if any constraint evaluates to `null`
  - `allSupportingPremisesTrue`: `null` if any supporting premise evaluates to `null`
  - `conclusionTrue`: three-valued
  - `isCounterexample`: `true` only when admissible, all supports true, conclusion definitively `false`. `null` if indeterminate.

**ArgumentEngine.checkValidity():**
No interface change. Enumerates `true`/`false` for all variables with all operators accepted. Since no `null` inputs exist, results are always definite booleans.

### Storage

Analysis file schema gains a required `rejectedExpressionIds` field:

```typescript
CoreAnalysisFileSchema = Type.Object({
  argumentId: UUID,
  argumentVersion: Type.Number(),
  assignments: Type.Record(
    Type.String(),
    Type.Union([Type.Boolean(), Type.Null()])
  ),
  rejectedExpressionIds: Type.Array(Type.String()),
})
```

No backward compatibility needed (library not in use).

### CLI Changes

- **`analysis create`**: Initializes variables with `null` (unset). Adds empty `rejectedExpressionIds: []`. `--default` accepts `true`, `false`, or `unset`.
- **`analysis set <symbol> <value>`**: Accepts `true`, `false`, or `unset`.
- **`analysis reset`**: `--value` accepts `true`, `false`, or `unset`.
- **`analysis show`**: Displays three-valued assignments and lists rejected expressions.
- **`analysis reject <expression_id>`**: Adds expression to rejected list.
- **`analysis accept <expression_id>`**: Removes expression from rejected list.
- **`analysis evaluate`**: Passes full `TCoreExpressionAssignment` to engine.
- **`analysis validate-assignments`**: Also validates rejected expression IDs exist in expression trees.

### Testing

New `describe` blocks at the bottom of `test/ExpressionManager.test.ts`:

- Kleene three-valued logic: all operator combinations with `null` inputs
- Rejected expression evaluation: operators/formulas return `false`, skip children
- PremiseManager with three-valued assignments
- ArgumentEngine with three-valued summary flags
- checkValidity unchanged behavior
- Edge cases: all unset, all rejected, rejected inference root, rejected formula
