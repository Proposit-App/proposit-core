# Premise-Variable Associations — Design Spec

**Date:** 2026-03-15
**Status:** Approved

## Problem

The root-only operator restriction means `implies` and `iff` cannot be nested. To express "P implies that A implies B" as a single argument, you need two premises:

- Premise 1: `A implies B`
- Premise 2: `P implies Q`

Where Q "stands for" Premise 1's content. Currently, Q references a claim in ClaimLibrary, but there is no structural link between Q and the expression tree of Premise 1. The claim is just metadata — it doesn't say "Q is this specific premise."

## Solution

A **premise-variable binding** that binds a variable to a premise within the same argument. The binding is semantically load-bearing: the evaluator treats a premise-bound variable as equivalent to its bound premise's expression tree during evaluation.

## Design Decisions

| Decision                  | Choice                                                      | Rationale                                                                      |
| ------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Binding target            | Premise (not formula/expression)                            | Motivating use case is nested implications, which are whole-premise constructs |
| Semantic equivalence      | Yes                                                         | If the binding doesn't affect evaluation, it's just a label                    |
| Storage                   | Argument-internal                                           | Bindings are argument-scoped and tightly coupled to evaluation                 |
| Variable binding model    | Claim XOR premise (discriminated union)                     | Clean type safety, no ambiguous optional combinations                          |
| Schema future-proofing    | Include `boundArgumentId`/`boundArgumentVersion` fields     | Enables cross-argument references in the future                                |
| Current scope restriction | Same-argument only                                          | `boundArgumentId` must equal variable's `argumentId`                           |
| Circularity prevention    | Enforced at bind time and expression-add time               | Cycles are logical errors, not evaluation edge cases                           |
| Evaluation strategy       | Lazy resolution                                             | Preserves original tree structure, handles recursive bindings naturally        |
| Premise removal cascade   | Deletes bound variables (which cascade through expressions) | Consistent with existing cascade behavior                                      |
| Cardinality               | Many-to-one (multiple variables can bind to one premise)    | No reason to artificially restrict                                             |

## 1. Variable Schema Changes

`TCorePropositionalVariable` becomes a discriminated union of two types:

### Claim-Bound Variable

```typescript
{
    id: UUID
    argumentId: UUID
    argumentVersion: number
    symbol: string
    claimId: UUID // required
    claimVersion: number // required
    checksum: string
}
```

This is the existing variable shape, unchanged.

### Premise-Bound Variable

```typescript
{
    id: UUID
    argumentId: UUID
    argumentVersion: number
    symbol: string
    boundPremiseId: UUID // required
    boundArgumentId: UUID // required
    boundArgumentVersion: number // required
    checksum: string
}
```

The union type: `TCorePropositionalVariable = TClaimBoundVariable | TPremiseBoundVariable`

Runtime discrimination: check for the presence of `claimId` vs `boundPremiseId`. Type guards `isClaimBound(v)` and `isPremiseBound(v)` make downstream code clean.

### TypeBox Schema Approach

Since TypeBox generics (`Generic`/`Parameter`/`Call`) don't work in v1.1.0, define two separate `Type.Object` schemas (`ClaimBoundVariableSchema` and `PremiseBoundVariableSchema`), each with their respective required fields and `additionalProperties: true`. The TypeScript union type is derived from `Type.Static` of each. `CorePropositionalVariableSchema` becomes a `Type.Union` of the two.

### Checksum Fields

`variableFields` in `TCoreChecksumConfig` adds the three new fields: `boundPremiseId`, `boundArgumentId`, `boundArgumentVersion`. For any given variable, only one group is present. The `entityChecksum` function excludes absent fields via its `if (field in entity)` guard, so claim-bound variables produce the same checksums as before (new fields are simply not present on the entity).

### Current Validation Restriction

`boundArgumentId` must equal `variable.argumentId`. Enforced at bind time. This restriction can be relaxed in a future version for cross-argument references.

## 2. API Surface on ArgumentEngine

### New Methods

**`bindVariableToPremise(variable: TPremiseBoundVariableInput): TCoreMutationResult`**

Creates a premise-bound variable. Validates:

