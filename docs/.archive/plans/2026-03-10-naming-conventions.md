# Naming Convention Enforcement Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce consistent naming conventions across the codebase with ESLint rules for filenames and identifiers, and document the conventions in CLAUDE.md for future work.

**Architecture:** Add `eslint-plugin-check-file` for kebab-case filename enforcement and `@typescript-eslint/naming-convention` for identifier casing rules. Rename ~10 multi-word camelCase files to kebab-case, fix a handful of non-T-prefixed type aliases, and add a naming conventions section to CLAUDE.md.

**Tech Stack:** ESLint 9, typescript-eslint 8, eslint-plugin-check-file

---

## File Structure

**Modified files:**

- `eslint.config.mjs` — add naming-convention and filename rules
- `package.json` / `pnpm-lock.yaml` — add eslint-plugin-check-file dependency
- `src/lib/schemata/shared.ts` — rename non-T-prefixed type aliases, rename `DateType` function
- `src/lib/core/parser/formula.ts` — rename `FormulaAST` type
- `src/lib/index.ts` — update re-export for renamed `FormulaAST`
- `src/cli/import.ts` — update `FormulaAST` import and usages
- `test/import.test.ts` — update `FormulaAST` import and usage
- `CLAUDE.md` — add naming conventions section, update file paths in architecture tree
- Various `src/` and `test/` files — update import paths for renamed files

**Renamed files (camelCase → kebab-case):**

| Old path                            | New path                             |
| ----------------------------------- | ------------------------------------ |
| `src/cli/commands/versionShow.ts`   | `src/cli/commands/version-show.ts`   |
| `src/cli/output/diffRenderer.ts`    | `src/cli/output/diff-renderer.ts`    |
| `src/lib/core/argumentEngine.ts`    | `src/lib/core/argument-engine.ts`    |
| `src/lib/core/changeCollector.ts`   | `src/lib/core/change-collector.ts`   |
| `src/lib/core/expressionManager.ts` | `src/lib/core/expression-manager.ts` |
| `src/lib/core/premiseEngine.ts`     | `src/lib/core/premise-engine.ts`     |
| `src/lib/core/variableManager.ts`   | `src/lib/core/variable-manager.ts`   |
| `src/lib/utils/defaultMap.ts`       | `src/lib/utils/default-map.ts`       |
| `test/diffCommand.test.ts`          | `test/diff-command.test.ts`          |
| `test/diffRenderer.test.ts`         | `test/diff-renderer.test.ts`         |

---

## Chunk 1: ESLint Configuration and Code Naming Fixes

### Task 1: Install eslint-plugin-check-file

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install the plugin**

```bash
pnpm add -D eslint-plugin-check-file
```

- [ ] **Step 2: Verify installation**

```bash
pnpm ls eslint-plugin-check-file
```

Expected: shows the installed version.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add eslint-plugin-check-file dependency"
```

---

### Task 2: Configure ESLint naming rules

**Files:**

- Modify: `eslint.config.mjs`

- [ ] **Step 1: Add both rules to eslint.config.mjs**

Add the `eslint-plugin-check-file` import at the top:

```js
import checkFile from "eslint-plugin-check-file"
```

Add the `@typescript-eslint/naming-convention` rule to the existing `rules` object:

```js
"@typescript-eslint/naming-convention": [
    "error",
    // Default: camelCase for everything not specifically overridden
    { selector: "default", format: ["camelCase"] },
    // Destructured variables: no enforcement (source determines naming)
    { selector: "variable", modifiers: ["destructured"], format: null },
    // const: camelCase, UPPER_CASE (true constants), PascalCase (Typebox schemas)
    {
        selector: "variable",
        modifiers: ["const"],
        format: ["camelCase", "UPPER_CASE", "PascalCase"],
    },
    // Non-const variables: camelCase only
    { selector: "variable", format: ["camelCase"] },
    // Functions: camelCase
    { selector: "function", format: ["camelCase"] },
    // Parameters: camelCase, allow leading underscore for unused
    {
        selector: "parameter",
        format: ["camelCase"],
        leadingUnderscore: "allow",
    },
    // Classes: PascalCase
    { selector: "class", format: ["PascalCase"] },
    // Type aliases and interfaces: T-prefixed PascalCase
    {
        selector: ["typeAlias", "interface"],
        format: ["PascalCase"],
        prefix: ["T"],
    },
    // Type parameters: PascalCase (no prefix — allows T, K, V, TArg, etc.)
    { selector: "typeParameter", format: ["PascalCase"] },
    // Enum names: PascalCase
    { selector: "enum", format: ["PascalCase"] },
    // Enum members: UPPER_CASE
    { selector: "enumMember", format: ["UPPER_CASE"] },
    // Object literal properties: no enforcement (JSON schemas, external APIs)
    { selector: "objectLiteralProperty", format: null },
    // Imports: no enforcement (external package naming)
    { selector: "import", format: null },
],
```

Add a new config block for filename checking (before the `globalIgnores` call):

```js
{
    files: ["src/**/*.ts", "test/**/*.ts"],
    plugins: { "check-file": checkFile },
    rules: {
        "check-file/filename-naming-convention": [
            "error",
            { "**/*.ts": "KEBAB_CASE" },
            { ignoreMiddleExtensions: true },
        ],
    },
},
```

The `ignoreMiddleExtensions: true` option allows files like `core.test.ts` and `*.d.ts`.

- [ ] **Step 2: Run ESLint to capture the full list of violations**

```bash
pnpm eslint . 2>&1 | grep -E "naming-convention|filename-naming" | head -60
```

Expected violations:

- **naming-convention:** `JsonPrimitive`, `JsonValue`, `JsonObject`, `JsonArray`, `UUID` (type), `FormulaAST`, `DateType` (function)
- **filename-naming-convention:** the 10 multi-word camelCase files listed in File Structure

- [ ] **Step 3: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore: configure naming-convention and filename-naming-convention ESLint rules"
```

