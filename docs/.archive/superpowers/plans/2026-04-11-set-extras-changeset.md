# Extras Mutations Produce Changesets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PremiseEngine.setExtras` produce a proper changeset, add `updateExtras` to both `PremiseEngine` and `ArgumentEngine`, and refactor the CLI `premises update` to go through the engine.

**Architecture:** Add `modifiedPremise()` to `ChangeCollector` (filling the gap between `addedPremise`/`removedPremise`). Both `PremiseEngine` and `ArgumentEngine` get symmetric `getExtras`/`setExtras`/`updateExtras` methods that produce changesets via the collector. CLI `premises update` is refactored from direct file I/O to engine-driven mutation.

**Tech Stack:** TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-04-11-set-extras-changeset-design.md`

---

### Task 1: Add `modifiedPremise()` to `ChangeCollector`

**Files:**

- Modify: `src/lib/core/change-collector.ts:60-65`

- [ ] **Step 1: Add `modifiedPremise` method**

In `src/lib/core/change-collector.ts`, add the method between `addedPremise` (line 60) and `removedPremise` (line 63):

```ts
    modifiedPremise(premise: TPremise): void {
        this.premises.modified.push(premise)
    }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add src/lib/core/change-collector.ts
git commit -m "feat: add modifiedPremise() to ChangeCollector"
```

---

### Task 2: Fix `PremiseEngine.setExtras` to produce a changeset

**Files:**

- Modify: `src/lib/core/premise-engine.ts:1115-1149`
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts:521-529`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new describe block at the bottom of `test/core.test.ts`:

```ts
// ---------------------------------------------------------------------------
// PremiseEngine.setExtras — changeset
// ---------------------------------------------------------------------------

describe("PremiseEngine.setExtras — changeset", () => {
    it("produces premises.modified with correct extras and checksums", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise()
        const { result, changes } = pm.setExtras({ title: "New Title" })

        expect(result).toEqual({ title: "New Title" })
        expect(changes.premises?.modified).toHaveLength(1)

        const modified = changes.premises!.modified[0]
        expect((modified as Record<string, unknown>).title).toBe("New Title")
        expect(modified.checksum).toBeDefined()
        expect(modified.descendantChecksum).toBeDefined()
        expect(modified.combinedChecksum).toBeDefined()
    })

    it("changeset premise checksums match toPremiseData()", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise()
        const { changes } = pm.setExtras({ title: "Test" })

        const premiseData = pm.toPremiseData()
        const modified = changes.premises!.modified[0]
        expect(modified.checksum).toBe(premiseData.checksum)
        expect(modified.descendantChecksum).toBe(premiseData.descendantChecksum)
        expect(modified.combinedChecksum).toBe(premiseData.combinedChecksum)
    })

    it("consecutive setExtras calls produce separate correct changesets", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise()

        const { changes: c1 } = pm.setExtras({ title: "First" })
        const { changes: c2 } = pm.setExtras({ title: "Second" })

        expect(
            (c1.premises!.modified[0] as Record<string, unknown>).title
        ).toBe("First")
        expect(
            (c2.premises!.modified[0] as Record<string, unknown>).title
        ).toBe("Second")

        // Checksums differ between the two
        expect(c1.premises!.modified[0].checksum).not.toBe(
            c2.premises!.modified[0].checksum
        )
    })

    it("changeset contains no expressions or variables", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise()
        eng.addVariable(makeVar("v1", "P"))
        pm.addExpression(makeVarExpr("e1", "v1", { premiseId: pm.getId() }))

        const { changes } = pm.setExtras({ title: "Test" })

        expect(changes.expressions).toBeUndefined()
        expect(changes.variables).toBeUndefined()
        expect(changes.premises?.modified).toHaveLength(1)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | grep -A 2 'setExtras.*changeset'`
Expected: FAIL — `changes` is `{}`, so `changes.premises` is `undefined`

- [ ] **Step 3: Update the interface JSDoc**

In `src/lib/core/interfaces/premise-engine.interfaces.ts`, replace the `setExtras` JSDoc (lines 521-529):

```ts
    /**
     * Replaces the premise's extra metadata record.
     *
     * @param extras - The new extras record.
     * @returns The new extras record and a changeset with the modified premise.
     */
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
```

- [ ] **Step 4: Fix `setExtras` implementation**

In `src/lib/core/premise-engine.ts`, replace the `setExtras` method (lines 1115-1149):