- `boundPremiseId` references an existing premise in this argument
- `boundArgumentId === variable.argumentId` (current restriction)
- Symbol uniqueness (same as `addVariable`)
- Circularity: vacuously safe at creation (variable doesn't exist yet), but relevant if rebinding is added later

**`getVariablesBoundToPremise(premiseId: string): TVar[]`**

Returns all variables bound to a given premise. Useful for cascade logic and for callers to understand bindings. Implemented as a linear scan of all variables (filtering by `boundPremiseId`). The variable count per argument is small enough that an index is unnecessary.

### Modified Methods

**`removePremise(premiseId)`**

After removing the premise, scans variables for `boundPremiseId === premiseId` and cascades their removal via `removeVariable` (which in turn cascades through expressions).

**`addExpression` / `appendExpression` / `addExpressionRelative` / `insertExpression`**

All expression mutation methods that accept variable-type expressions check for circularity. If the referenced variable is premise-bound to the premise being modified (directly or transitively), rejects with an error. Since these methods live on `PremiseEngine` (not `ArgumentEngine`), and the transitive check requires cross-premise access, `ArgumentEngine` injects a **circularity-checking callback** into `PremiseEngine` (same pattern as the evaluation resolver callback). The callback accepts a variable ID and premise ID, and returns whether adding that variable to that premise would create a cycle. `PremiseEngine` calls the callback in its expression mutation methods; if no callback is set, only the direct check runs (safe for `PremiseEngine` instances used outside an `ArgumentEngine` context).

**`updateVariable(variableId, updates)`**

Accepts symbol changes for both variable types. Claim-bound variables can also update `claimId`/`claimVersion` (with claim library validation). Premise-bound variables can update `boundPremiseId` (to rebind to a different premise, with circularity validation). Does not accept binding-type conversion (claim-bound to premise-bound or vice versa). To change binding type, delete and recreate the variable. If called with fields from the wrong variant, throws an error.

**Note:** The current `VariableManager.updateVariable` only processes `symbol` updates — other fields are silently ignored. This is a pre-existing bug. As part of this feature, `VariableManager.updateVariable` must be generalized to apply all provided fields (not just `symbol`), since both `claimId`/`claimVersion` and `boundPremiseId` updates need to persist.

**`checkValidity` / `evaluate`**

Assignment generation filters out premise-bound variables — only claim-bound variable IDs are included in the truth table column set. The current code collects variable IDs by scanning variable-type expressions; this must add a filtering step that looks up each collected variable ID in `VariableManager` and excludes premise-bound variables. `referencedVariableIds` in evaluation results includes only claim-bound variables (premise-bound variables are computed, not assigned by callers).

### Unchanged Methods

**`removeVariable(variableId)`** — Works the same for both claim-bound and premise-bound variables. Removes the variable and cascades through expressions.

**`addVariable(variable)`** — Continues to accept claim-bound variables only. Premise-bound variables are created via `bindVariableToPremise`. Since `TVar` is now a union type, `addVariable` must use a type guard (`isClaimBound`) to confirm the variable is claim-bound before accessing `claimId`/`claimVersion` for claim library validation. Throws if a premise-bound variable is passed.

### Snapshot Restoration

`fromSnapshot` and `fromData` must handle both variable types during restoration. When iterating variables from a snapshot, check the variant: call `addVariable` for claim-bound variables and `bindVariableToPremise` for premise-bound variables. Premise-bound variables must be restored after the premises they reference, so restoration order is: argument → premises (with expressions) → claim-bound variables → premise-bound variables. This is a change from the current restoration order (which restores variables before premises); claim-bound variables have no dependency on premise ordering, so moving them after premises is safe. Snapshot JSON round-tripping preserves discriminant fields (`claimId` vs `boundPremiseId`) naturally since both schema variants use `additionalProperties: true`.

`rollback` requires no changes. It uses `VariableManager.fromSnapshot()` which directly reconstructs the variable store from raw data without validation. Since `VariableManager` stores `TVar` generically without inspecting binding fields, both variants are restored transparently.

### Internal Components

**`VariableManager`** — No changes needed. It is a generic registry that stores `TVar` without inspecting binding-specific fields. All binding validation happens in `ArgumentEngine`.

**`TPremiseBoundVariableInput`** — Defined as `TOptionalChecksum<TPremiseBoundVariable>`, consistent with the existing `addVariable` pattern which accepts `TOptionalChecksum<TVar>`.

## 3. Circularity Prevention

Cycles are forbidden. Two enforcement points:

### At Bind Time

Before creating a premise-bound variable, verify that the target premise's expression tree does not reference the variable being created. Vacuously safe at creation (variable doesn't exist yet), but meaningful if rebinding is added later.

### At Expression-Add Time

When adding a variable-expression to a premise, check whether the referenced variable is bound to that premise (directly or transitively).

**Direct check:** `variable.boundPremiseId === expression.premiseId` → reject.

**Transitive check:** Walk the binding chain. When adding variable-expression for Q to Premise X:

1. If Q is premise-bound, find Q's target premise
2. Collect all variable-expressions in that target premise's tree
3. For each such variable, if it is premise-bound to Premise X, reject
4. Recursively check each such variable's binding chain

