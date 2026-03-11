# Engine Interfaces Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract typed interfaces from `ArgumentEngine` and `PremiseEngine` to improve API discoverability and enable downstream extensibility.

**Architecture:** Create an `interfaces/` directory under `src/lib/core/` with three files: shared interfaces, ArgumentEngine interfaces, and PremiseEngine interfaces. Each class gets an `implements` clause. No runtime changes — interfaces are erased at compile time.

**Tech Stack:** TypeScript interfaces, existing generic type parameters.

**Spec:** `docs/superpowers/specs/2026-03-11-engine-interfaces-design.md`

---

## File Map

| Action | File                                                    | Responsibility                   |
| ------ | ------------------------------------------------------- | -------------------------------- |
| Create | `src/lib/core/interfaces/shared.interfaces.ts`          | `TDisplayable`, `TChecksummable` |
| Create | `src/lib/core/interfaces/argument-engine.interfaces.ts` | 7 ArgumentEngine interfaces      |
| Create | `src/lib/core/interfaces/premise-engine.interfaces.ts`  | 7 PremiseEngine interfaces       |
| Create | `src/lib/core/interfaces/index.ts`                      | Barrel re-export                 |
| Modify | `src/lib/core/argument-engine.ts`                       | Add `implements` clause + import |
| Modify | `src/lib/core/premise-engine.ts`                        | Add `implements` clause + import |
| Modify | `src/lib/index.ts`                                      | Re-export interfaces barrel      |

---

## Chunk 1: Shared Interfaces

### Task 1: Create shared interfaces file

**Files:**

- Create: `src/lib/core/interfaces/shared.interfaces.ts`

- [ ] **Step 1: Create the shared interfaces file**

```typescript
// src/lib/core/interfaces/shared.interfaces.ts

/**
 * An entity that can produce a human-readable display string.
 */
export interface TDisplayable {
    toDisplayString(): string
}

/**
 * An entity that can produce a deterministic content checksum.
 */
export interface TChecksummable {
    checksum(): string
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/interfaces/shared.interfaces.ts
git commit -m "feat: add TDisplayable and TChecksummable shared interfaces"
```

---

## Chunk 2: ArgumentEngine Interfaces

### Task 2: Create ArgumentEngine interfaces file

**Files:**

- Create: `src/lib/core/interfaces/argument-engine.interfaces.ts`

The file imports types from `../../schemata/index.js`, `../../types/evaluation.js`, `../../types/mutation.js`, and `../../types/reactive.js`. It also forward-references `PremiseEngine` from `../premise-engine.js` and `TArgumentEngineSnapshot` from `../argument-engine.js`.

- [ ] **Step 1: Create the interfaces file**

```typescript
// src/lib/core/interfaces/argument-engine.interfaces.ts
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TOptionalChecksum,
} from "../../schemata/index.js"
import type {
    TCoreArgumentEvaluationOptions,
    TCoreArgumentEvaluationResult,
    TCoreArgumentRoleState,
    TCoreExpressionAssignment,
    TCoreValidationResult,
    TCoreValidityCheckOptions,
    TCoreValidityCheckResult,
} from "../../types/evaluation.js"
import type { TCoreMutationResult } from "../../types/mutation.js"
import type { TReactiveSnapshot } from "../../types/reactive.js"
import type { PremiseEngine } from "../premise-engine.js"
import type { TArgumentEngineSnapshot } from "../argument-engine.js"

/**
 * Premise creation, removal, and lookup.
 */
export interface TPremiseCrud<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
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

/**
 * Variable CRUD and lookup across the argument.
 */
export interface TVariableManagement<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
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

/**
 * Cross-premise expression lookups and analysis.
 */
export interface TArgumentExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
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

/**
 * Conclusion and supporting premise role management.
 */
export interface TArgumentRoleState<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
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

/**
 * Argument-level evaluation: single-assignment evaluation, evaluability
 * validation, and exhaustive validity checking.
 */
export interface TArgumentEvaluation {
    validateEvaluability(): TCoreValidationResult
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: TCoreArgumentEvaluationOptions
    ): TCoreArgumentEvaluationResult
    checkValidity(options?: TCoreValidityCheckOptions): TCoreValidityCheckResult
}

/**
 * Snapshot, rollback, and reactive subscription lifecycle.
 * Static factory methods (fromSnapshot, fromData) are class-level only.
 */
export interface TArgumentLifecycle<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    subscribe(listener: () => void): () => void
    getSnapshot(): TReactiveSnapshot<TArg, TPremise, TExpr, TVar>
    snapshot(): TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    rollback(
        snapshot: TArgumentEngineSnapshot<TArg, TPremise, TExpr, TVar>
    ): void
}

/**
 * Argument entity access.
 */
export interface TArgumentIdentity<TArg extends TCoreArgument = TCoreArgument> {
    getArgument(): TArg
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/interfaces/argument-engine.interfaces.ts
git commit -m "feat: add ArgumentEngine capability interfaces"
```

---

## Chunk 3: PremiseEngine Interfaces

### Task 3: Create PremiseEngine interfaces file

**Files:**

- Create: `src/lib/core/interfaces/premise-engine.interfaces.ts`

Imports follow the same pattern as `premise-engine.ts`. References `TExpressionInput`, `TExpressionWithoutPosition`, `TExpressionUpdate` from `../expression-manager.js`, and `TPremiseEngineSnapshot` from `../premise-engine.js`.

- [ ] **Step 1: Create the interfaces file**

