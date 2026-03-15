# Assertion → Claim Terminology Rename — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename all domain-sense occurrences of "Assertion" / "assertion" to "Claim" / "claim" across the entire codebase.

**Architecture:** Bottom-up rename in dependency order (schemata → interfaces → core → barrels → CLI → tests → docs). Each layer compiles before moving to the next. File renames use git mv. No behavioral changes.

**Tech Stack:** TypeScript, Typebox, Vitest

---

## File Structure

No new files are created. Two files are renamed:

| Before | After |
|---|---|
| `src/lib/schemata/assertion.ts` | `src/lib/schemata/claim.ts` |
| `src/lib/core/assertion-library.ts` | `src/lib/core/claim-library.ts` |

All other changes are edits to existing files.

---

## Chunk 1: Source Code Rename

### Task 1: Rename schemata layer

**Files:**
- Rename: `src/lib/schemata/assertion.ts` → `src/lib/schemata/claim.ts`
- Modify: `src/lib/schemata/claim.ts` (after rename)
- Modify: `src/lib/schemata/propositional.ts:93-116`
- Modify: `src/lib/schemata/index.ts:3`

- [ ] **Step 1: Rename the file**

```bash
git mv src/lib/schemata/assertion.ts src/lib/schemata/claim.ts
```

- [ ] **Step 2: Rename identifiers and update JSDoc in `claim.ts`**

In `src/lib/schemata/claim.ts`, replace:
- `CoreAssertionSchema` → `CoreClaimSchema`
- `"Assertion version number. Starts at 0."` → `"Claim version number. Starts at 0."`
- `"A global assertion representing propositional content. Variables reference assertions by ID and version."` → `"A global claim representing propositional content. Variables reference claims by ID and version."`
- `TCoreAssertion` → `TCoreClaim`

Full file after edits:

```typescript
import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreClaimSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number({
            description: "Claim version number. Starts at 0.",
        }),
        frozen: Type.Boolean({
            description:
                "Whether this version is frozen (immutable). Frozen versions cannot be updated.",
        }),
        checksum: Type.String({
            description: "Entity-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A global claim representing propositional content. Variables reference claims by ID and version.",
    }
)
export type TCoreClaim = Static<typeof CoreClaimSchema>
```

- [ ] **Step 3: Update variable schema in `propositional.ts`**

In `src/lib/schemata/propositional.ts`, lines 93-116, replace:
- `assertionId: UUID,` → `claimId: UUID,`
- `assertionVersion: Type.Number({` (keep as-is structurally)
- `"The version of the assertion this variable references."` → `"The version of the claim this variable references."`
- `assertionVersion` → `claimVersion`
- `"A named propositional variable belonging to a specific argument version, referencing a global assertion."` → `"A named propositional variable belonging to a specific argument version, referencing a global claim."`

The affected block (lines 93-116) becomes:

```typescript
export const CorePropositionalVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String({
            description:
                'Human-readable symbol for this variable (e.g. "P", "Q").',
        }),
        claimId: UUID,
        claimVersion: Type.Number({
            description:
                "The version of the claim this variable references.",
        }),
        checksum: Type.String({
            description: "Entity-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A named propositional variable belonging to a specific argument version, referencing a global claim.",
    }
)
```

- [ ] **Step 4: Update schemata barrel re-export**

In `src/lib/schemata/index.ts`, line 3, replace:
- `export * from "./assertion.js"` → `export * from "./claim.js"`

- [ ] **Step 5: Verify schemata layer compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Errors only in downstream files that import old names (interfaces, core, etc.) — not in schemata files themselves.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: rename assertion to claim in schemata layer"
```

---

### Task 2: Rename interfaces and types layer

**Files:**
- Modify: `src/lib/core/interfaces/library.interfaces.ts`
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts:141-153`
- Modify: `src/lib/core/interfaces/index.ts:25-30`
- Modify: `src/lib/types/checksum.ts:13-14`

