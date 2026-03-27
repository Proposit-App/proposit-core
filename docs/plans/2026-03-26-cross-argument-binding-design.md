# Cross-Argument Variable Binding — Design Spec

**Date:** 2026-03-26
**Status:** Draft
**Scope:** Spec 2 of 2 (cross-argument binding; forking is spec 1)

## Problem

Arguments don't exist in isolation. A responder may want to reference a specific premise or the conclusion of another argument as a propositional variable in their own expression trees. Currently, premise-bound variables are restricted to the same argument (`boundArgumentId` must equal the engine's own `argumentId`). There is no mechanism for cross-argument references.

Additionally, every premise should be automatically referenceable as a variable by other premises in the same argument — currently this requires manual variable creation.

## Solution

1. A new `bindVariableToExternalPremise` method for creating variables that reference premises in other arguments, with evaluator-assigned (not lazily resolved) evaluation semantics.
2. A `bindVariableToArgument` convenience method for referencing another argument's conclusion.
3. Automatic premise-bound variable creation whenever a premise is added to an argument.

## Design Decisions

| Decision                | Choice                                                                 | Rationale                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Schema approach         | Reuse existing `TPremiseBoundVariable` — no new variant                | Internal vs external determined at runtime by comparing `boundArgumentId` to engine's `argumentId`                  |
| Internal binding method | `bindVariableToPremise` unchanged                                      | Preserves existing API, lazy evaluation, circularity detection                                                      |
| External binding method | New `bindVariableToExternalPremise`                                    | Different validation (no local premise check, calls `canBind`), different evaluation semantics (evaluator-assigned) |
| Argument-level binding  | `bindVariableToArgument(variable, conclusionPremiseId)` convenience    | Caller resolves conclusion; method sets `boundPremiseId` and delegates to `bindVariableToExternalPremise`           |
| Validation              | `canBind(boundArgumentId, boundArgumentVersion)` protected overridable | Core library agnostic about publish semantics; subclasses inject policy                                             |
| Default validation      | `() => true`                                                           | No restrictions at library level                                                                                    |
| External evaluation     | Evaluator-assigned (like claims)                                       | Binding is navigational, not computational; no cross-argument resolution chains                                     |
| Truth table             | External bindings included as free variables                           | They need assignments like claims do                                                                                |
| Auto-variable creation  | Always on in `createPremise` / `createPremiseWithId`                   | Every premise is automatically referenceable as a variable                                                          |
| Auto-variable symbol    | Optional parameter; auto-generated if omitted                          | `"P{n}"` with collision avoidance                                                                                   |

## 1. Utility Function

```typescript
function isExternallyBound(
    variable: TPremiseBoundVariable,
    argumentId: string
): boolean {
    return variable.boundArgumentId !== argumentId
}
```

Exported from the schemata module. Used internally by evaluation logic and available to consumers.

## 2. Auto-Variable Creation in `createPremise`

### Signature Changes

```typescript
createPremise(extras?: Record<string, unknown>, symbol?: string)
    → TCoreMutationResult<PremiseEngine, ...>

createPremiseWithId(id: string, extras?: Record<string, unknown>, symbol?: string)
    → TCoreMutationResult<PremiseEngine, ...>
```

### Behavior

When a premise is created:

1. Create the premise (existing logic, including auto-conclusion assignment)
2. Generate a premise-bound variable:
    - `id`: new UUID
    - `argumentId` / `argumentVersion`: matches engine's argument
    - `symbol`: caller-provided, or auto-generated as `"P{n}"` where `n` is the premise count before creation. If `"P{n}"` collides with an existing variable symbol, increment until unique.
    - `boundPremiseId`: the new premise's ID
    - `boundArgumentId`: same as engine's `argumentId` (internal binding)
    - `boundArgumentVersion`: same as engine's `argumentVersion`
3. Register the variable via the existing `bindVariableToPremise` path (checksum, dirty marking, subscribers)
4. Include both premise and variable in the returned changeset

### Restoration

`fromSnapshot` and `fromData` already restore premises first, then variables. Auto-created variables are ordinary premise-bound variables — they restore in the existing flow. Auto-creation only fires in `createPremise`, not during restoration.

### Breaking Change

Existing tests and consumers that assert on `createPremise` changeset contents will see a new `variables` entry. This is intentional — the variable addition is additive, and consumers that only inspect `premises` in the changeset are unaffected. Tests that assert exact changeset shapes will need updating.

## 3. `bindVariableToExternalPremise`

### Signature

```typescript
public bindVariableToExternalPremise(
    variable: TOptionalChecksum<TPremiseBoundVariable> & Record<string, unknown>
): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
```

