# Project Structure Cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clean up project structure for consistency — eliminate the `utils.ts`/`utils/` conflict, split `evaluation/shared.ts`, rename PascalCase core files to camelCase, rename the misleading test file, and tighten barrel exports.

**Architecture:** Six independent refactoring tasks, each committed separately. All are mechanical rename/move operations with import path updates. No behavioral changes.

**Tech Stack:** TypeScript, Vitest, pnpm

---

### Task 1: Move `utils.ts` into `utils/` directory

**Files:**

- Create: `src/lib/utils/defaultMap.ts`
- Delete: `src/lib/utils.ts`
- Modify: `src/lib/core/PremiseEngine.ts:9`

**Step 1: Create `src/lib/utils/defaultMap.ts`**

Copy the contents of `src/lib/utils.ts` into `src/lib/utils/defaultMap.ts` — the file contains the `DefaultValueFactory` type alias and `DefaultMap` class. No changes to the code itself.

**Step 2: Update the single import**

In `src/lib/core/PremiseEngine.ts` line 9, change:

```typescript
import { DefaultMap } from "../utils.js"
```

to:

```typescript
import { DefaultMap } from "../utils/defaultMap.js"
```

**Step 3: Delete `src/lib/utils.ts`**

**Step 4: Run checks**

```bash
pnpm run check
```

Expected: all pass (typecheck, lint, test, build).

**Step 5: Commit**

```
refactor: move DefaultMap from utils.ts into utils/defaultMap.ts
```

---

### Task 2: Split `evaluation/shared.ts` into `kleene.ts` and `validation.ts`

**Files:**

- Create: `src/lib/core/evaluation/kleene.ts`
- Create: `src/lib/core/evaluation/validation.ts`
- Delete: `src/lib/core/evaluation/shared.ts`
- Modify: `src/lib/core/ArgumentEngine.ts:29-34`
- Modify: `src/lib/core/PremiseEngine.ts:20-29`
- Modify: `test/ExpressionManager.test.ts:43-49`

**Step 1: Create `src/lib/core/evaluation/kleene.ts`**

```typescript
import type { TCoreTrivalentValue } from "../../types/evaluation.js"

/** Kleene three-valued NOT: null propagates. */
export function kleeneNot(a: TCoreTrivalentValue): TCoreTrivalentValue {
    return a === null ? null : !a
}

/** Kleene three-valued AND: false dominates, null propagates. */
export function kleeneAnd(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    if (a === false || b === false) return false
    if (a === null || b === null) return null
    return true
}

/** Kleene three-valued OR: true dominates, null propagates. */
export function kleeneOr(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    if (a === true || b === true) return true
    if (a === null || b === null) return null
    return false
}

/** Kleene three-valued material implication: NOT a OR b. */
export function kleeneImplies(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneOr(kleeneNot(a), b)
}

/** Kleene three-valued biconditional: (a -> b) AND (b -> a). */
export function kleeneIff(
    a: TCoreTrivalentValue,
    b: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneAnd(kleeneImplies(a, b), kleeneImplies(b, a))
}
```

**Step 2: Create `src/lib/core/evaluation/validation.ts`**

```typescript
import type {
    TCoreDirectionalVacuity,
    TCoreTrivalentValue,
    TCoreValidationIssue,
    TCoreValidationResult,
} from "../../types/evaluation.js"
import { kleeneAnd, kleeneImplies, kleeneNot } from "./kleene.js"

/** Creates a validation result, setting `ok` based on whether any error-severity issues exist. */
export function makeValidationResult(
    issues: TCoreValidationIssue[]
): TCoreValidationResult {
    return {
        ok: issues.every((issue) => issue.severity !== "error"),
        issues,
    }
}

/** Creates a validation issue with `severity: "error"`. */
export function makeErrorIssue(
    issue: Omit<TCoreValidationIssue, "severity">
): TCoreValidationIssue {
    return { severity: "error", ...issue }
}

/** Computes Kleene three-valued material implication: `!antecedent || consequent`. */
export function implicationValue(
    antecedent: TCoreTrivalentValue,
    consequent: TCoreTrivalentValue
): TCoreTrivalentValue {
    return kleeneImplies(antecedent, consequent)
}

/** Builds a directional vacuity diagnostic for one direction of an implication. */
export function buildDirectionalVacuity(
    antecedentTrue: TCoreTrivalentValue,
    consequentTrue: TCoreTrivalentValue
): TCoreDirectionalVacuity {
    const implication = implicationValue(antecedentTrue, consequentTrue)
    return {
        antecedentTrue,
        consequentTrue,
        implicationValue: implication,
        isVacuouslyTrue: kleeneAnd(implication, kleeneNot(antecedentTrue)),
        fired: antecedentTrue,
    }
}
```