- [ ] **Step 1: Update `library.interfaces.ts`**

Full file becomes:

```typescript
import type { TCoreClaim } from "../../schemata/claim.js"
import type { TCoreSource } from "../../schemata/source.js"

/** Narrow read-only interface for claim lookups. Used by ArgumentEngine for validation. */
export interface TClaimLookup<
    TClaim extends TCoreClaim = TCoreClaim,
> {
    get(id: string, version: number): TClaim | undefined
}

/** Narrow read-only interface for source lookups. Used by ArgumentEngine for validation. */
export interface TSourceLookup<TSource extends TCoreSource = TCoreSource> {
    get(id: string, version: number): TSource | undefined
}

/** Serializable snapshot of a ClaimLibrary. */
export type TClaimLibrarySnapshot<
    TClaim extends TCoreClaim = TCoreClaim,
> = {
    claims: TClaim[]
}

/** Serializable snapshot of a SourceLibrary. */
export type TSourceLibrarySnapshot<TSource extends TCoreSource = TCoreSource> =
    {
        sources: TSource[]
    }
```

- [ ] **Step 2: Update `argument-engine.interfaces.ts` lines 141-153**

Replace the `updateVariable` JSDoc and signature:

```typescript
    /**
     * Updates fields on an existing variable. Since all premises share the
     * same VariableManager, the update is immediately visible everywhere.
     *
     * @param variableId - The ID of the variable to update.
     * @param updates - Fields to update (`symbol`, `claimId`, `claimVersion`).
     *   `claimId` and `claimVersion` must be provided together.
     * @returns The updated variable, or `undefined` if not found.
     * @throws If the new symbol is already in use by a different variable.
     * @throws If the new claim reference does not exist in the claim library.
     */
    updateVariable(
        variableId: string,
        updates: {
            symbol?: string
            claimId?: string
            claimVersion?: number
        }
    ): TCoreMutationResult<TVar | undefined, TExpr, TVar, TPremise, TArg>
```

- [ ] **Step 3: Update interfaces barrel re-exports**

In `src/lib/core/interfaces/index.ts`, lines 25-30, replace:

```typescript
export type {
    TClaimLookup,
    TSourceLookup,
    TClaimLibrarySnapshot,
    TSourceLibrarySnapshot,
} from "./library.interfaces.js"
```

- [ ] **Step 4: Update checksum type**

In `src/lib/types/checksum.ts`, line 13-14, replace:
- `/** Fields to hash for assertion entities. Defaults to ["id", "version"]. */` → `/** Fields to hash for claim entities. Defaults to ["id", "version"]. */`
- `assertionFields?: Set<string>` → `claimFields?: Set<string>`

