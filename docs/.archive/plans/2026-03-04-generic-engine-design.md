# Generic ArgumentEngine Design

## Goal

Make `ArgumentEngine`, `PremiseManager`, `ExpressionManager`, and `VariableManager` generic so they accept entity types that extend the base types (`TCoreArgument`, `TCorePremise`, `TCorePropositionalExpression`, `TCorePropositionalVariable`). Extra fields on extended types survive all mutations via spread-based reconstruction. All defaults resolve to the base types, so existing code works unchanged.

## Type Parameters

### Per-class parameters

Each class carries only the type parameters it uses:

| Class               | Type Parameters                 |
| ------------------- | ------------------------------- |
| `ArgumentEngine`    | `<TArg, TPremise, TExpr, TVar>` |
| `PremiseManager`    | `<TArg, TPremise, TExpr, TVar>` |
| `ExpressionManager` | `<TExpr>`                       |
| `VariableManager`   | `<TVar>`                        |

All parameters have `extends BaseType = BaseType` defaults.

### Internal storage types

| Class               | Storage                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ArgumentEngine`    | `argument: TOptionalChecksum<TArg>`, `premises: Map<string, PremiseManager<TArg, TPremise, TExpr, TVar>>`, `variables: VariableManager<TVar>` |
| `PremiseManager`    | `argument: TOptionalChecksum<TArg>`, `expressions: ExpressionManager<TExpr>`, `variables: VariableManager<TVar>`                              |
| `ExpressionManager` | `expressions: Map<string, TOptionalChecksum<TExpr>>`                                                                                          |
| `VariableManager`   | `variables: Map<string, TVar>` (checksum already attached before registration)                                                                |

### TOptionalChecksum utility type

Already defined in `shared.ts`:

```typescript
type TOptionalChecksum<T extends { checksum?: unknown }> = Omit<T, "checksum"> &
    Partial<Pick<T, "checksum">>
```

## Mutation types

### TCoreChangeset becomes generic

```typescript
interface TCoreChangeset<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    expressions?: TCoreEntityChanges<TExpr>
    variables?: TCoreEntityChanges<TVar>
    premises?: TCoreEntityChanges<TPremise>
    roles?: TCoreArgumentRoleState
    argument?: TArg
}
```

### TCoreRawChangeset eliminated

Since checksums will be attached to entities before they enter the `ChangeCollector`, the raw/cooked distinction is no longer needed. `ChangeCollector` becomes generic and works with the full entity types directly.

```typescript
class ChangeCollector<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    // All methods accept/return full entity types
    // toChangeset() returns TCoreChangeset<TExpr, TVar, TPremise, TArg>
}
```

### TCoreMutationResult becomes generic on changeset

```typescript
interface TCoreMutationResult<
    T,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TArg extends TCoreArgument = TCoreArgument,
> {
    result: T
    changes: TCoreChangeset<TExpr, TVar, TPremise, TArg>
}
```

### TExpressionInput and TVariableInput

`TExpressionInput` becomes a generic utility derived from the `TExpr` parameter:

```typescript
// In ExpressionManager.ts — still a distributive Omit for union preservation
type TExpressionInput<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TExpr
        ? Omit<U, "checksum">
        : never
    : never
```

`TVariableInput` is removed entirely — `VariableManager` stores `TVar` directly (checksum attached by `ArgumentEngine` before registration).

`TExpressionWithoutPosition` follows the same pattern:

```typescript
type TExpressionWithoutPosition<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> = TExpr extends infer U
    ? U extends TExpr
        ? Omit<U, "position" | "checksum">
        : never
    : never
```

## Diff types

### Generic diff types

```typescript
interface TCorePremiseDiff<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> extends TCoreEntityFieldDiff<TPremise> {
    expressions: TCoreEntitySetDiff<TExpr>
}

interface TCorePremiseSetDiff<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    added: TPremise[]
    removed: TPremise[]
    modified: TCorePremiseDiff<TPremise, TExpr>[]
}

interface TCoreArgumentDiff<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    argument: TCoreEntityFieldDiff<TArg>
    variables: TCoreEntitySetDiff<TVar>
    premises: TCorePremiseSetDiff<TPremise, TExpr>
    roles: TCoreRoleDiff
}

interface TCoreDiffOptions<
    TArg extends TCoreArgument = TCoreArgument,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    compareArgument?: TCoreFieldComparator<TArg>
    compareVariable?: TCoreFieldComparator<TVar>
    comparePremise?: TCoreFieldComparator<TPremise>
    compareExpression?: TCoreFieldComparator<TExpr>
}
```

### diffArguments function

```typescript
function diffArguments<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    engineA: ArgumentEngine<TArg, TPremise, TExpr, TVar>,
    engineB: ArgumentEngine<TArg, TPremise, TExpr, TVar>,
    options?: TCoreDiffOptions<TArg, TVar, TPremise, TExpr>
): TCoreArgumentDiff<TArg, TVar, TPremise, TExpr>
```

Both engines must share the same type parameters. Default comparators continue to work with base types (they accept supertypes).

## `as` assertions

TypeScript cannot prove that `Omit<T, K> & Pick<Base, K>` equals `T` for generic `T extends Base`. Since the engine only overrides known base-type fields via spread (preserving extra fields), `as T` casts are semantically safe.

### Assertion locations

**ArgumentEngine:**

- `getArgument()`: `{ ...this.argument, checksum } as TArg`
- `attachVariableChecksum()`: `{ ...v, checksum } as TVar`
- `addVariable()` / `updateVariable()`: after reconstructing variable with new symbol

**ExpressionManager:**

- `addExpression()`: store `expr as TOptionalChecksum<TExpr>`
- `reparent()`: `{ ...expr, parentId, position } as TOptionalChecksum<TExpr>`
- `promoteChild()`: same pattern
- `updateExpression()`: `{ ...expr, ...updates } as TOptionalChecksum<TExpr>`
- `collapseIfNeeded()`: surviving child promotion

**PremiseManager:**

- `attachExpressionChecksum()`: `{ ...expr, checksum } as TExpr`
- `toData()`: premise construction `{ ...extras, id, ... } as TPremise`

## What stays non-generic

- `TCoreArgumentRoleState` — contains only `conclusionPremiseId`, no entity fields
- `TCoreChecksumConfig` — configuration, not entity data
- Evaluation types (`TArgumentEvaluationResult`, `TValidityCheckResult`, etc.) — computed results, not entities
- Relationship types and functions (`analyzePremiseRelationships`, `buildPremiseProfile`) — standalone analysis
- `TCoreFieldChange`, `TCoreEntityFieldDiff<T>`, `TCoreEntitySetDiff<T>`, `TCoreRoleDiff` — already generic or entity-agnostic
- `TCoreFieldComparator<T>` — already generic

## Backward compatibility

All type parameters default to the base types. Existing code that uses `ArgumentEngine` without type arguments, `TCoreChangeset` without type arguments, etc. continues to work unchanged. The `TExpressionInput` and `TExpressionWithoutPosition` type aliases remain exported (now as generic types with defaults) for backward compatibility.
