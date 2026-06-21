# Lookup API Design

**Date:** 2026-03-06
**Status:** Approved

## Problem

The frontend needs O(1) lookups for variables and expressions by ID, but `ArgumentEngine` only exposes array-returning methods (`getVariables()`, per-premise `getExpressions()`). Cross-premise expression lookup requires knowing which premise an expression belongs to. Several additional lookups (variable by symbol, expressions by variable ID) are also needed.

## Design

### Internal plumbing

**VariableManager — symbol reverse lookup:**

Change `variableSymbols: Set<string>` to `variablesBySymbol: Map<string, string>` (symbol → variableId). Add `getVariableBySymbol(symbol): TVar | undefined`. All existing mutation methods (`addVariable`, `removeVariable`, `renameVariable`) already maintain the symbol set — they update the map instead.

**Shared expression index (Approach A — shared mutable reference):**

`ArgumentEngine` creates a `Map<string, string>` (expressionId → premiseId) at construction time. Passes it to each `PremiseEngine` via the `deps` parameter (alongside `argument` and `variables`). `PremiseEngine` updates the shared map in its mutation wrappers (`addExpression`, `appendExpression`, `addExpressionRelative`, `insertExpression`, `removeExpression`, `updateExpression`, `deleteExpressionsUsingVariable`).

Maintenance uses the changeset each method already produces — after each mutation, iterate `changes.expressions.added` to insert entries and `changes.expressions.removed` to delete entries. `fromSnapshot()`, `fromData()`, and `rollback()` build/rebuild the index during construction.

### New public methods on ArgumentEngine

**Variable lookups:**

| Method                        | Return type         | Complexity | Notes                                                                                      |
| ----------------------------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `getVariable(id)`             | `TVar \| undefined` | O(1)       | Delegates to VariableManager                                                               |
| `hasVariable(id)`             | `boolean`           | O(1)       | Delegates to VariableManager                                                               |
| `getVariableBySymbol(symbol)` | `TVar \| undefined` | O(1)       | Uses new symbol→id map                                                                     |
| `buildVariableIndex(keyFn)`   | `Map<K, TVar>`      | O(n)       | Generic helper for extension-field lookups (e.g. statementId). Consumer caches the result. |

**Expression lookups:**

| Method                                   | Return type                  | Complexity | Notes                                                                                       |
| ---------------------------------------- | ---------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `getExpression(id)`                      | `TExpr \| undefined`         | O(1)       | Uses shared index to find premise, then delegates                                           |
| `hasExpression(id)`                      | `boolean`                    | O(1)       | Checks shared index                                                                         |
| `getExpressionPremiseId(id)`             | `string \| undefined`        | O(1)       | Direct read from shared index                                                               |
| `findPremiseByExpressionId(id)`          | `PremiseEngine \| undefined` | O(1)       | Index → premise map                                                                         |
| `getAllExpressions()`                    | `TExpr[]`                    | O(total)   | Aggregates across all premises                                                              |
| `getExpressionsByVariableId(variableId)` | `TExpr[]`                    | O(p)       | Iterates premises, uses each premise's existing per-premise `expressionsByVariableId` index |

**Structure lookups:**

| Method                  | Return type | Complexity | Notes                                            |
| ----------------------- | ----------- | ---------- | ------------------------------------------------ |
| `listRootExpressions()` | `TExpr[]`   | O(p)       | Collects `getRootExpression()` from each premise |