- [ ] **Step 5: Verify interfaces layer compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Errors only in core/CLI files that reference old names.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "refactor: rename assertion to claim in interfaces and types"
```

---

### Task 3: Rename core implementation layer

**Files:**
- Rename: `src/lib/core/assertion-library.ts` → `src/lib/core/claim-library.ts`
- Modify: `src/lib/core/claim-library.ts` (after rename)
- Modify: `src/lib/consts.ts:20-21,26,60`
- Modify: `src/lib/core/argument-engine.ts:4,58,96,114,137,515-568,1010-1091`
- Modify: `src/lib/core/diff.ts:30,43-55`

- [ ] **Step 1: Rename the file**

```bash
git mv src/lib/core/assertion-library.ts src/lib/core/claim-library.ts
```

- [ ] **Step 2: Rename all identifiers in `claim-library.ts`**

Apply these replacements throughout the file:
- Import: `TCoreAssertion` → `TCoreClaim`, `"../../schemata/assertion.js"` → `"../../schemata/claim.js"`
- Import: `TAssertionLookup` → `TClaimLookup`, `TAssertionLibrarySnapshot` → `TClaimLibrarySnapshot`
- Class: `AssertionLibrary` → `ClaimLibrary`
- Generic param: `TAssertion` → `TClaim` (all occurrences)
- Error messages: `"Assertion with ID"` → `"Claim with ID"`, `"Assertion \""` → `"Claim \""` (5 throw sites: create line 26, update lines 51 and 57, freeze lines 76 and 82)
- Checksum config: `assertionFields` → `claimFields`
- Snapshot: `{ assertions: this.getAll() }` → `{ claims: this.getAll() }`
- fromSnapshot: `snapshot.assertions` → `snapshot.claims`
- Method param name: `assertion` → `claim` (in `create` method)

- [ ] **Step 3: Update `consts.ts`**

In `src/lib/consts.ts`:
- Line 20: `"assertionId",` → `"claimId",`
- Line 21: `"assertionVersion",` → `"claimVersion",`
- Line 26: `assertionFields: new Set(["id", "version"]),` → `claimFields: new Set(["id", "version"]),`
- Line 60: `"assertionFields",` → `"claimFields",`

- [ ] **Step 4: Update `argument-engine.ts`**

Apply these replacements:
- Line 4: `TCoreAssertion` → `TCoreClaim` (import)
- Line 58: `TAssertionLookup` → `TClaimLookup` (import)
- Line 96: `TAssertion extends TCoreAssertion = TCoreAssertion,` → `TClaim extends TCoreClaim = TCoreClaim,`
- Line 114: `private assertionLibrary: TAssertionLookup<TAssertion>` → `private claimLibrary: TClaimLookup<TClaim>`
- Line 137: `assertionLibrary: TAssertionLookup<TAssertion>,` → `claimLibrary: TClaimLookup<TClaim>,` (constructor param)
- Constructor body: `this.assertionLibrary = assertionLibrary` → `this.claimLibrary = claimLibrary`

In `addVariable` (lines 515-525):
- `// Validate assertion reference` → `// Validate claim reference`
- `this.assertionLibrary.get(` → `this.claimLibrary.get(`
- `variable.assertionId` → `variable.claimId`
- `variable.assertionVersion` → `variable.claimVersion`
- Error: `Assertion "${variable.assertionId}" version ${variable.assertionVersion} does not exist in the assertion library.` → `Claim "${variable.claimId}" version ${variable.claimVersion} does not exist in the claim library.`

In `updateVariable` (lines 541-569):
- `assertionId?: string` → `claimId?: string`
- `assertionVersion?: number` → `claimVersion?: number`
- `const hasAssertionId = updates.assertionId !== undefined` → `const hasClaimId = updates.claimId !== undefined`
- `const hasAssertionVersion = updates.assertionVersion !== undefined` → `const hasClaimVersion = updates.claimVersion !== undefined`
- `if (hasAssertionId !== hasAssertionVersion)` → `if (hasClaimId !== hasClaimVersion)`
- Error: `"assertionId and assertionVersion must be provided together."` → `"claimId and claimVersion must be provided together."`
- `// Validate assertion reference if provided` → `// Validate claim reference if provided`
- `if (hasAssertionId && hasAssertionVersion)` → `if (hasClaimId && hasClaimVersion)`
- `this.assertionLibrary.get(` → `this.claimLibrary.get(`
- `updates.assertionId!` → `updates.claimId!`
- `updates.assertionVersion!` → `updates.claimVersion!`
- Error: `Assertion "${updates.assertionId}" version ${updates.assertionVersion} does not exist in the assertion library.` → `Claim "${updates.claimId}" version ${updates.claimVersion} does not exist in the claim library.`

In static methods `fromSnapshot` and `fromData` (lines ~1010-1091), apply the same renames:
- `TAssertion extends TCoreAssertion = TCoreAssertion` → `TClaim extends TCoreClaim = TCoreClaim`
- `assertionLibrary: TAssertionLookup<TAssertion>` → `claimLibrary: TClaimLookup<TClaim>`
- `this.assertionLibrary = assertionLibrary` → `this.claimLibrary = claimLibrary`
- All constructor calls passing `assertionLibrary` → `claimLibrary`

