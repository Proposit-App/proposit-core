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

- `T` prefix for all interfaces (same as type aliases, per ESLint `naming-convention` rule)
- Names describe the capability, not the implementor
- PascalCase after the `T` prefix

## Shared Interfaces (`shared.interfaces.ts`)

Implemented by both `ArgumentEngine` and `PremiseEngine`.

### `TDisplayable`

```typescript
interface TDisplayable {
    toDisplayString(): string
}
```

### `TChecksummable`

```typescript
interface TChecksummable {
    checksum(): string
}
```

## ArgumentEngine Interfaces (`argument-engine.interfaces.ts`)

### `TPremiseCrud<TArg, TPremise, TExpr, TVar>`

```typescript
interface TPremiseCrud<TArg, TPremise, TExpr, TVar> {
    createPremise(
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    createPremiseWithId(
        id: string,
        extras?: Record<string, unknown>
    ): TCoreMutationResult<
        PremiseEngine<TArg, TPremise, TExpr, TVar>,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    removePremise(
        premiseId: string
    ): TCoreMutationResult<TPremise | undefined, TExpr, TVar, TPremise, TArg>
    getPremise(
        premiseId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
    hasPremise(premiseId: string): boolean
    listPremiseIds(): string[]
    listPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    findPremiseByExpressionId(
        expressionId: string
    ): PremiseEngine<TArg, TPremise, TExpr, TVar> | undefined
}
```

### `TVariableManagement<TArg, TPremise, TExpr, TVar>`

```typescript
interface TVariableManagement<TArg, TPremise, TExpr, TVar> {
    addVariable(
        variable: TOptionalChecksum<TVar>
    ): TCoreMutationResult<TVar, TExpr, TVar, TPremise, TArg>
    updateVariable(
        variableId: string,
        updates: { symbol?: string }
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    removeVariable(
        variableId: string
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
    getVariable(variableId: string): TVar | undefined
    hasVariable(variableId: string): boolean
    getVariableBySymbol(symbol: string): TVar | undefined
    getVariables(): TVar[]
    buildVariableIndex<K>(keyFn: (v: TVar) => K): Map<K, TVar>
}
```

### `TArgumentExpressionQueries<TExpr>`

Cross-premise expression lookups.

```typescript
interface TArgumentExpressionQueries<TExpr> {
    getExpression(expressionId: string): TExpr | undefined
    hasExpression(expressionId: string): boolean
    getExpressionPremiseId(expressionId: string): string | undefined
    getAllExpressions(): TExpr[]
    getExpressionsByVariableId(variableId: string): TExpr[]
    listRootExpressions(): TExpr[]
    collectReferencedVariables(): {
        variableIds: string[]
        byId: Record<string, { symbol: string; premiseIds: string[] }>
        bySymbol: Record<
            string,
            { variableIds: string[]; premiseIds: string[] }
        >
    }
}
```

### `TArgumentRoleState<TArg, TPremise, TExpr, TVar>`

```typescript
interface TArgumentRoleState<TArg, TPremise, TExpr, TVar> {
    getConclusionPremise():
        | PremiseEngine<TArg, TPremise, TExpr, TVar>
        | undefined
    listSupportingPremises(): PremiseEngine<TArg, TPremise, TExpr, TVar>[]
    setConclusionPremise(
        premiseId: string
    ): TCoreMutationResult<TCoreArgumentRoleState, TExpr, TVar, TPremise, TArg>
    clearConclusionPremise(): TCoreMutationResult<
        TCoreArgumentRoleState,
        TExpr,
        TVar,
        TPremise,
        TArg
    >
    getRoleState(): TCoreArgumentRoleState
}
```

### `TArgumentEvaluation`

```typescript
interface TArgumentEvaluation {
    validateEvaluability(): TCoreValidationResult
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult
    checkValidity(options?: TCoreValidityCheckOptions): TCoreValidityCheckResult
}
```

### `TArgumentLifecycle<TArg, TPremise, TExpr, TVar>`

Static factory methods (`fromSnapshot`, `fromData`) are not included — TypeScript interfaces cannot declare static members.

```typescript
interface TArgumentLifecycle<TArg, TPremise, TExpr, TVar> {
    subscribe(listener: () => void): () => void
    getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
    snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void
}
```

### `TArgumentIdentity<TArg>`

```typescript
interface TArgumentIdentity<TArg> {
    getArgument(): TArg
}
```

## PremiseEngine Interfaces (`premise-engine.interfaces.ts`)

### `TExpressionMutations<TArg, TPremise, TExpr, TVar>`

Single-premise expression writes.