**Step 3: Update imports in `src/lib/core/ArgumentEngine.ts`**

Replace lines 29-34:

```typescript
import {
    kleeneAnd,
    kleeneNot,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/shared.js"
```

with:

```typescript
import { kleeneAnd, kleeneNot } from "./evaluation/kleene.js"
import {
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"
```

**Step 4: Update imports in `src/lib/core/PremiseEngine.ts`**

Replace lines 20-29:

```typescript
import {
    buildDirectionalVacuity,
    kleeneAnd,
    kleeneIff,
    kleeneImplies,
    kleeneNot,
    kleeneOr,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/shared.js"
```

with:

```typescript
import {
    kleeneAnd,
    kleeneIff,
    kleeneImplies,
    kleeneNot,
    kleeneOr,
} from "./evaluation/kleene.js"
import {
    buildDirectionalVacuity,
    makeErrorIssue,
    makeValidationResult,
} from "./evaluation/validation.js"
```

**Step 5: Update imports in `test/ExpressionManager.test.ts`**

Replace lines 43-49:

```typescript
import {
    kleeneNot,
    kleeneAnd,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "../src/lib/core/evaluation/shared"
```

with:

```typescript
import {
    kleeneNot,
    kleeneAnd,
    kleeneOr,
    kleeneImplies,
    kleeneIff,
} from "../src/lib/core/evaluation/kleene"
```

**Step 6: Delete `src/lib/core/evaluation/shared.ts`**

**Step 7: Run checks**

```bash
pnpm run check
```

**Step 8: Commit**

```
refactor: split evaluation/shared.ts into kleene.ts and validation.ts
```

---

### Task 3: Rename test file

**Files:**

- Rename: `test/ExpressionManager.test.ts` → `test/core.test.ts`

The file tests the entire core library (ExpressionManager, PremiseEngine, ArgumentEngine, VariableManager, ChangeCollector, diff, checksum, relationships, positions, snapshots, generics). The name `ExpressionManager.test.ts` is misleading. `core.test.ts` accurately reflects its scope.

**Step 1: Rename the file**

```bash
git mv test/ExpressionManager.test.ts test/core.test.ts
```

**Step 2: Run checks**

```bash
pnpm run check
```

**Step 3: Commit**

```
refactor: rename ExpressionManager.test.ts to core.test.ts
```

---

### Task 4: Rename PascalCase core files to camelCase

**Files to rename:**

- `src/lib/core/ArgumentEngine.ts` → `src/lib/core/argumentEngine.ts`
- `src/lib/core/PremiseEngine.ts` → `src/lib/core/premiseEngine.ts`
- `src/lib/core/ExpressionManager.ts` → `src/lib/core/expressionManager.ts`
- `src/lib/core/VariableManager.ts` → `src/lib/core/variableManager.ts`
- `src/lib/core/ChangeCollector.ts` → `src/lib/core/changeCollector.ts`

**Important:** On case-insensitive filesystems (macOS default), use two-step renames:

```bash
git mv src/lib/core/ArgumentEngine.ts src/lib/core/argumentEngine_.ts
git mv src/lib/core/argumentEngine_.ts src/lib/core/argumentEngine.ts
```

Repeat for each file.

**Files with imports to update (30 import statements across 12 files):**

In `src/lib/core/argumentEngine.ts` (the file itself, after rename):

- `./ChangeCollector.js` → `./changeCollector.js`
- `./ExpressionManager.js` → `./expressionManager.js`
- `./PremiseEngine.js` → `./premiseEngine.js`
- `./VariableManager.js` → `./variableManager.js`

In `src/lib/core/premiseEngine.ts` (after rename):

- `./ArgumentEngine.js` → `./argumentEngine.js`
- `./ChangeCollector.js` → `./changeCollector.js`
- `./ExpressionManager.js` → `./expressionManager.js` (2 import lines)
- `./VariableManager.js` → `./variableManager.js`

In `src/lib/core/expressionManager.ts` (after rename):

- `./ChangeCollector.js` → `./changeCollector.js`
- `./ArgumentEngine.js` → `./argumentEngine.js`