### Behavior

1. Validate `argumentId` / `argumentVersion` match the engine's argument (the variable belongs to this engine)
2. Validate `boundArgumentId !== this.argumentId` — must be external (use `bindVariableToPremise` for internal)
3. Call `this.canBind(variable.boundArgumentId, variable.boundArgumentVersion)` — throw if `false`
4. Attach checksum via `attachVariableChecksum()`
5. Register variable via `this.variables.addVariable()`
6. Do NOT wire lazy evaluation or circularity detection
7. Mark dirty, notify subscribers, return mutation result with changeset

## 4. `bindVariableToArgument`

### Signature

```typescript
public bindVariableToArgument(
    variable: Omit<TOptionalChecksum<TPremiseBoundVariable>, 'boundPremiseId'> & Record<string, unknown>,
    conclusionPremiseId: string
): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
```

### Behavior

1. Merge `boundPremiseId: conclusionPremiseId` into the variable
2. Delegate to `bindVariableToExternalPremise`

Thin wrapper. The caller resolves the conclusion premise ID from their knowledge of the target argument. The engine doesn't look up external arguments.

## 5. `canBind` Method

```typescript
// On ArgumentEngine — protected, overridable by subclasses
protected canBind(
    boundArgumentId: string,
    boundArgumentVersion: number
): boolean {
    return true
}
```

Called by `bindVariableToExternalPremise` before registration. Throws if `false`. The CLI subclass would override to check that the target argument version is published.

## 6. Evaluation Changes

### Resolver Logic

Current behavior treats all premise-bound variables as lazily resolved. New behavior adds an internal/external check:

```typescript
if (
    variable &&
    isPremiseBound(variable) &&
    variable.boundArgumentId === this.argument.id
) {
    // Internal: lazy resolution (existing behavior)
    value = options.resolver(expression.variableId)
} else {
    // Claim-bound OR external premise-bound: evaluator-assigned
    value = assignment.variables[expression.variableId] ?? null
}
```

### Truth-Table Generation

External premise-bound variables are included in truth-table columns as free variables (like claims):

```typescript
const referencedVariableIds = allVariableIds.filter((vid) => {
    const v = this.variables.getVariable(vid)
    if (v == null) return false
    if (isClaimBound(v)) return true
    if (isPremiseBound(v) && v.boundArgumentId !== this.argument.id) return true
    return false
})
```

## 7. Testing Strategy

New `describe` block: **`cross-argument variable binding`**

1. **Auto-variable creation** — `createPremise` changeset includes a premise-bound variable. The variable is bound to the new premise with an auto-generated symbol.
2. **Auto-variable with custom symbol** — `createPremise(undefined, "MyPremise")` produces a variable with the specified symbol.
3. **Auto-variable symbol collision** — Two premises without explicit symbols get unique auto-generated symbols.
4. **`bindVariableToExternalPremise` basic** — Bind a variable in engine B to a premise in engine A. Verify registration and correct `boundArgumentId` / `boundPremiseId`.
5. **`bindVariableToExternalPremise` rejects internal binding** — Passing `boundArgumentId === this.argumentId` throws.
6. **`canBind` rejection** — Subclass overrides `canBind` to return `false`. Verify `bindVariableToExternalPremise` throws.
7. **`bindVariableToArgument` convenience** — Verify `boundPremiseId` is set to the provided `conclusionPremiseId`.
8. **Evaluation: internal binding still lazily resolved** — Existing premise-bound evaluation behavior unchanged.
9. **Evaluation: external binding is evaluator-assigned** — External-bound variable reads from the assignment, not resolved from any premise.
10. **Truth table: external binding included in columns** — `checkValidity` generates assignments for external-bound variables.
11. **`fromSnapshot` restoration** — Snapshot an engine with both internal and external bound variables. Restore and verify both types work correctly.

## 8. Scope and Boundaries

### In scope

- `isExternallyBound(variable, argumentId)` utility function
- Auto-variable creation in `createPremise` / `createPremiseWithId` with optional `symbol` parameter
- `bindVariableToExternalPremise` public method on ArgumentEngine
- `bindVariableToArgument` public convenience method on ArgumentEngine
- `canBind(boundArgumentId, boundArgumentVersion)` protected overridable method
- Evaluation changes: external bindings evaluator-assigned, included in truth-table columns
- `fromSnapshot` / `fromData` restoration support for external bindings
- Tests for all of the above

### Out of scope — application level

- CLI commands for external binding
- Published-version enforcement (provided by subclass override of `canBind`)
- Saved evaluation auto-assignment UX
- Cross-argument cycle detection (external bindings are evaluator-assigned — no resolution chains)
