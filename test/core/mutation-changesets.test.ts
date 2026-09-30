import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    PremiseEngine,
    mergeChangesets,
} from "../../src/lib/index"
import {
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../../src/lib/schemata"
import { ChangeCollector } from "../../src/lib/core/change-collector"
import type { TExpressionInput } from "../../src/lib/core/expression-manager"
import type { TCoreChangeset } from "../../src/lib/types/mutation"
import { aLib } from "./fixtures"

describe("ChangeCollector", () => {
    it("starts with an empty changeset", () => {
        const collector = new ChangeCollector()
        const cs = collector.toChangeset()
        expect(cs).toEqual({})
    })

    it("collects added expressions", () => {
        const collector = new ChangeCollector()
        const expr = {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 0,
            checksum: "x",
        } as TCorePropositionalExpression
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.expressions?.added).toEqual([expr])
        expect(cs.expressions?.modified).toEqual([])
        expect(cs.expressions?.removed).toEqual([])
    })

    it("collects modified and removed expressions", () => {
        const collector = new ChangeCollector()
        const modified = {
            id: "e1",
            type: "variable",
            checksum: "x",
        } as TCorePropositionalExpression
        const removed = {
            id: "e2",
            type: "operator",
            checksum: "x",
        } as TCorePropositionalExpression
        collector.modifiedExpression(modified)
        collector.removedExpression(removed)
        const cs = collector.toChangeset()
        expect(cs.expressions?.added).toEqual([])
        expect(cs.expressions?.modified).toEqual([modified])
        expect(cs.expressions?.removed).toEqual([removed])
    })

    it("collects variable changes", () => {
        const collector = new ChangeCollector()
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "a1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
            checksum: "x",
        } as TCorePropositionalVariable
        collector.addedVariable(v)
        const cs = collector.toChangeset()
        expect(cs.variables?.added).toEqual([v])
        expect(cs.expressions).toBeUndefined()
    })

    it("collects premise changes", () => {
        const collector = new ChangeCollector()
        const p = {
            id: "p1",
            argumentId: "a1",
            argumentVersion: 0,
            variables: [],
            expressions: [],
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
            type: "freeform" as const,
        } as TCorePremise
        collector.addedPremise(p)
        const cs = collector.toChangeset()
        expect(cs.premises?.added).toEqual([p])
    })

    it("records role state changes", () => {
        const collector = new ChangeCollector()
        const roles = {
            conclusionPremiseId: "p1",
        }
        collector.setRoles(roles)
        const cs = collector.toChangeset()
        expect(cs.roles).toEqual(roles)
    })

    it("omits unchanged categories from changeset", () => {
        const collector = new ChangeCollector()
        const expr = { id: "e1", checksum: "x" } as TCorePropositionalExpression
        collector.addedExpression(expr)
        const cs = collector.toChangeset()
        expect(cs.variables).toBeUndefined()
        expect(cs.premises).toBeUndefined()
        expect(cs.roles).toBeUndefined()
        expect(cs.argument).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine — mutation changesets
// ---------------------------------------------------------------------------

describe("PremiseEngine — mutation changesets", () => {
    function setup() {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const v1 = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const v2 = {
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        eng.addVariable(v1)
        eng.addVariable(v2)
        const { result: pm } = eng.createPremise()
        return { eng, pm, v1, v2 }
    }

    it("addExpression returns the added expression in result and changes", () => {
        const { pm } = setup()
        const expr: TExpressionInput = {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        }
        const { result, changes } = pm.addExpression(expr)
        expect(result.id).toBe("e1")
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e1")
        expect(changes.expressions?.modified).toEqual([])
        expect(changes.expressions?.removed).toEqual([])
    })

    // A single mutation produces a single changeset reflecting only
    // that mutation; AN runs as a separate post-hook pass, so
    // removeExpression's changeset holds no collapse changes. The
    // collapse contract is covered by `test/grammar/an-rules.test.ts`.

    it("insertExpression returns added expression and records reparented children", () => {
        const { pm } = setup()
        // Build: and(v1, v2), then insert formula wrapping v1
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })
        // Insert a formula node wrapping e1
        const { result, changes } = pm.insertExpression(
            {
                id: "f1",
                type: "formula",
                argumentId: "arg1",
                argumentVersion: 0,
                premiseId: "premise-1",
                parentId: "and1",
                position: 1,
            },
            "e1"
        )
        expect(result.id).toBe("f1")
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("f1")
        // e1 was reparented under f1
        expect(changes.expressions?.modified?.length).toBeGreaterThanOrEqual(1)
        const modifiedE1 = changes.expressions?.modified?.find(
            (e) => e.id === "e1"
        )
        expect(modifiedE1?.parentId).toBe("f1")
    })

    it("appendExpression returns expression with computed position", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        const { result, changes } = pm.appendExpression("and1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
        })
        expect(result.id).toBe("e2")
        expect(result.position).toBeGreaterThan(1) // computed position after e1
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e2")
    })

    it("addExpressionRelative returns expression with computed position", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 3,
        })
        const { result, changes } = pm.addExpressionRelative("e1", "after", {
            id: "e3",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
        })
        expect(result.id).toBe("e3")
        // Should be between e1 (pos 1) and e2 (pos 3)
        expect(result.position).toBeGreaterThan(1)
        expect(result.position).toBeLessThan(3)
        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e3")
    })

    it("removeExpression for non-existent ID returns undefined result and empty changes", () => {
        const { pm } = setup()
        const { result, changes } = pm.removeExpression("nonexistent", true)
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("addVariable returns the variable in result and changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const { result, changes } = eng.addVariable(v)
        expect(result.id).toBe("v1")
        expect(result.symbol).toBe("P")
        expect(changes.variables?.added).toHaveLength(1)
        expect(changes.variables?.added[0].id).toBe("v1")
    })

    it("removeVariable returns removed variable in result and changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const v = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        eng.addVariable(v)
        const { result, changes } = eng.removeVariable("v1")
        expect(result?.id).toBe("v1")
        expect(changes.variables?.removed).toHaveLength(1)
        expect(changes.variables?.removed[0].id).toBe("v1")
    })

    it("removeVariable for non-existent variable returns undefined with empty changes", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("setExtras returns new extras with changeset", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = eng.createPremise()
        const { result, changes } = pm.setExtras({ title: "Test" })
        expect(result).toEqual({ title: "Test" })
        expect(changes.premises?.modified).toHaveLength(1)
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine — mutation changesets
// ---------------------------------------------------------------------------

describe("ArgumentEngine — mutation changesets", () => {
    it("createPremise returns PremiseEngine and records added premise", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm, changes } = eng.createPremise()
        expect(pm).toBeInstanceOf(PremiseEngine)
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe(pm.getId())
    })

    it("createPremiseWithId returns PremiseEngine with specified ID", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm, changes } = eng.createPremiseWithId("my-premise")
        expect(pm.getId()).toBe("my-premise")
        expect(changes.premises?.added).toHaveLength(1)
        expect(changes.premises?.added[0].id).toBe("my-premise")
    })

    it("removePremise returns premise data and records removal", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremise()
        const premiseId = eng.listPremiseIds()[0]
        const { result, changes } = eng.removePremise(premiseId)
        expect(result?.id).toBe(premiseId)
        expect(changes.premises?.removed).toHaveLength(1)
        expect(changes.premises?.removed[0].id).toBe(premiseId)
    })

    it("removePremise that was conclusion also records role change", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())
        const { changes } = eng.removePremise(pm.getId())
        expect(changes.roles).toBeDefined()
        expect(changes.roles?.conclusionPremiseId).toBeUndefined()
    })

    it("removePremise for non-existent ID returns undefined", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result, changes } = eng.removePremise("nope")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("setConclusionPremise returns new role state", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = eng.createPremise()
        const { result, changes } = eng.setConclusionPremise(pm.getId())
        expect(result.conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("clearConclusionPremise on a zero-premise argument is allowed (vacuous invariant)", () => {
        // On an empty argument the invariant ("non-empty argument
        // always has a conclusion") is vacuously satisfied, so the
        // original clear semantics still apply — the call doesn't
        // refuse and the conclusionPremiseId stays undefined.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        // Build state then drain so the engine has touched the
        // conclusion role at least once, then verify clearing on
        // the zero-premise post-state is permitted.
        const { result: pm } = eng.createPremise()
        eng.removePremise(pm.getId())
        const { result, changes } = eng.clearConclusionPremise()
        expect(result.conclusionPremiseId).toBeUndefined()
        // Changes may be empty (already undefined from removePremise);
        // what matters is the call doesn't refuse / throw on the
        // zero-premise path.
        expect(changes).toBeDefined()
    })

    it("clearConclusionPremise on a non-empty argument is a no-op (invariant guard)", () => {
        // Invariant guard: a non-empty argument always has a
        // conclusion designated. clearConclusionPremise on a
        // non-empty argument refuses to clear; the call returns the
        // current (unchanged) role state with an empty changeset.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())
        const before = eng.getRoleState().conclusionPremiseId
        const { result, changes } = eng.clearConclusionPremise()
        // Engine still considers pm the conclusion.
        expect(result.conclusionPremiseId).toBe(before)
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm.getId())
        // No-op produces an empty changeset (no roles key, no other
        // mutations).
        expect(changes.roles).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// Stale parent checksums in changeset
// ---------------------------------------------------------------------------

describe("Changeset includes ancestor checksum updates", () => {
    function setup() {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const v1 = {
            id: "v1",
            symbol: "P",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const v2 = {
            id: "v2",
            symbol: "Q",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        const v3 = {
            id: "v3",
            symbol: "R",
            argumentId: "arg1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        }
        eng.addVariable(v1)
        eng.addVariable(v2)
        eng.addVariable(v3)
        const { result: pm } = eng.createPremise()
        return { eng, pm, v1, v2, v3 }
    }

    it("addExpression with parentId includes parent in modified", () => {
        const { pm } = setup()
        // Create root operator
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        // Now add a second child — and1's descendantChecksum must change
        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e2")

        // and1 should appear in modified with updated checksums
        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")

        const modifiedAnd = changes.expressions!.modified.find(
            (e) => e.id === "and1"
        )!
        // Verify the changeset checksum matches the in-memory state
        const inMemoryAnd = pm.getExpression("and1")!
        expect(modifiedAnd.descendantChecksum).toBe(
            inMemoryAnd.descendantChecksum
        )
        expect(modifiedAnd.combinedChecksum).toBe(inMemoryAnd.combinedChecksum)
    })

    it("addExpression includes all ancestors up to root in modified", () => {
        const { pm } = setup()
        // Build: implies(formula(and(v1)))
        pm.addExpression({
            id: "impl",
            type: "operator",
            operator: "implies",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "f1",
            type: "formula",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "impl",
            position: 1,
        })
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "f1",
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })

        // Adding a new child to and1 should mark and1, f1, and impl as modified
        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        expect(changes.expressions?.added).toHaveLength(1)
        expect(changes.expressions?.added[0].id).toBe("e2")

        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")
        expect(modifiedIds).toContain("f1")
        expect(modifiedIds).toContain("impl")
    })

    it("appendExpression includes parent in modified", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })

        const { changes } = pm.appendExpression("and1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
        })

        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")
    })

    it("addExpressionRelative includes ancestors in modified", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 3,
        })

        const { changes } = pm.addExpressionRelative("e1", "after", {
            id: "e3",
            type: "variable",
            variableId: "v3",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
        })

        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("and1")
    })

    it("modified expressions have correct checksums (not stale pre-flush values)", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })

        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        const modifiedAnd = (changes.expressions?.modified ?? []).find(
            (e) => e.id === "and1"
        )
        expect(modifiedAnd).toBeDefined()

        // The changeset's checksums should match the engine's in-memory state exactly
        const inMemory = pm.getExpression("and1")!
        expect(modifiedAnd!.checksum).toBe(inMemory.checksum)
        expect(modifiedAnd!.descendantChecksum).toBe(
            inMemory.descendantChecksum
        )
        expect(modifiedAnd!.combinedChecksum).toBe(inMemory.combinedChecksum)
    })

    it("added expressions are NOT duplicated in modified", () => {
        const { pm } = setup()
        pm.addExpression({
            id: "and1",
            type: "operator",
            operator: "and",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: null,
            position: 1,
        })
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 1,
        })

        const { changes } = pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg1",
            argumentVersion: 0,
            premiseId: "premise-1",
            parentId: "and1",
            position: 2,
        })

        const addedIds = (changes.expressions?.added ?? []).map((e) => e.id)
        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )

        // e2 should only appear in added, not in modified
        expect(addedIds).toContain("e2")
        expect(modifiedIds).not.toContain("e2")
    })
})