---

### Task 3: Fix type alias naming violations

**Files:**

- Modify: `src/lib/schemata/shared.ts`
- Modify: `src/lib/core/parser/formula.ts`
- Modify: `src/lib/index.ts`
- Modify: `src/cli/import.ts`
- Modify: `test/import.test.ts`

#### Step-by-step renames

- [ ] **Step 1: Rename types in `src/lib/schemata/shared.ts`**

Apply these renames (definitions only — all in this one file since these types are only used internally):

| Old name             | New name              | Line                     |
| -------------------- | --------------------- | ------------------------ |
| `type JsonPrimitive` | `type TJsonPrimitive` | 43                       |
| `type JsonValue`     | `type TJsonValue`     | 66–69 (self-referencing) |
| `type JsonObject`    | `type TJsonObject`    | 70                       |
| `type JsonArray`     | `type TJsonArray`     | 71                       |
| `type UUID`          | `type TUUID`          | 83                       |

The self-referencing `JsonValue` type must update all internal references:

```typescript
export type TJsonValue =
    | TJsonPrimitive
    | { [key: string]: TJsonValue }
    | TJsonValue[]
export type TJsonObject = Record<string, TJsonValue>
export type TJsonArray = TJsonValue[]
```

Note: the `const UUID` on line 82 stays unchanged — only the type alias is renamed. The `const UUID` is a schema value, not a type, and it's used as a schema const in all its importers.

- [ ] **Step 2: Rename `DateType` function in `src/lib/schemata/shared.ts`**

```typescript
// Before:
export function DateType(): TDateType {
    return new TDateType()
}
export const EncodableDate = DateType()

// After:
export function dateType(): TDateType {
    return new TDateType()
}
export const EncodableDate = dateType()
```

This function is not imported anywhere — it's only called on line 31 to define `EncodableDate`.

- [ ] **Step 3: Rename `FormulaAST` in `src/lib/core/parser/formula.ts`**

Rename `FormulaAST` → `TFormulaAST` in the definition and all self-references:

```typescript
export type TFormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: TFormulaAST }
    | { type: "and"; operands: TFormulaAST[] }
    | { type: "or"; operands: TFormulaAST[] }
    | { type: "implies"; left: TFormulaAST; right: TFormulaAST }
    | { type: "iff"; left: TFormulaAST; right: TFormulaAST }

export function parseFormula(input: string): TFormulaAST {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return pegParse(input) as TFormulaAST
}
```

- [ ] **Step 4: Update `FormulaAST` re-export in `src/lib/index.ts`**

Find and update:

```typescript
// Before:
export type { FormulaAST } from "./core/parser/formula.js"

// After:
export type { TFormulaAST } from "./core/parser/formula.js"
```

- [ ] **Step 5: Update `FormulaAST` in `src/cli/import.ts`**

Update the import and all ~5 usages of `FormulaAST` → `TFormulaAST`:

```typescript
// Before:
import type { FormulaAST } from "../lib/core/parser/formula.js"

// After:
import type { TFormulaAST } from "../lib/core/parser/formula.js"
```