The acyclicity invariant (enforced incrementally) guarantees this walk terminates. Cost is proportional to binding chain depth, which is very shallow in practice (1-2 levels). As a safety net, the implementation should include a depth limit equal to the number of premises in the argument and throw if exceeded.

## 4. Evaluation Changes

### Evaluation Architecture

Currently, `PremiseEngine.evaluate` is self-contained — it evaluates its own expression tree using the assignment map. It has no reference to other premises. To support premise-bound variable resolution, `ArgumentEngine.evaluate` passes a **resolver callback** into each `PremiseEngine.evaluate` call. The resolver accepts a variable ID and the current assignment, and returns the resolved truth value by evaluating the bound premise's expression tree. This keeps `PremiseEngine` decoupled from `ArgumentEngine` while enabling cross-premise resolution.

### Variable Resolution

When the evaluator encounters a variable-expression:

1. Check if the variable is claim-bound or premise-bound
2. If **claim-bound**: look up truth value from the current assignment (existing behavior)
3. If **premise-bound**: call the resolver callback, which evaluates the target premise's expression tree under the current assignment and returns the result (lazy resolution)

### Assignment Generation

Only **claim-bound variables** get truth table columns. Premise-bound variables are computed, not assigned. Total assignments = `2^n` where `n` = count of claim-bound variables.

### Recursive Resolution

If a bound premise's tree contains another premise-bound variable, the evaluator naturally recurses. The acyclicity guarantee ensures termination.

### Caching

A premise-bound variable produces the same value for a given assignment regardless of where it appears. The resolver callback maintains a `Map<string, boolean | null>` cache keyed by variable ID, scoped to a single `ArgumentEngine.evaluate` invocation (one cache per `(assignment, rejectedExpressionIds)` pair). When the resolver is asked to resolve a variable it has already computed, it returns the cached value. The cache is created fresh for each `evaluate` call.

### Validation

`validateEvaluability` should flag premise-bound variables whose target premise has no root expression (empty tree) as a warning. Evaluation of such variables returns `null`/unknown, which is valid under Kleene logic but may indicate an incomplete argument.

## 5. Snapshot and Diff Impact

### Snapshots

No structural changes. `TVariableManagerSnapshot<TVar>` already serializes all variables. Premise-bound variables are captured naturally via their fields. `fromSnapshot` restores them; binding relationships are implicit in the variable data.

### Diff

Variable diffs compare variable entities through the existing variable comparator. The new fields (`boundPremiseId`, `boundArgumentId`, `boundArgumentVersion`) participate in diffing. `defaultCompareVariable` updated to handle both variants. It uses the `isClaimBound`/`isPremiseBound` type guards on both `before` and `after` to determine variants. If both are the same variant, it compares variant-specific fields normally. If variants differ (claim-bound → premise-bound or vice versa), it reports changes on all binding fields from both variants (treating absent fields as `undefined` for comparison purposes).

### Changesets

No changes. Variable mutations appear in `variables.added`/`variables.updated`/`variables.removed`. Premise-bound variables flow through the same paths.

### Reactive Snapshots

Variable changes are already tracked. The `onMutate` callback fires for premise-bound variable creation and cascade deletions.

## 6. Cascade Behavior

### `removePremise(premiseId)`

1. Remove the premise and its expressions (existing behavior)
2. Scan variables for `boundPremiseId === premiseId`
3. For each bound variable found, call `removeVariable`
4. `removeVariable` cascades: deletes all variable-expressions referencing it across all premises, with operator collapse

### `removeVariable(variableId)`

No change. Works identically for claim-bound and premise-bound variables.

### Cascade Ordering

Premise removal → variable removal → expression removal. Each step can trigger operator collapse. Same pattern as existing `removeVariable` cascade, with an additional entry point from `removePremise`.

### No Cascade on Library Changes

Removing a claim from `ClaimLibrary` does not cascade into variables (claims are versioned and frozen, not deleted). Unchanged.

## 7. CLI Impact

**`variables create`** — Unchanged. Creates claim-bound variables.

**`variables bind`** (new) — Creates a premise-bound variable bound to a specified premise. Accepts `--symbol` and `--premiseId`; infers `boundArgumentId`/`boundArgumentVersion` from current argument context.

**`variables list`** — Updated to display binding type. Claim-bound variables show claim reference; premise-bound variables show bound premise ID.

**`variables delete`** — Unchanged. Handles both types via existing `removeVariable` cascade.

## 8. Documentation Updates

The CLAUDE.md design rule "Variables require claim references" must be updated to reflect the claim-XOR-premise binding model. Other documentation sync targets (per CLAUDE.md's Documentation Sync section) should be updated as appropriate when public API signatures change.