```ts
    public setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.withValidation(() => {
            const {
                id,
                argumentId,
                argumentVersion,
                checksum,
                descendantChecksum,
                combinedChecksum,
            } = this.premise as Record<string, unknown>
            this.premise = {
                ...extras,
                id,
                argumentId,
                argumentVersion,
                ...(checksum !== undefined ? { checksum } : {}),
                ...(descendantChecksum !== undefined
                    ? { descendantChecksum }
                    : {}),
                ...(combinedChecksum !== undefined ? { combinedChecksum } : {}),
            } as TOptionalChecksum<TPremise>
            this.markDirty()

            const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
            this.flushChecksums()
            collector.modifiedPremise(this.toPremiseData())

            this.onMutate?.()
            return { result: this.getExtras(), changes: collector.toChangeset() }
        })
    }
```

- [ ] **Step 5: Update the existing test that asserts empty changes**

In `test/core.test.ts`, find the test at line 5273 ("setExtras returns new extras with empty changes"). Replace the assertion:

```ts
it("setExtras returns new extras with changeset", () => {
    const eng = new ArgumentEngine(
        { id: "arg1", version: 0 },
        aLib(),
        sLib(),
        csLib()
    )
    const { result: pm } = eng.createPremise()
    const { result, changes } = pm.setExtras({ title: "Test" })
    expect(result).toEqual({ title: "Test" })
    expect(changes.premises?.modified).toHaveLength(1)
})
```

- [ ] **Step 6: Run tests**

Run: `pnpm run test`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/interfaces/premise-engine.interfaces.ts test/core.test.ts
git commit -m "feat: PremiseEngine.setExtras produces changeset with modified premise"
```

---

### Task 3: Add `PremiseEngine.updateExtras`

**Files:**

- Modify: `src/lib/core/premise-engine.ts` (after `setExtras`)
- Modify: `src/lib/core/interfaces/premise-engine.interfaces.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new describe block at the bottom of `test/core.test.ts`:

```ts
// ---------------------------------------------------------------------------
// PremiseEngine.updateExtras
// ---------------------------------------------------------------------------

describe("PremiseEngine.updateExtras", () => {
    it("merges into existing extras", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise({ a: "1", b: "2" })
        const { result } = pm.updateExtras({ c: "3" })

        expect(result).toEqual({ a: "1", b: "2", c: "3" })
        expect(pm.getExtras()).toEqual({ a: "1", b: "2", c: "3" })
    })

    it("produces a changeset with premises.modified", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise()
        const { changes } = pm.updateExtras({ title: "Hello" })

        expect(changes.premises?.modified).toHaveLength(1)
        const modified = changes.premises!.modified[0]
        expect((modified as Record<string, unknown>).title).toBe("Hello")
        expect(modified.checksum).toBe(pm.toPremiseData().checksum)
    })

    it("overlapping keys overwrite existing values", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        const { result: pm } = eng.createPremise({ title: "Old" })
        const { result } = pm.updateExtras({ title: "New" })

        expect(result).toEqual({ title: "New" })
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | grep -A 2 'updateExtras'`
Expected: FAIL — `updateExtras` is not a function

- [ ] **Step 3: Add interface declaration**

In `src/lib/core/interfaces/premise-engine.interfaces.ts`, add `updateExtras` to the `TPremiseIdentity` interface, after `setExtras` (before the closing brace at line 530):

```ts
    /**
     * Shallow-merges updates into the premise's existing extras.
     *
     * @param updates - Key-value pairs to merge into the current extras.
     * @returns The merged extras record and a changeset with the modified premise.
     */
    updateExtras(
        updates: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
```

- [ ] **Step 4: Implement `updateExtras`**

In `src/lib/core/premise-engine.ts`, add the method immediately after `setExtras`:

```ts
    public updateExtras(
        updates: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.setExtras({ ...this.getExtras(), ...updates })
    }
```

- [ ] **Step 5: Run tests**

Run: `pnpm run test`
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/core/premise-engine.ts src/lib/core/interfaces/premise-engine.interfaces.ts test/core.test.ts
git commit -m "feat: add PremiseEngine.updateExtras with changeset"
```

---

### Task 4: Add `ArgumentEngine.getExtras`, `setExtras`, `updateExtras`

**Files:**

- Modify: `src/lib/core/argument-engine.ts` (after `getArgument`, around line 501)
- Modify: `src/lib/core/interfaces/argument-engine.interfaces.ts:446-458`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new describe block at the bottom of `test/core.test.ts`:

```ts
// ---------------------------------------------------------------------------
// ArgumentEngine — extras
// ---------------------------------------------------------------------------