Then find-and-replace all `FormulaAST` occurrences in the file with `TFormulaAST`.

- [ ] **Step 6: Update `FormulaAST` in `test/import.test.ts`**

```typescript
// Before:
import type { FormulaAST } from "../src/lib/core/parser/formula"

// After:
import type { TFormulaAST } from "../src/lib/core/parser/formula"
```

Then update the usage on line 17.

- [ ] **Step 7: Run typecheck to verify no broken references**

```bash
pnpm run typecheck
```

Expected: clean, no errors.

- [ ] **Step 8: Run ESLint to verify naming-convention violations are resolved**

```bash
pnpm eslint . 2>&1 | grep "naming-convention"
```

Expected: no naming-convention violations (filename violations still expected — fixed in next chunk).

- [ ] **Step 9: Run tests**

```bash
pnpm run test
```

Expected: all tests pass.

- [ ] **Step 10: Commit**

```bash
git add src/lib/schemata/shared.ts src/lib/core/parser/formula.ts src/lib/index.ts src/cli/import.ts test/import.test.ts
git commit -m "refactor: rename type aliases to use T prefix convention"
```

---

## Chunk 2: File Renames

### Task 4: Rename files to kebab-case and update imports

**Files:**

- Rename: all 10 files listed in File Structure
- Modify: all files that import from renamed files

- [ ] **Step 1: Rename all files using git mv**

```bash
git mv src/cli/commands/versionShow.ts src/cli/commands/version-show.ts
git mv src/cli/output/diffRenderer.ts src/cli/output/diff-renderer.ts
git mv src/lib/core/argumentEngine.ts src/lib/core/argument-engine.ts
git mv src/lib/core/changeCollector.ts src/lib/core/change-collector.ts
git mv src/lib/core/expressionManager.ts src/lib/core/expression-manager.ts
git mv src/lib/core/premiseEngine.ts src/lib/core/premise-engine.ts
git mv src/lib/core/variableManager.ts src/lib/core/variable-manager.ts
git mv src/lib/utils/defaultMap.ts src/lib/utils/default-map.ts
git mv test/diffCommand.test.ts test/diff-command.test.ts
git mv test/diffRenderer.test.ts test/diff-renderer.test.ts
```

- [ ] **Step 2: Find all import references to old filenames**

Search for all imports referencing old filenames (remember imports use `.js` extensions):

```bash
grep -rn "versionShow\|diffRenderer\|argumentEngine\|changeCollector\|expressionManager\|premiseEngine\|variableManager\|defaultMap" --include="*.ts" src/ test/
```

This will produce the complete list of import statements to update.

- [ ] **Step 3: Update all import paths**

For each file found in Step 2, update the import path. The key substitutions (all `.js` extension imports):

| Old import segment     | New import segment      |
| ---------------------- | ----------------------- |
| `versionShow.js`       | `version-show.js`       |
| `diffRenderer.js`      | `diff-renderer.js`      |
| `argumentEngine.js`    | `argument-engine.js`    |
| `changeCollector.js`   | `change-collector.js`   |
| `expressionManager.js` | `expression-manager.js` |
| `premiseEngine.js`     | `premise-engine.js`     |
| `variableManager.js`   | `variable-manager.js`   |
| `defaultMap.js`        | `default-map.js`        |

For test files that import without `.js` extension (e.g. `from "../src/cli/output/diffRenderer"`), update those too.

- [ ] **Step 4: Run typecheck**

```bash
pnpm run typecheck
```

Expected: clean, no errors.

- [ ] **Step 5: Run ESLint**

```bash
pnpm eslint .
```

Expected: no violations (both naming-convention and filename-naming-convention clean).

- [ ] **Step 6: Run tests**

```bash
pnpm run test
```

Expected: all tests pass.

- [ ] **Step 7: Run build**

```bash
pnpm run build
```

Expected: clean build, dist output correct.

- [ ] **Step 8: Run smoke test**

```bash
bash scripts/smoke-test.sh
```

Expected: all CLI commands pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: rename files from camelCase to kebab-case"
```

---

## Chunk 3: Documentation

### Task 5: Update CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Naming conventions" section to CLAUDE.md**

Add a new section after "ESM import requirements" (or wherever it fits best in the document flow). Content:

```markdown
## Naming conventions

Enforced by ESLint (`@typescript-eslint/naming-convention` and `check-file/filename-naming-convention`).