- [ ] **Step 5: Update `diff.ts`**

- Line 30 JSDoc: `assertionId`, and `assertionVersion`` → `` `claimId`, and `claimVersion` ``
- Line 43: `before.assertionId` → `before.claimId`, `after.assertionId` → `after.claimId`
- Line 45: `field: "assertionId"` → `field: "claimId"`
- Line 50: `before.assertionVersion` → `before.claimVersion`, `after.assertionVersion` → `after.claimVersion`
- Line 52: `field: "assertionVersion"` → `field: "claimVersion"`

- [ ] **Step 6: Verify core layer compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Errors only in barrel exports, CLI, and tests.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: rename assertion to claim in core implementation"
```

---

### Task 4: Update barrel exports

**Files:**
- Modify: `src/lib/index.ts:16`

- [ ] **Step 1: Update library barrel export**

In `src/lib/index.ts`, line 16, replace:
- `export { AssertionLibrary } from "./core/assertion-library.js"` → `export { ClaimLibrary } from "./core/claim-library.js"`

- [ ] **Step 2: Verify barrel compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Errors only in CLI and test files.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "refactor: rename assertion to claim in barrel exports"
```

---

### Task 5: Update CLI layer

**Files:**
- Modify: `src/cli/engine.ts:3,59`
- Modify: `src/cli/import.ts:11,255-276`
- Modify: `src/cli/commands/variables.ts:49-52`

- [ ] **Step 1: Update `engine.ts`**

- Line 3: `import { AssertionLibrary } from "../lib/core/assertion-library.js"` → `import { ClaimLibrary } from "../lib/core/claim-library.js"`
- Line 59: `new AssertionLibrary()` → `new ClaimLibrary()`

- [ ] **Step 2: Update `import.ts`**

- Line 11: `import { AssertionLibrary } from "../lib/core/assertion-library.js"` → `import { ClaimLibrary } from "../lib/core/claim-library.js"`
- Line 255: `const assertionLibrary = new AssertionLibrary()` → `const claimLibrary = new ClaimLibrary()`
- Line 256: `const defaultAssertion = assertionLibrary.create({ id: randomUUID() })` → `const defaultClaim = claimLibrary.create({ id: randomUUID() })`
- Lines 257-260: `assertionLibrary,` → `claimLibrary,` in constructor call
- Line 274: `assertionId: defaultAssertion.id,` → `claimId: defaultClaim.id,`
- Line 275: `assertionVersion: defaultAssertion.version,` → `claimVersion: defaultClaim.version,`

- [ ] **Step 3: Update `variables.ts`**

- Line 49: `// TODO: resolve actual assertionId from AssertionLibrary` → `// TODO: resolve actual claimId from ClaimLibrary`
- Line 50: `assertionId: "",` → `claimId: "",`
- Line 51: `assertionVersion: 0,` → `claimVersion: 0,`

- [ ] **Step 4: Verify CLI compiles**

