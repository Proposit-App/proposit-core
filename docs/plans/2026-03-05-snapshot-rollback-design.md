# Snapshot/Rollback and Engine Consistency Redesign

## Overview

Add hierarchical snapshot/restore to the engine class hierarchy, fix naming inconsistencies, make expressions self-describing, normalize checksum handling, add bulk loading from flat DB queries, and restructure constructors for clarity.

## Changes

### 1. Naming

- `PremiseManager` renamed to `PremiseEngine` (it operates on a single premise's business logic, not a collection)
- `TArgumentEngineOptions` renamed to `TLogicEngineOptions` (universal config for all classes)

### 2. Schema changes

**Expression** (`BasePropositionalExpressionSchema`): Add `premiseId: UUID`. Expressions become self-describing -- they know which argument, version, and premise they belong to.

**Premise** (`CorePremiseSchema`): Add `argumentId: UUID` and `argumentVersion: Type.Number()`. Premises currently have no argument reference; they should, for the same self-describing reason.

### 3. `TLogicEngineOptions` (universal config)

```typescript
type TLogicEngineOptions = {
    checksumConfig?: TCoreChecksumConfig
    positionConfig?: TCorePositionConfig
}
```

Passed to all classes uniformly. Classes use only the fields they need but accept the full config.

### 4. Constructor restructuring

Constructors are reorganized into three parameter groups: entity data, dependencies, and config.

```typescript
ExpressionManager<TExpr>(config?: TLogicEngineOptions)

VariableManager<TVar>(config?: TLogicEngineOptions)

PremiseEngine<TArg, TPremise, TExpr, TVar>(
    premise: TOptionalChecksum<TPremise>,
    deps: { argument: TOptionalChecksum<TArg>; variables: VariableManager<TVar> },
    config?: TLogicEngineOptions
)

ArgumentEngine<TArg, TPremise, TExpr, TVar>(
    argument: TOptionalChecksum<TArg>,
    config?: TLogicEngineOptions
)
```

`PremiseEngine` accepts `premise: TOptionalChecksum<TPremise>` as its entity data (paralleling `ArgumentEngine` taking `argument: TOptionalChecksum<TArg>`). The premise metadata (id, extras, additional fields from `additionalProperties: true`) lives in this object. `getId()` reads from `this.premise.id`.

### 5. Checksum normalization

**ExpressionManager stores expressions with checksums** attached at add/update time, matching how VariableManager already stores variables with checksums. No more lazy attachment on getters.

**Cumulative checksums on engines**: Each engine maintains a cumulative checksum derived from a `Record<string, string>` mapping `entity_id -> entity_checksum` for all owned entities. This replaces the current ad-hoc checksum computation in `ArgumentEngine.computeChecksum()` and `PremiseEngine.checksum()`.

### 6. Snapshot types

Each snapshot captures only what the class **owns**, plus its config. Dependencies (owned by a higher-level class) are excluded.

```typescript
type TExpressionManagerSnapshot<TExpr> = {
    expressions: TExpr[] // with checksums
    config?: TLogicEngineOptions
}

type TVariableManagerSnapshot<TVar> = {
    variables: TVar[]
    config?: TLogicEngineOptions
}

type TPremiseEngineSnapshot<TPremise, TExpr> = {
    premise: TOptionalChecksum<TPremise>
    expressions: TExpressionManagerSnapshot<TExpr>
    config?: TLogicEngineOptions
}

type TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar> = {
    argument: TOptionalChecksum<TArg>
    variables: TVariableManagerSnapshot<TVar>
    premises: TPremiseEngineSnapshot<TPremise, TExpr>[]
    conclusionPremiseId?: string
    config?: TLogicEngineOptions
}
```

### 7. Snapshot/restore methods

```typescript
// ExpressionManager
snapshot(): TExpressionManagerSnapshot<TExpr>
static fromSnapshot<TExpr>(snapshot: TExpressionManagerSnapshot<TExpr>): ExpressionManager<TExpr>

// VariableManager
snapshot(): TVariableManagerSnapshot<TVar>
static fromSnapshot<TVar>(snapshot: TVariableManagerSnapshot<TVar>): VariableManager<TVar>

// PremiseEngine
snapshot(): TPremiseEngineSnapshot<TPremise, TExpr>
static fromSnapshot<TArg, TPremise, TExpr, TVar>(
    snapshot: TPremiseEngineSnapshot<TPremise, TExpr>,
    argument: TOptionalChecksum<TArg>,
    variables: VariableManager<TVar>
): PremiseEngine<TArg, TPremise, TExpr, TVar>

// ArgumentEngine
snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
static fromSnapshot<TArg, TPremise, TExpr, TVar>(
    snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
): ArgumentEngine<TArg, TPremise, TExpr, TVar>
```

`ArgumentEngine.fromSnapshot()` creates a `VariableManager` from the snapshot's variable data, then passes it as a dependency to each `PremiseEngine.fromSnapshot()`.

### 8. Rollback convenience method

```typescript
// On ArgumentEngine
rollback(snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>): void
```

Restores the engine's internal state in place from a previously captured snapshot. Equivalent to reconstructing via `fromSnapshot` but mutates the existing instance (preserving references held by callers).

### 9. Bulk loading from DB

```typescript
static fromData<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>(
    argument: TOptionalChecksum<TArg>,
    variables: TOptionalChecksum<TVar>[],
    premises: TOptionalChecksum<TPremise>[],
    expressions: TExpressionInput<TExpr>[],
    roles: TCoreArgumentRoleState,
    config?: TLogicEngineOptions
): ArgumentEngine<TArg, TPremise, TExpr, TVar>
```

The engine groups expressions by `premiseId` (now available on the expression schema), creates one shared `VariableManager`, creates each `PremiseEngine` with its expressions, and sets roles. Generics are inferred from parameters.

Distinct from `fromSnapshot`: config is a separate parameter (not embedded in the data), and the input is flat arrays as returned by DB queries.

### 10. `toDisplayString` on ArgumentEngine

Renders the full argument as a multi-line string: argument metadata header, then each premise's `toDisplayString()` output prefixed with its role (conclusion, supporting, or constraint).

### 11. Replaced methods

- `ArgumentEngine.toData()` / `exportState()` -> `snapshot()`
- `PremiseManager.toData()` -> `PremiseEngine.snapshot()`
- `TCoreArgumentEngineData` retired (snapshot types replace it)

## Class hierarchy (updated)

```
ArgumentEngine<TArg, TPremise, TExpr, TVar>
  |-- VariableManager<TVar> (shared, owned by engine)
  +-- PremiseEngine<TArg, TPremise, TExpr, TVar> (one per premise)
       +-- ExpressionManager<TExpr> (expression tree)
```

## Snapshot ownership

| Class             | Snapshot includes                               | Snapshot excludes                     |
| ----------------- | ----------------------------------------------- | ------------------------------------- |
| ExpressionManager | expressions (with checksums), config            | --                                    |
| VariableManager   | variables, config                               | --                                    |
| PremiseEngine     | premise metadata, expression snapshot, config   | argument, variables (owned by engine) |
| ArgumentEngine    | argument, variable snapshot, premise snapshots, | --                                    |
|                   | conclusionPremiseId, config                     |                                       |

## Constructor parameter groups

| Class             | Entity data                           | Dependencies                         | Config              |
| ----------------- | ------------------------------------- | ------------------------------------ | ------------------- |
| ExpressionManager | --                                    | --                                   | TLogicEngineOptions |
| VariableManager   | --                                    | --                                   | TLogicEngineOptions |
| PremiseEngine     | premise: TOptionalChecksum\<TPremise> | argument, variables: VariableManager | TLogicEngineOptions |
| ArgumentEngine    | argument: TOptionalChecksum\<TArg>    | -- (owns its children)               | TLogicEngineOptions |