In `src/lib/core/variableManager.ts` (after rename):

- `./ArgumentEngine.js` → `./argumentEngine.js`

In `src/lib/core/relationships.ts`:

- `./ArgumentEngine.js` → `./argumentEngine.js`
- `./PremiseEngine.js` → `./premiseEngine.js`

In `src/lib/core/diff.ts`:

- `./ArgumentEngine.js` → `./argumentEngine.js`

In `src/lib/index.ts`:

- `./core/ArgumentEngine.js` → `./core/argumentEngine.js` (2 lines)
- `./core/PremiseEngine.js` → `./core/premiseEngine.js` (2 lines)
- `./core/ExpressionManager.js` → `./core/expressionManager.js` (2 lines)
- `./core/VariableManager.js` → `./core/variableManager.js`

In `src/index.ts`:

- `./lib/core/ExpressionManager.js` → `./lib/core/expressionManager.js`

In `src/cli/engine.ts`:

- `../lib/core/ArgumentEngine.js` → `../lib/core/argumentEngine.js`

In `src/cli/import.ts`:

- `../lib/core/ExpressionManager.js` → `../lib/core/expressionManager.js`
- `../lib/core/ArgumentEngine.js` → `../lib/core/argumentEngine.js`

In `src/cli/commands/premises.ts`:

- `../../lib/core/PremiseEngine.js` → `../../lib/core/premiseEngine.js`
- `../../lib/core/VariableManager.js` → `../../lib/core/variableManager.js`

In `src/cli/commands/expressions.ts`:

- `../../lib/core/ExpressionManager.js` → `../../lib/core/expressionManager.js`

In `test/core.test.ts` (already renamed in Task 3):

- `../src/lib/core/ChangeCollector` → `../src/lib/core/changeCollector`
- `../src/lib/core/VariableManager` → `../src/lib/core/variableManager`
- `../src/lib/core/ExpressionManager` → `../src/lib/core/expressionManager` (2 lines)

**Step 1: Rename all 5 files** (two-step for case-insensitive FS)

**Step 2: Update all 30 import paths** in the 12 files listed above

**Step 3: Run checks**

```bash
pnpm run check
```

**Step 4: Commit**

```
refactor: rename PascalCase core files to camelCase
```

---

### Task 5: Tighten barrel exports

**Files:**

- Modify: `src/lib/index.ts`
- Rewrite: `src/index.ts`

Currently `src/index.ts` re-exports from both `src/lib/index.ts` (named exports) and directly from deep paths (`src/lib/schemata/index.js`, `src/lib/core/checksum.js`, `src/lib/core/diff.js`, etc.). The goal is to make `src/lib/index.ts` the single complete barrel for the library, and `src/index.ts` a thin re-export of it.

**Step 1: Add missing schemata export to `src/lib/index.ts`**

Add at the top of the file (after the existing imports/exports):

```typescript
export * from "./schemata/index.js"
```

This is the one export present in `src/index.ts` that is missing from `src/lib/index.ts`.

**Step 2: Rewrite `src/index.ts`**

Replace the entire contents with:

```typescript
/**
 * @module @polintpro/proposit-core
 *
 * Core engine for building, evaluating, and diffing propositional logic
 * arguments. Exports {@link ArgumentEngine} and {@link PremiseEngine} as
 * the primary API, along with all type schemata and the {@link diffArguments}
 * utility.
 */
export * from "./lib/index.js"
```

**Step 3: Run checks**

```bash
pnpm run check
```

Verify that the public API hasn't changed — the same set of exports should be available. A quick way: `pnpm run build` and inspect the `dist/index.d.ts` output to confirm all expected symbols are present.

**Step 4: Commit**

```
refactor: tighten barrel exports — src/index.ts re-exports from lib/index.ts only
```

---

### Task 6: Update CLAUDE.md

After all tasks are complete, update `CLAUDE.md` to reflect the new file paths:

- Architecture tree: update all renamed file paths
- Replace `utils.ts` reference with `utils/defaultMap.ts`
- Replace `evaluation/shared.ts` reference with `evaluation/kleene.ts` and `evaluation/validation.ts`
- Replace `ExpressionManager.test.ts` reference with `core.test.ts`
- Replace PascalCase file names with camelCase equivalents
- Note the simplified barrel export structure

**Commit:**

```
docs: update CLAUDE.md to reflect structural cleanup
```