describe("ArgumentEngine — extras", () => {
    it("getExtras returns non-structural fields", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0, title: "My Argument" },
            aLib(),
            sLib(),
            csLib()
        )
        const extras = eng.getExtras()
        expect(extras).toEqual({ title: "My Argument" })
        expect(extras).not.toHaveProperty("id")
        expect(extras).not.toHaveProperty("version")
        expect(extras).not.toHaveProperty("checksum")
    })

    it("setExtras replaces all extras and produces changeset", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0, title: "Old", description: "Desc" },
            aLib(),
            sLib(),
            csLib()
        )
        const { result, changes } = eng.setExtras({ title: "New" })

        expect(result).toEqual({ title: "New" })
        expect(result).not.toHaveProperty("description")
        expect(eng.getExtras()).toEqual({ title: "New" })
        expect(changes.argument).toBeDefined()
        expect((changes.argument as Record<string, unknown>).title).toBe("New")
        expect(changes.argument!.checksum).toBe(eng.getArgument().checksum)
    })

    it("updateExtras merges and produces changeset", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0, title: "Title", description: "Desc" },
            aLib(),
            sLib(),
            csLib()
        )
        const { result, changes } = eng.updateExtras({ title: "Updated" })

        expect(result).toEqual({ title: "Updated", description: "Desc" })
        expect(changes.argument).toBeDefined()
        expect(changes.argument!.checksum).toBe(eng.getArgument().checksum)
    })

    it("structural fields cannot be shadowed by extras", () => {
        const eng = new ArgumentEngine(
            { id: "arg1", version: 0 },
            aLib(),
            sLib(),
            csLib()
        )
        eng.setExtras({ id: "hacked", version: 999 })

        const arg = eng.getArgument()
        expect(arg.id).toBe("arg1")
        expect(arg.version).toBe(0)
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run test -- --reporter verbose 2>&1 | grep -A 2 'ArgumentEngine.*extras'`
Expected: FAIL — `getExtras` is not a function

- [ ] **Step 3: Add interface declarations**

In `src/lib/core/interfaces/argument-engine.interfaces.ts`, expand the `TArgumentIdentity` interface (lines 447-458):

```ts
/**
 * Argument entity access and extras mutation.
 */
export interface TArgumentIdentity<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
> {
    /**
     * Returns a shallow copy of the argument metadata with checksum
     * attached.
     *
     * @returns The argument entity.
     */
    getArgument(): TArg
    /**
     * Returns the argument's extra metadata record (all fields except
     * id, version, and checksums).
     *
     * @returns The extras record.
     */
    getExtras(): Record<string, unknown>
    /**
     * Replaces the argument's extra metadata record.
     *
     * @param extras - The new extras record.
     * @returns The new extras record and a changeset with the modified argument.
     */
    setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
    /**
     * Shallow-merges updates into the argument's existing extras.
     *
     * @param updates - Key-value pairs to merge into the current extras.
     * @returns The merged extras record and a changeset with the modified argument.
     */
    updateExtras(
        updates: Record<string, unknown>
    ): TCoreMutationResult<Record<string, unknown>, TExpr, TVar, TPremise, TArg>
}
```

Note: `TArgumentIdentity` gains three generic parameters (`TPremise`, `TExpr`, `TVar`) because `TCoreMutationResult` requires them. Check any consumers of this interface (the barrel export at `src/lib/core/interfaces/index.ts` re-exports it, and `ArgumentEngine` implements it) — since all new generics have defaults, existing code using `TArgumentIdentity<TArg>` continues to compile.

- [ ] **Step 4: Add `TCoreMutationResult` import to the interface file**

In `src/lib/core/interfaces/argument-engine.interfaces.ts`, add the import (it's already imported in argument-engine.ts but the interface file needs it too). Check the existing imports at the top of the file and add:

```ts
import type { TCoreMutationResult } from "../../types/mutation.js"
```

Also ensure `TCorePremise`, `TCorePropositionalExpression`, and `TCorePropositionalVariable` are imported. They may already be imported — check and add any missing ones.

- [ ] **Step 5: Implement the three methods on `ArgumentEngine`**

In `src/lib/core/argument-engine.ts`, add after `getArgument()` (after line 501):

```ts
    public getExtras(): Record<string, unknown> {
        const {
            id: _id,
            version: _version,
            checksum: _checksum,
            descendantChecksum: _descendantChecksum,
            combinedChecksum: _combinedChecksum,
            ...extras
        } = this.argument as Record<string, unknown>
        return { ...extras }
    }

    public setExtras(
        extras: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        const { id, version, checksum, descendantChecksum, combinedChecksum } =
            this.argument as Record<string, unknown>
        this.argument = {
            ...extras,
            id,
            version,
            ...(checksum !== undefined ? { checksum } : {}),
            ...(descendantChecksum !== undefined
                ? { descendantChecksum }
                : {}),
            ...(combinedChecksum !== undefined ? { combinedChecksum } : {}),
        } as TOptionalChecksum<TArg>
        this.markDirty()

        const collector = new ChangeCollector<TExpr, TVar, TPremise, TArg>()
        this.flushChecksums()
        collector.setArgument(this.getArgument())

        return { result: this.getExtras(), changes: collector.toChangeset() }
    }

    public updateExtras(
        updates: Record<string, unknown>
    ): TCoreMutationResult<
        Record<string, unknown>,
        TExpr,
        TVar,
        TPremise,
        TArg
    > {
        return this.setExtras({ ...this.getExtras(), ...updates })
    }
```

- [ ] **Step 6: Run tests**

Run: `pnpm run test`
Expected: PASS (all tests)

- [ ] **Step 7: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/core/argument-engine.ts src/lib/core/interfaces/argument-engine.interfaces.ts test/core.test.ts
git commit -m "feat: add ArgumentEngine.getExtras/setExtras/updateExtras with changesets"
```

---

### Task 5: Refactor CLI `premises update` to use engine

**Files:**

- Modify: `src/cli/commands/premises.ts:201-233`

- [ ] **Step 1: Refactor the `premises update` command**

In `src/cli/commands/premises.ts`, replace the `update` action (lines 206-232):

```ts
;async (premiseId: string, opts: { title?: string; clearTitle?: boolean }) => {
    await assertNotPublished(argumentId, version)
    if (opts.title !== undefined && opts.clearTitle) {
        errorExit("--title and --clear-title cannot both be specified.")
    }

    const engine = await hydrateEngine(argumentId, version)
    const pm = engine.getPremise(premiseId)
    if (!pm) {
        errorExit(`Premise "${premiseId}" not found.`)
    }

    try {
        if (opts.clearTitle) {
            const extras = pm.getExtras()
            delete extras.title
            pm.setExtras(extras)
        } else if (opts.title !== undefined) {
            pm.updateExtras({ title: opts.title })
        } else {
            errorExit("No updates specified. Use --title or --clear-title.")
        }
    } catch (err) {
        errorExit(err instanceof Error ? err.message : String(err))
    }

    await persistEngine(engine)
    printLine("success")
}
```

- [ ] **Step 2: Remove unused `writePremiseMeta` import**

In `src/cli/commands/premises.ts`, remove `writePremiseMeta` from the import on line 20 — it was only used by the update command (line 230). Keep `readPremiseMeta` (used by list/show/eval at lines 95, 244, 280) and `premiseExists` (used by delete/show/eval at lines 182, 240, 274).

- [ ] **Step 3: Build and run smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: Build succeeds. Smoke test passes (or shows pre-existing failures only).

- [ ] **Step 4: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build all pass)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/premises.ts
git commit -m "refactor: route CLI premises update through engine"
```

---

### Task 6: Documentation updates

**Files:**

- Modify: `docs/api-reference.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/changelogs/upcoming.md`

- [ ] **Step 1: Update API reference**

In `docs/api-reference.md`, find the `PremiseEngine` section and add `updateExtras` documentation. Update `setExtras` to note it now produces a changeset.

Find the `ArgumentEngine` section and add `getExtras`, `setExtras`, `updateExtras` documentation.

- [ ] **Step 2: Update release notes**

In `docs/release-notes/upcoming.md`, add an entry:

```markdown
- **`setExtras` now produces changesets** — `PremiseEngine.setExtras()` now returns a proper changeset with the modified premise in `changes.premises.modified`, enabling consumers to persist premise metadata changes through the standard changeset pipeline.
- **New `updateExtras` method** — Both `PremiseEngine` and `ArgumentEngine` now have `updateExtras()` for partial (shallow-merge) extras updates with full changeset support.
- **New `ArgumentEngine` extras methods** — `ArgumentEngine` now exposes `getExtras()`, `setExtras()`, and `updateExtras()` for symmetric metadata handling with premises.
```

- [ ] **Step 3: Update changelog**

In `docs/changelogs/upcoming.md`, add entries covering the commits from this plan.

- [ ] **Step 4: Run lint/format**

Run: `pnpm run prettify && pnpm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docs/api-reference.md docs/release-notes/upcoming.md docs/changelogs/upcoming.md
git commit -m "docs: API reference, release notes, and changelog for extras changesets"
```

---

### Task 7: Delete change request and final verification

**Files:**

- Delete: `docs/change-requests/2026-04-11-set-extras-changeset.md`

- [ ] **Step 1: Delete the change request file**

```bash
git rm docs/change-requests/2026-04-11-set-extras-changeset.md
```

- [ ] **Step 2: Run full check**

Run: `pnpm run check`
Expected: PASS (typecheck, lint, test, build)

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove completed change request for setExtras changeset"
```