describe("mergeChangesets", () => {
    it("merges two empty changesets", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result).toEqual({})
    })

    it("deduplicates by id with last-write-wins", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "old",
                        descendantChecksum: null,
                        combinedChecksum: "old",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "new",
                        descendantChecksum: null,
                        combinedChecksum: "new",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.expressions?.added[0].checksum).toBe("new")
    })

    it("merges different entity categories independently", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "var1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions?.added).toHaveLength(1)
        expect(result.variables?.added).toHaveLength(1)
    })

    it("throws when an entity appears in both added and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/added and removed/)
    })

    it("throws when an entity appears in both added and modified", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c2",
                        descendantChecksum: null,
                        combinedChecksum: "c2",
                    },
                ],
                removed: [],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/added and modified/)
    })

    it("throws when an entity appears in both modified and removed", () => {
        const a: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            expressions: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "e1",
                        type: "variable",
                        variableId: "v1",
                        argumentId: "a",
                        argumentVersion: 0,
                        premiseId: "p1",
                        parentId: null,
                        position: 1,
                        checksum: "c",
                        descendantChecksum: null,
                        combinedChecksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/modified and removed/)
    })

    it("throws when a variable appears in both added and removed", () => {
        const a: TCoreChangeset = {
            variables: {
                added: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
                modified: [],
                removed: [],
            },
        }
        const b: TCoreChangeset = {
            variables: {
                added: [],
                modified: [],
                removed: [
                    {
                        id: "v1",
                        symbol: "P",
                        argumentId: "a",
                        argumentVersion: 0,
                        claimId: "cl",
                        claimVersion: 0,
                        checksum: "c",
                    },
                ],
            },
        }
        expect(() => mergeChangesets(a, b)).toThrow(/variables/)
    })

    it("takes roles from b when present", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = { roles: { conclusionPremiseId: "p2" } }
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p2")
    })

    it("keeps roles from a when b has none", () => {
        const a: TCoreChangeset = { roles: { conclusionPremiseId: "p1" } }
        const b: TCoreChangeset = {}
        const result = mergeChangesets(a, b)
        expect(result.roles?.conclusionPremiseId).toBe("p1")
    })

    it("takes argument from b when present", () => {
        const a: TCoreChangeset = {
            argument: { id: "a1", version: 0 } as TCoreArgument,
        }
        const b: TCoreChangeset = {
            argument: { id: "a1", version: 1 } as TCoreArgument,
        }
        const result = mergeChangesets(a, b)
        expect(result.argument?.version).toBe(1)
    })

    it("omits empty entity categories from result", () => {
        const a: TCoreChangeset = {}
        const b: TCoreChangeset = {
            expressions: { added: [], modified: [], removed: [] },
        }
        const result = mergeChangesets(a, b)
        expect(result.expressions).toBeUndefined()
    })
})
