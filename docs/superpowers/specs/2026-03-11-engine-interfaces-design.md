# Engine Interfaces Design

**Date:** 2026-03-11
**Status:** Approved
**Goal:** Extract typed interfaces from `ArgumentEngine` and `PremiseEngine` to improve API discoverability and enable downstream extensibility.

## Problem

`ArgumentEngine` (1,472 lines, 40 public methods) and `PremiseEngine` (1,322 lines, 30 public methods) expose large public surfaces with no formal grouping. A reader must scroll through the full implementation to understand the API. Downstream code that wants to accept "anything that evaluates" or "anything that manages variables" has no contract to program against.

## Solution

Extract interfaces grouped by capability. Each class gets an `implements` clause listing all its interfaces. Interfaces live in a dedicated `interfaces/` directory so consumers can import just the contract.

## File Structure

```
src/lib/core/interfaces/
├── index.ts                        # barrel export
├── argument-engine.interfaces.ts   # ArgumentEngine interfaces
├── premise-engine.interfaces.ts    # PremiseEngine interfaces
└── shared.interfaces.ts            # interfaces both engines implement
```

All interfaces are re-exported from `src/lib/index.ts`.

## Naming Conventions

- `I` prefix for all interfaces (parallel to `T` prefix for types)
- Names describe the capability, not the implementor
- PascalCase after the `I` prefix

## Shared Interfaces (`shared.interfaces.ts`)

Implemented by both `ArgumentEngine` and `PremiseEngine`.

### `IEvaluation<TArg, TPremise, TExpr, TVar>`

- `validateEvaluability()`
- `evaluate(assignment)`

### `IDisplayable`

- `toDisplayString()`

### `IChecksummable`

- `checksum()`

## ArgumentEngine Interfaces (`argument-engine.interfaces.ts`)

### `IPremiseCrud<TArg, TPremise, TExpr, TVar>`

- `createPremise(extras?)`
- `createPremiseWithId(id, extras?)`
- `removePremise(premiseId)`
- `getPremise(premiseId)`
- `hasPremise(premiseId)`
- `listPremiseIds()`
- `listPremises()`
- `findPremiseByExpressionId(expressionId)`

### `IVariableManagement<TVar>`

- `addVariable(symbol, extras?)`
- `updateVariable(variableId, updates)`
- `removeVariable(variableId)`
- `getVariable(variableId)`
- `hasVariable(variableId)`
- `getVariableBySymbol(symbol)`
- `getVariables()`
- `buildVariableIndex()`

### `IArgumentExpressionQueries<TExpr>`

Cross-premise expression lookups.

- `getExpression(expressionId)`
- `hasExpression(expressionId)`
- `getExpressionPremiseId(expressionId)`
- `getAllExpressions()`
- `getExpressionsByVariableId(variableId)`
- `listRootExpressions()`

### `IArgumentRoleState<TArg, TPremise, TExpr, TVar>`

- `getConclusionPremise()`
- `listSupportingPremises()`
- `setConclusionPremise(premiseId)`
- `clearConclusionPremise()`
- `getRoleState()`
- `checkValidity(assignment)`

### `IArgumentLifecycle<TArg, TPremise, TExpr, TVar>`

- `subscribe(listener)`
- `getSnapshot()`
- `snapshot()`
- `fromSnapshot(snapshot)`
- `fromData(data)`
- `rollback()`

### `IArgumentIdentity<TArg>`

- `getArgument()`
- `collectReferencedVariables()`

## PremiseEngine Interfaces (`premise-engine.interfaces.ts`)

### `IExpressionMutations<TExpr>`

Single-premise expression writes.

- `addExpression(input)`
- `appendExpression(input)`
- `addExpressionRelative(anchorId, position, input)`
- `updateExpression(expressionId, update)`
- `removeExpression(expressionId)`
- `insertExpression(targetId, input)`
- `wrapExpression(targetId, input)`

### `IExpressionQueries<TExpr>`

Single-premise expression reads.

- `getExpression(expressionId)`
- `getRootExpressionId()`
- `getRootExpression()`
- `getExpressions()`
- `getChildExpressions(parentId)`

### `IVariableReferences<TVar>`

- `getVariables()`
- `getReferencedVariableIds()`
- `deleteExpressionsUsingVariable(variableId)`

### `IPremiseClassification`

- `isInference()`
- `isConstraint()`

### `IPremiseLifecycle<TArg, TPremise, TExpr, TVar>`

- `snapshot()`
- `fromSnapshot(snapshot)`
- `setOnMutate(callback)`
- `markDirty()`

### `IPremiseIdentity<TPremise>`

- `getId()`
- `toPremiseData()`
- `getExtras()`
- `setExtras(extras)`

## Implementation Details

### `implements` clauses

```typescript
export class ArgumentEngine<TArg, TPremise, TExpr, TVar>
  implements
    IPremiseCrud<TArg, TPremise, TExpr, TVar>,
    IVariableManagement<TVar>,
    IArgumentExpressionQueries<TExpr>,
    IArgumentRoleState<TArg, TPremise, TExpr, TVar>,
    IArgumentLifecycle<TArg, TPremise, TExpr, TVar>,
    IArgumentIdentity<TArg>,
    IEvaluation<TArg, TPremise, TExpr, TVar>,
    IDisplayable,
    IChecksummable
{ ... }

export class PremiseEngine<TArg, TPremise, TExpr, TVar>
  implements
    IExpressionMutations<TExpr>,
    IExpressionQueries<TExpr>,
    IVariableReferences<TVar>,
    IPremiseClassification,
    IPremiseLifecycle<TArg, TPremise, TExpr, TVar>,
    IPremiseIdentity<TPremise>,
    IEvaluation<TArg, TPremise, TExpr, TVar>,
    IDisplayable,
    IChecksummable
{ ... }
```

### Generic defaults

All interfaces use the same generic defaults as the classes (`TExpr = TCoreExpression`, etc.) so consumers who don't customize can write `IVariableManagement` without type params.

### Expression query separation

ArgumentEngine and PremiseEngine expression queries are kept as separate interfaces (`IArgumentExpressionQueries` vs `IExpressionQueries`) because they operate at different levels of abstraction. ArgumentEngine queries span all premises and return premise context; PremiseEngine queries are scoped to a single premise.

## What Does Not Change

- No method signatures change
- No file splits for the class implementations (separate effort)
- No abstract base classes or mixins
- No runtime impact (interfaces are erased at compile time)
- No behavioral changes