Run: `pnpm tsc --noEmit 2>&1 | head -30`
Expected: Errors only in test files.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename assertion to claim in CLI layer"
```

---

### Task 6: Update tests

**Files:**
- Modify: `test/core.test.ts:5,77-101` + ~134 fixture occurrences
- Modify: `test/diff-renderer.test.ts`

- [ ] **Step 1: Update test imports and helpers in `core.test.ts`**

- Line 5: `AssertionLibrary,` → `ClaimLibrary,`
- Lines 77-81 (`aLib` helper):
```typescript
function aLib() {
    const lib = new ClaimLibrary()
    lib.create({ id: "assert-default" })
    return lib
}
```
(Note: the `"assert-default"` string is just a test fixture ID, not terminology — it can stay or be renamed. Rename to `"claim-default"` for consistency.)

- Lines 87-101 (`makeVar` helper):
```typescript
function makeVar(
    id: string,
    symbol: string,
    claimId = "claim-default",
    claimVersion = 0
): TVariableInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        symbol,
        claimId,
        claimVersion,
    }
}
```

- [ ] **Step 2: Rename all `assertionId` → `claimId` and `assertionVersion` → `claimVersion` in test fixtures**

Search and replace across the entire `test/core.test.ts` file:
- `assertionId` → `claimId` (all occurrences)
- `assertionVersion` → `claimVersion` (all occurrences)
- `AssertionLibrary` → `ClaimLibrary` (all occurrences)
- `"assert-default"` → `"claim-default"` (all fixture ID occurrences — for consistency)

- [ ] **Step 3: Update `diff-renderer.test.ts`**

Search and replace:
- `assertionId` → `claimId` (all occurrences)
- `assertionVersion` → `claimVersion` (all occurrences)

- [ ] **Step 4: Run full check**

Run: `pnpm run check`
Expected: All checks pass (typecheck, lint, prettier, tests, build).

- [ ] **Step 5: Fix any lint/prettier issues**

Run: `pnpm run prettify && pnpm eslint . --fix`

- [ ] **Step 6: Run check again to confirm**

Run: `pnpm run check`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor: rename assertion to claim in tests"
```

---

## Chunk 2: Documentation & Verification

### Task 7: Update documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/plans/2026-03-13-global-libraries-design.md`

- [ ] **Step 1: Update `CLAUDE.md`**

Replace all domain-sense occurrences:
- `assertionId` → `claimId`
- `assertionVersion` → `claimVersion`
- `AssertionLibrary` → `ClaimLibrary`
- `TAssertionLookup` → `TClaimLookup`
- `assertion library` → `claim library`
- `assertion` → `claim` (in design rules context, e.g., "Variables require assertion references" → "Variables require claim references")
- `Assertion and source libraries` → `Claim and source libraries`

- [ ] **Step 2: Update `docs/api-reference.md`**

Replace all occurrences:
- `AssertionLibrary` → `ClaimLibrary`
- `TAssertionLookup` → `TClaimLookup`
- `TAssertionLibrarySnapshot` → `TClaimLibrarySnapshot`
- `TCoreAssertion` → `TCoreClaim`
- `CoreAssertionSchema` → `CoreClaimSchema`
- `TAssertion` → `TClaim`
- `assertionId` → `claimId`
- `assertionVersion` → `claimVersion`
- `assertionLibrary` → `claimLibrary`
- `assertionFields` → `claimFields`
- `assertion` → `claim` (in prose, e.g., "assertion lookups" → "claim lookups", "assertion entities" → "claim entities")
- `assertions` → `claims` (e.g., snapshot field `assertions` → `claims`)
- `assertion-library.ts` → `claim-library.ts`
- `assertion.ts` → `claim.ts` (in file path references)

- [ ] **Step 3: Update `docs/plans/2026-03-13-global-libraries-design.md`**

Replace all domain-sense occurrences (same patterns as above). This is the only historical design doc being updated because it has yet to be executed.

- [ ] **Step 4: Run lint/prettier on docs**

Run: `pnpm run prettify`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: rename assertion to claim in documentation"
```

---

### Task 8: Final verification and grep sweep

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: All pass.

- [ ] **Step 2: Grep for remaining domain-sense "assertion" occurrences**

Run: `grep -ri "assertion" src/ test/ CLAUDE.md docs/api-reference.md docs/plans/2026-03-13-global-libraries-design.md --include="*.ts" --include="*.md" | grep -vi "node_modules"`

Expected: Zero results. If any remain, fix them.

- [ ] **Step 3: Grep for old file paths**

Run: `grep -r "assertion-library\|assertion\.js\|assertion\.ts" src/ test/ --include="*.ts"`

Expected: Zero results.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A && git commit -m "refactor: clean up any remaining assertion references"
```
(Only if step 2 or 3 found something.)

- [ ] **Step 5: Verify smoke test passes**

```bash
pnpm run build && bash scripts/smoke-test.sh
```
Expected: All smoke tests pass.
