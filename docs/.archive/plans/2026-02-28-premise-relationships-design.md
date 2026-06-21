# Premise Relationship Analysis — Design

## Purpose

Determine how other premises relate to a given (focused) premise within an argument. The primary use case is bucketing all premises relative to the conclusion premise into five categories: supporting, contradicting, restricting, downstream, or unrelated.

## Categories

| Category      | Definition                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supporting    | The premise's inferred consequent feeds (directly or transitively) into the focused premise's antecedent, helping it fire                                                                                                     |
| Contradicting | The premise infers values that negate the focused premise's antecedent (blocking it) or consequent (conflicting with it)                                                                                                      |
| Restricting   | Constrains shared variables without being clear support or contradiction. Includes constraint premises (no inference operator) and inference premises where a variable appears in both the source's antecedent and consequent |
| Downstream    | Shares variables but inference flows away from the focused premise (takes its consequent as input)                                                                                                                            |
| Unrelated     | No variable overlap, even transitively through other premises                                                                                                                                                                 |

## Algorithm

### Step 1: Variable Profiling

For each inference premise, split the root expression into antecedent (left child) and consequent (right child). Both `implies` and `iff` roots use the same left=antecedent, right=consequent split.

Walk each subtree and extract every variable's **side** (`antecedent` or `consequent`) and **polarity** (`positive` or `negative`), determined by negation depth mod 2:

- `not`: increments negation depth (flips polarity)
- `and`, `or`, `formula`: no effect on polarity
- No nested `implies`/`iff` (root-only rule)

Example: `not(not(A) and B) implies C`

- Antecedent: A has depth 2 (positive), B has depth 1 (negative)
- Consequent: C has depth 0 (positive)

Constraint premises (no inference root) have no antecedent/consequent split. All their variables are in a "constraint" category.

### Step 2: Graph Construction

For every pair of premises (A, B), if any variable in A's consequent also appears in B's antecedent, add a directed edge A -> B. Each edge carries polarity compatibility: matching polarities = supporting edge, mismatched = contradicting edge.

### Step 3: Transitive Reachability

BFS/DFS from each premise toward the focused premise. Track accumulated polarity through the path via XOR — two contradicting edges cancel out (double negation = supporting), one contradicting edge in a chain makes the whole path contradicting.

### Step 4: Classification

For premise X relative to focused premise Y:

1. Path X -> ... -> Y with matching accumulated polarity: **supporting**
2. Path X -> ... -> Y with mismatched accumulated polarity: **contradicting**
3. Path Y -> ... -> X (reverse direction): **downstream**
4. X has a variable in both its own ante and conseq, and that variable appears in Y: **restricting**
5. X is a constraint premise sharing variables with Y: **restricting**
6. No path in either direction, no shared variables transitively: **unrelated**

### Precedence Rule

When a premise has multiple signals through different variables: **contradicting > restricting > supporting**. Downstream and unrelated are only assigned when no other signal exists.

## Types

```typescript
type TPremiseRelationshipType =
    | "supporting"
    | "contradicting"
    | "restricting"
    | "downstream"
    | "unrelated"

type TVariableRelationship = {
    variableId: string
    relationship: "supporting" | "contradicting" | "restricting"
}

type TPremiseRelationResult = {
    premiseId: string
    relationship: TPremiseRelationshipType
    variableDetails: TVariableRelationship[]
    transitive: boolean
}

type TPremiseRelationshipAnalysis = {
    focusedPremiseId: string
    premises: TPremiseRelationResult[]
}
```

## API

```typescript
function analyzePremiseRelationships(
    engine: ArgumentEngine,
    focusedPremiseId: string
): TPremiseRelationshipAnalysis
```

Standalone function following the `diffArguments` pattern.

## File Locations

- Types: `src/lib/types/relationships.ts`
- Implementation: `src/lib/core/relationships.ts`
- Exports through `src/lib/types/index.ts` and `src/lib/core/index.ts` -> `src/lib/index.ts`

## Edge Cases

| Case                                               | Behavior                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Focused premise doesn't exist                      | Throw error                                                                                |
| Focused premise is a constraint                    | All other premises sharing variables are restricting; no supporting/contradicting possible |
| Empty premise (no root expression)                 | Classified as unrelated                                                                    |
| Variable appears with both polarities on same side | Contributes a restricting signal                                                           |
| Graph cycles                                       | BFS tracks visited nodes to avoid infinite loops                                           |
| Only one premise in argument                       | Return empty premises array                                                                |

## Testing

New `describe` block at the bottom of `test/ExpressionManager.test.ts`:

- Variable profiling: correct side/polarity extraction for implies, iff, negation, constraints
- Direct relationships: supporting, contradicting, restricting, downstream, unrelated
- Transitivity: chains of supporting, mixed polarity chains, double negation cancellation
- Precedence: contradicting > restricting > supporting
- Edge cases: empty premise, constraint-focused premise, cycles, single premise
