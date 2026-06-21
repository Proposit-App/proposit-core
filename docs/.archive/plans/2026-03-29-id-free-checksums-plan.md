# Remove Entity IDs from Default Checksum Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove each entity's own `id` field from `DEFAULT_CHECKSUM_CONFIG` so checksums are content-based and predictable without knowing server-assigned IDs.

**Architecture:** The change is scoped to `DEFAULT_CHECKSUM_CONFIG` in `src/lib/consts.ts` and the JSDoc in `src/lib/types/checksum.ts`. All FK references (`parentId`, `variableId`, `claimId`, etc.) remain — only the entity's own `id` is removed. Tests that hardcode `"id"` in custom checksum configs are updated to use a non-ID field instead. Existing tests that compute checksums via engines will naturally pick up the new defaults; any that fail reveal hardcoded expectations to fix.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing test — checksums exclude entity `id` by default

**Files:**

- Modify: `test/core.test.ts` (append new `describe` block)

- [ ] **Step 1: Write the failing test**

Add a new `describe` block at the bottom of `test/core.test.ts`:

```typescript
describe("DEFAULT_CHECKSUM_CONFIG excludes entity id", () => {
    it("expression checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        eng1.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm1 } = eng1.createPremise()
        pm1.addExpression({
            id: "expr-AAA",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: pm1.getId(),
            parentId: null,
            position: 1,
        })

        const eng2 = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        eng2.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm2 } = eng2.createPremise()
        pm2.addExpression({
            id: "expr-BBB",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: pm2.getId(),
            parentId: null,
            position: 1,
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        const e1 = pm1.getExpression("expr-AAA")!
        const e2 = pm2.getExpression("expr-BBB")!
        expect(e1.checksum).toBe(e2.checksum)
    })

    it("variable checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        eng1.addVariable({
            id: "var-AAA",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })

        const eng2 = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        eng2.addVariable({
            id: "var-BBB",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })

        eng1.flushChecksums()
        eng2.flushChecksums()

        const v1 = eng1.getVariable("var-AAA")!
        const v2 = eng2.getVariable("var-BBB")!
        expect(v1.checksum).toBe(v2.checksum)
    })

    it("premise checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm1 } = eng1.createPremiseWithId("prem-AAA")

        const eng2 = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm2 } = eng2.createPremiseWithId("prem-BBB")

        eng1.flushChecksums()
        eng2.flushChecksums()

        expect(pm1.checksum()).toBe(pm2.checksum())
    })

    it("argument checksum does not change when id differs", () => {
        const eng1 = new ArgumentEngine(
            { id: "arg-AAA", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const eng2 = new ArgumentEngine(
            { id: "arg-BBB", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )

        eng1.flushChecksums()
        eng2.flushChecksums()

        expect(eng1.checksum()).toBe(eng2.checksum())
    })

    it("DEFAULT_CHECKSUM_CONFIG field sets do not contain 'id'", () => {
        expect(DEFAULT_CHECKSUM_CONFIG.expressionFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.variableFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.premiseFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.argumentFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.claimFields!.has("id")).toBe(false)
        expect(DEFAULT_CHECKSUM_CONFIG.sourceFields!.has("id")).toBe(false)
        expect(
            DEFAULT_CHECKSUM_CONFIG.claimSourceAssociationFields!.has("id")
        ).toBe(false)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/core.test.ts -t "DEFAULT_CHECKSUM_CONFIG excludes entity id"`
Expected: FAIL — the `DEFAULT_CHECKSUM_CONFIG` still contains `"id"` in all field sets, so checksums will differ when IDs differ and the `.has("id")` assertions will return `true`.