```typescript
interface TExpressionMutations<TArg, TPremise, TExpr, TVar> {
    addExpression(
        expression: TExpressionInput<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    appendExpression(
        parentId: string | null,
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    addExpressionRelative(
        siblingId: string,
        relativePosition: "before" | "after",
        expression: TExpressionWithoutPosition<TExpr>
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    updateExpression(
        expressionId: string,
        updates: TExpressionUpdate
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    removeExpression(
        expressionId: string,
        deleteSubtree: boolean
    ): TCoreMutationResult<TExpr | undefined, TExpr, TVar, TPremise, TArg>
    insertExpression(
        expression: TExpressionInput<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
    wrapExpression(
        operator: TExpressionWithoutPosition<TExpr>,
        newSibling: TExpressionWithoutPosition<TExpr>,
        leftNodeId?: string,
        rightNodeId?: string
    ): TCoreMutationResult<TExpr, TExpr, TVar, TPremise, TArg>
}
```

### `TExpressionQueries<TExpr>`

Single-premise expression reads.

```typescript
interface TExpressionQueries<TExpr> {
    getExpression(id: string): TExpr | undefined
    getRootExpressionId(): string | undefined
    getRootExpression(): TExpr | undefined
    getExpressions(): TExpr[]
    getChildExpressions(parentId: string | null): TExpr[]
}
```

### `TVariableReferences<TArg, TPremise, TExpr, TVar>`

```typescript
interface TVariableReferences<TArg, TPremise, TExpr, TVar> {
    getVariables(): TVar[]
    getReferencedVariableIds(): Set<string>
    deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg>
}
```

### `TPremiseClassification`

```typescript
interface TPremiseClassification {
    isInference(): boolean
    isConstraint(): boolean
}
```

### `TPremiseEvaluation`

```typescript
interface TPremiseEvaluation {
    validateEvaluability(): TCoreValidationResult
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            requireExactCoverage?: boolean
        }
    ): TCorePremiseEvaluationResult
}
```

### `TPremiseLifecycle<TPremise, TExpr>`

The static `fromSnapshot` factory is not included — TypeScript interfaces cannot declare static members.

```typescript
interface TPremiseLifecycle<TPremise, TExpr> {
    snapshot(): TPremiseEngineSnapshot<TPremise, TExpr>
    setOnMutate(callback: (() => void) | undefined): void
    markDirty(): void
}
```

### `TPremiseIdentity<TArg, TPremise, TExpr, TVar>`

```typescript
interface TPremiseIdentity<TArg, TPremise, TExpr, TVar> {
    getId(): string
    toPremiseData(): TPremise
    getExtras(): Record<string, unknown>
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
}
```

## Implementation Details

### `implements` clauses

```typescript
export class ArgumentEngine<TArg, TPremise, TExpr, TVar>
  implements
    TPremiseCrud<TArg, TPremise, TExpr, TVar>,
    TVariableManagement<TArg, TPremise, TExpr, TVar>,
    TArgumentExpressionQueries<TExpr>,
    TArgumentRoleState<TArg, TPremise, TExpr, TVar>,
    TArgumentEvaluation,
    TArgumentLifecycle<TArg, TPremise, TExpr, TVar>,
    TArgumentIdentity<TArg>,
    TDisplayable,
    TChecksummable
{ ... }

export class PremiseEngine<TArg, TPremise, TExpr, TVar>
  implements
    TExpressionMutations<TArg, TPremise, TExpr, TVar>,
    TExpressionQueries<TExpr>,
    TVariableReferences<TArg, TPremise, TExpr, TVar>,
    TPremiseClassification,
    TPremiseEvaluation,
    TPremiseLifecycle<TPremise, TExpr>,
    TPremiseIdentity<TArg, TPremise, TExpr, TVar>,
    TDisplayable,
    TChecksummable
{ ... }
```

### Generic defaults

All interfaces use the same generic defaults as the classes (e.g., `TExpr extends TCorePropositionalExpression = TCorePropositionalExpression`) so consumers who don't customize can write `TVariableManagement` without type params.

### Expression query separation

ArgumentEngine and PremiseEngine expression queries are kept as separate interfaces (`TArgumentExpressionQueries` vs `TExpressionQueries`) because they operate at different levels of abstraction. ArgumentEngine queries span all premises and return premise context; PremiseEngine queries are scoped to a single premise.

### Evaluation separation

ArgumentEngine and PremiseEngine evaluation interfaces are kept separate (`TArgumentEvaluation` vs `TPremiseEvaluation`) because `evaluate()` returns different types (`TCoreArgumentEvaluationResult` vs `TCorePremiseEvaluationResult`) and accepts different option types. `checkValidity` is unique to `TArgumentEvaluation`.

### Static factory methods

`ArgumentEngine.fromSnapshot`, `ArgumentEngine.fromData`, and `PremiseEngine.fromSnapshot` are static methods and cannot be declared in TypeScript interfaces. They remain as class-level static methods only.

## What Does Not Change

- No method signatures change
- No file splits for the class implementations (separate effort)
- No abstract base classes or mixins
- No runtime impact (interfaces are erased at compile time)
- No behavioral changes