```typescript
// src/lib/core/interfaces/premise-engine.interfaces.ts
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../schemata/index.js"
import type {
    TCoreExpressionAssignment,
    TCorePremiseEvaluationResult,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import type { TCoreMutationResult } from "../../types/mutation.js"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "../expression-manager.js"
import type { TPremiseEngineSnapshot } from "../premise-engine.js"

/**
 * Single-premise expression tree mutations.
 */
export interface TExpressionMutations<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
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

/**
 * Single-premise expression tree reads.
 */
export interface TExpressionQueries<
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    getExpression(id: string): TExpr | undefined
    getRootExpressionId(): string | undefined
    getRootExpression(): TExpr | undefined
    getExpressions(): TExpr[]
    getChildExpressions(parentId: string | null): TExpr[]
}

/**
 * Variable reference queries and cascade deletion.
 */
export interface TVariableReferences<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    getVariables(): TVar[]
    getReferencedVariableIds(): Set<string>
    deleteExpressionsUsingVariable(
        variableId: string
    ): TCoreMutationResult<TExpr[], TExpr, TVar, TPremise, TArg>
}

/**
 * Premise type classification (inference vs constraint).
 */
export interface TPremiseClassification {
    isInference(): boolean
    isConstraint(): boolean
}

/**
 * Premise-level evaluation: single-assignment evaluation and
 * evaluability validation.
 */
export interface TPremiseEvaluation {
    validateEvaluability(): TCoreValidationResult
    evaluate(
        assignment: TCoreExpressionAssignment,
        options?: {
            strictUnknownKeys?: boolean
            requireExactCoverage?: boolean
        }
    ): TCorePremiseEvaluationResult
}

/**
 * Premise snapshot and mutation callback lifecycle.
 * Static fromSnapshot factory is class-level only.
 */
export interface TPremiseLifecycle<
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
> {
    snapshot(): TPremiseEngineSnapshot<TPremise, TExpr>
    setOnMutate(callback: (() => void) | undefined): void
    markDirty(): void
}

/**
 * Premise entity identity and metadata access.
 */
export interface TPremiseIdentity<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    getId(): string
    toPremiseData(): TPremise
    getExtras(): Record<string, unknown>
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/interfaces/premise-engine.interfaces.ts
git commit -m "feat: add PremiseEngine capability interfaces"
```

---

## Chunk 4: Barrel Exports and Wiring

### Task 4: Create interfaces barrel export

**Files:**

- Create: `src/lib/core/interfaces/index.ts`

- [ ] **Step 1: Create the barrel file**

```typescript
// src/lib/core/interfaces/index.ts
export type { TDisplayable, TChecksummable } from "./shared.interfaces.js"

export type {
    TPremiseCrud,
    TVariableManagement,
    TArgumentExpressionQueries,
    TArgumentRoleState,
    TArgumentEvaluation,
    TArgumentLifecycle,
    TArgumentIdentity,
} from "./argument-engine.interfaces.js"

export type {
    TExpressionMutations,
    TExpressionQueries,
    TVariableReferences,
    TPremiseClassification,
    TPremiseEvaluation,
    TPremiseLifecycle,
    TPremiseIdentity,
} from "./premise-engine.interfaces.js"
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/interfaces/index.ts
git commit -m "feat: add interfaces barrel export"
```

### Task 5: Wire interfaces into ArgumentEngine

**Files:**

- Modify: `src/lib/core/argument-engine.ts:1-74` (imports and class declaration)

- [ ] **Step 1: Add import of interfaces**

Add this import to the top of `argument-engine.ts`, after the existing imports:

```typescript
import type {
    TPremiseCrud,
    TVariableManagement,
    TArgumentExpressionQueries,
    TArgumentRoleState,
    TArgumentEvaluation,
    TArgumentLifecycle,
    TArgumentIdentity,
    TDisplayable,
    TChecksummable,
} from "./interfaces/index.js"
```

- [ ] **Step 2: Add `implements` clause to the class declaration**

Change the class declaration from:

```typescript
export class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
```

To:

```typescript
export class ArgumentEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>
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
{
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS. If it fails, the compiler will report exactly which method signatures don't match — fix any mismatches in the interface files (not the class).

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: All 566+ tests pass. No behavioral changes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/argument-engine.ts
git commit -m "feat: ArgumentEngine implements capability interfaces"
```

### Task 6: Wire interfaces into PremiseEngine

**Files:**

- Modify: `src/lib/core/premise-engine.ts:1-61` (imports and class declaration)

- [ ] **Step 1: Add import of interfaces**

Add this import to the top of `premise-engine.ts`, after the existing imports:

```typescript
import type {
    TExpressionMutations,
    TExpressionQueries,
    TVariableReferences,
    TPremiseClassification,
    TPremiseEvaluation,
    TPremiseLifecycle,
    TPremiseIdentity,
    TDisplayable,
    TChecksummable,
} from "./interfaces/index.js"
```

- [ ] **Step 2: Add `implements` clause to the class declaration**

Change the class declaration from:

```typescript
export class PremiseEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
```

To:

```typescript
export class PremiseEngine<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
>
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
{
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS. Same as Task 5 — any mismatches are fixed in the interface files.

- [ ] **Step 4: Run tests**

Run: `pnpm run test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/core/premise-engine.ts
git commit -m "feat: PremiseEngine implements capability interfaces"
```

### Task 7: Re-export interfaces from library barrel

**Files:**

- Modify: `src/lib/index.ts`

- [ ] **Step 1: Add interfaces re-export**

Add this line to `src/lib/index.ts`, after the `PremiseEngine` exports:

```typescript
export type * from "./core/interfaces/index.js"
```

- [ ] **Step 2: Run full check**

Run: `pnpm run check`
Expected: typecheck, lint, format, and tests all pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/index.ts
git commit -m "feat: re-export engine interfaces from library barrel"
```