- [ ] **Step 3: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add failing tests for id-free default checksum config"
```

---

### Task 2: Remove `id` from `DEFAULT_CHECKSUM_CONFIG` and update JSDoc

**Files:**

- Modify: `src/lib/consts.ts:3-38`
- Modify: `src/lib/types/checksum.ts:1-19`

- [ ] **Step 1: Remove `"id"` from all field sets in `DEFAULT_CHECKSUM_CONFIG`**

In `src/lib/consts.ts`, update `DEFAULT_CHECKSUM_CONFIG` to:

```typescript
export const DEFAULT_CHECKSUM_CONFIG: Readonly<TCoreChecksumConfig> = {
    expressionFields: new Set([
        "type",
        "parentId",
        "position",
        "argumentId",
        "argumentVersion",
        "premiseId",
        "variableId",
        "operator",
    ]),
    variableFields: new Set([
        "symbol",
        "argumentId",
        "argumentVersion",
        "claimId",
        "claimVersion",
        "boundPremiseId",
        "boundArgumentId",
        "boundArgumentVersion",
    ]),
    premiseFields: new Set(["argumentId", "argumentVersion"]),
    argumentFields: new Set(["version"]),
    roleFields: new Set(["conclusionPremiseId"]),
    claimFields: new Set(["version"]),
    sourceFields: new Set(["version"]),
    claimSourceAssociationFields: new Set([
        "claimId",
        "claimVersion",
        "sourceId",
        "sourceVersion",
    ]),
}
```

Note: `roleFields` keeps `conclusionPremiseId` — it's an FK reference, not the role entity's own ID.

- [ ] **Step 2: Update JSDoc in `TCoreChecksumConfig`**

In `src/lib/types/checksum.ts`, update the JSDoc comments that mention `"id"` in default values:

```typescript
/** Configuration for which fields to include in entity checksums. */
export interface TCoreChecksumConfig {
    /** Fields to hash for expression entities. Defaults to all base expression fields except `id`. */
    expressionFields?: Set<string>
    /** Fields to hash for variable entities. Defaults to all variable fields except `id`. */
    variableFields?: Set<string>
    /** Fields to hash for premise metadata. Defaults to ["argumentId", "argumentVersion"]. */
    premiseFields?: Set<string>
    /** Fields to hash for argument metadata. Defaults to ["version"]. */
    argumentFields?: Set<string>
    /** Fields to hash for role state. Defaults to ["conclusionPremiseId"]. */
    roleFields?: Set<string>
    /** Fields to hash for claim entities. Defaults to ["version"]. */
    claimFields?: Set<string>
    /** Fields to hash for source entities. Defaults to ["version"]. */
    sourceFields?: Set<string>
    /** Fields to hash for claim-source associations. Defaults to ["claimId", "claimVersion", "sourceId", "sourceVersion"]. */
    claimSourceAssociationFields?: Set<string>
}
```

- [ ] **Step 3: Run the new tests to verify they pass**

Run: `pnpm vitest run test/core.test.ts -t "DEFAULT_CHECKSUM_CONFIG excludes entity id"`
Expected: All 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/consts.ts src/lib/types/checksum.ts
git commit -m "feat: remove entity id from default checksum field sets"
```

---

### Task 3: Fix broken existing tests

**Files:**

- Modify: `test/core.test.ts`

- [ ] **Step 1: Run full test suite and identify failures**

Run: `pnpm vitest run 2>&1 | tail -50`

Known candidate at line 5552: `checksumConfig: { argumentFields: new Set(["id"]) }` — this test verifies custom configs work. The `"id"` field is still valid in a custom config (it just isn't in the default anymore), so this test should still pass since it explicitly provides a custom config. However, if the test asserts a specific checksum value, update it.

- [ ] **Step 2: Fix each failing test**

For each failure, determine whether it:

- (a) Asserts that changing an entity's `id` changes its checksum → remove or invert the assertion
- (b) Hardcodes a specific checksum hex value that changed → recompute
- (c) Works fine with new defaults → no change needed

Apply the minimal fix for each.

- [ ] **Step 3: Run full test suite to confirm all pass**

Run: `pnpm vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts
git commit -m "test: update existing tests for id-free checksum defaults"
```

---

### Task 4: Run full checks and update docs

**Files:**

- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Run full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, test, and build all pass.

- [ ] **Step 2: Update release notes**

Add an entry to `docs/release-notes/upcoming.md`:

```markdown
- **Checksums no longer include entity IDs by default.** The `DEFAULT_CHECKSUM_CONFIG` now excludes each entity's own `id` field, making checksums content-based and predictable without knowing server-assigned IDs. All FK references (e.g., `parentId`, `variableId`, `claimId`) are still included. To restore the old behavior, pass a custom `checksumConfig` that includes `id` in the relevant field sets.
```

- [ ] **Step 3: Update changelog**

Add an entry to `docs/changelogs/upcoming.md` with the relevant commit hashes.

- [ ] **Step 4: Commit**

```bash
git add docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: document id-free checksum defaults"
```