| Category                      | Convention                         | Examples                                  |
| ----------------------------- | ---------------------------------- | ----------------------------------------- |
| Filenames                     | `kebab-case`                       | `argument-engine.ts`, `default-map.ts`    |
| Functions, methods, variables | `camelCase`                        | `parseFormula`, `getVariable`, `rootId`   |
| Classes                       | `PascalCase`                       | `ArgumentEngine`, `DefaultMap`            |
| Type aliases and interfaces   | `T`-prefixed `PascalCase`          | `TCoreArgument`, `TFormulaAST`, `TUUID`   |
| Type parameters               | `PascalCase` (no prefix required)  | `T`, `K`, `TExpr`, `TVar`                 |
| Enum names                    | `PascalCase`                       | `LogicalOperator`                         |
| Enum members                  | `SCREAMING_SNAKE_CASE`             | `AND`, `IMPLIES`, `MAX_ITERATIONS`        |
| True constants                | `SCREAMING_SNAKE_CASE`             | `POSITION_MIN`, `DEFAULT_CHECKSUM_CONFIG` |
| Typebox schema objects        | `PascalCase` (allowed for `const`) | `CoreArgumentSchema`, `UUID`              |

**Notes:**

- `SCREAMING_SNAKE_CASE` is for proper constants (hard-coded values, enum members), not for every `const` declaration.
- `PascalCase` is allowed for `const` variables that are Typebox schema objects or similar class-like constructors.
- Destructured variables are exempt from naming enforcement (source determines naming).
- Imports are exempt from naming enforcement (external packages control their export names).
```

- [ ] **Step 2: Update the architecture file tree in CLAUDE.md**

Update all file paths in the `Architecture` section to reflect the new kebab-case filenames. The key renames:

| Old                    | New                     |
| ---------------------- | ----------------------- |
| `argumentEngine.ts`    | `argument-engine.ts`    |
| `premiseEngine.ts`     | `premise-engine.ts`     |
| `expressionManager.ts` | `expression-manager.ts` |
| `variableManager.ts`   | `variable-manager.ts`   |
| `changeCollector.ts`   | `change-collector.ts`   |
| `defaultMap.ts`        | `default-map.ts`        |
| `versionShow.ts`       | `version-show.ts`       |
| `diffRenderer.ts`      | `diff-renderer.ts`      |

Also update any prose references to these filenames throughout the document.

- [ ] **Step 3: Update the "File naming" note under "User Preferences" in CLAUDE.md if present**

Replace any mention of "camelCase for all source files" with "kebab-case for all source files".

- [ ] **Step 4: Run lint to verify CLAUDE.md formatting**

```bash
pnpm run prettify:check
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add naming conventions section and update file paths in CLAUDE.md"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the complete check suite**

```bash
pnpm run check
```

Expected: typecheck, lint, test, and build all pass.

- [ ] **Step 2: Run smoke test**

```bash
bash scripts/smoke-test.sh
```

Expected: all CLI commands pass.

---

## Design Decisions & Edge Cases

### Schema constants stay PascalCase

Typebox schema objects (`CoreArgumentSchema`, `UUID`, `Nullable`, etc.) follow `PascalCase` naming — the standard convention across schema validation libraries (Typebox, Zod, Yup). They are NOT renamed to `SCREAMING_SNAKE_CASE` because they are complex constructed objects, not simple value constants. The ESLint rule allows `PascalCase` for all `const` variables to accommodate this.

### `UUID` const vs type

`shared.ts` exports both `const UUID` (Typebox schema) and `type UUID` (TypeScript type). Only the type is renamed to `TUUID`. The const stays as `UUID`. All current importers use `UUID` as a schema value in `Type.Object()` field definitions — no import changes needed for those files.

### Type parameters don't require T prefix

Generic type parameters (`T`, `K`, `V`, `TArg`, `TExpr`) use `PascalCase` without requiring the `T` prefix. Single-letter params like `K` and `V` (used in `DefaultMap<K, V>`) are standard and shouldn't be forced into `TK`/`TV`.

### `TDateType` class keeps its name

The class `TDateType` follows TypeBox's convention for custom type classes (`TString`, `TNumber`, etc.). It's valid `PascalCase` under the class rule. The `T` prefix happens to match our type convention, but it's the TypeBox convention driving the name.

### Breaking public API changes

Renaming `FormulaAST` → `TFormulaAST`, `UUID` type → `TUUID`, and `DateType()` → `dateType()` are breaking changes to the public API. Acceptable at version 0.2.x (pre-1.0).
