import { describe, expect, it } from "vitest"
import { ArgumentEngine, ClaimLibrary } from "../../src/lib/index"
import {
    isClaimBound,
    isPremiseBound,
    type TClaimBoundVariable,
    type TPremiseBoundVariable,
    type TCorePropositionalVariable,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import { defaultCompareVariable } from "../../src/lib/core/diff"

// ---------------------------------------------------------------------------
// Premise-variable associations — type guards
// ---------------------------------------------------------------------------

describe("Premise-variable associations — type guards", () => {
    it("isClaimBound returns true for claim-bound variable", () => {
        const v: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        }
        expect(isClaimBound(v)).toBe(true)
        expect(isPremiseBound(v)).toBe(false)
    })
    it("isPremiseBound returns true for premise-bound variable", () => {
        const v: TCorePropositionalVariable = {
            id: "v2",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        expect(isPremiseBound(v)).toBe(true)
        expect(isClaimBound(v)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — VariableManager.updateVariable generalized
// ---------------------------------------------------------------------------

describe("Premise-variable associations — VariableManager.updateVariable generalized", () => {
    it("applies non-symbol fields via VariableManager directly", () => {
        const vm = new VariableManager<TCorePropositionalVariable>()
        vm.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        })
        const updated = vm.updateVariable("v1", {
            claimId: "c2",
        } as Partial<TCorePropositionalVariable>)
        expect(updated).toBeDefined()
        expect((updated as TClaimBoundVariable).claimId).toBe("c2")
    })
    it("applies non-symbol fields through ArgumentEngine", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        claimLibrary.create({ id: "c2", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.addVariable({
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
        })
        const result = engine.updateVariable("v1", {
            claimId: "c2",
            claimVersion: 0,
        })
        expect(result).toBeDefined()
        const updated = engine.getVariable("v1")! as TClaimBoundVariable
        expect(updated.claimId).toBe("c2")
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — addVariable type guard
// ---------------------------------------------------------------------------

describe("Premise-variable associations — addVariable type guard", () => {
    it("rejects premise-bound variable passed to addVariable", () => {
        const claimLibrary = new ClaimLibrary()
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        expect(() =>
            engine.addVariable({
                id: "v1",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "p1",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            } as unknown as TOptionalChecksum<TClaimBoundVariable>)
        ).toThrow(/claim-bound/)
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — bindVariableToPremise
// ---------------------------------------------------------------------------

describe("Premise-variable associations — bindVariableToPremise", () => {
    function makeEngine() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        return engine
    }

    it("creates a premise-bound variable", () => {
        const engine = makeEngine()
        const result = engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        expect(result).toBeDefined()
        const v = engine.getVariable("vQ")
        expect(v).toBeDefined()
        expect(isPremiseBound(v!)).toBe(true)
    })

    it("rejects binding to non-existent premise", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "nonexistent",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("rejects duplicate symbol", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "A",
                boundPremiseId: "p1",
                boundArgumentId: "a1",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("rejects cross-argument binding", () => {
        const engine = makeEngine()
        expect(() =>
            engine.bindVariableToPremise({
                id: "vQ",
                argumentId: "a1",
                argumentVersion: 0,
                symbol: "Q",
                boundPremiseId: "p1",
                boundArgumentId: "other-arg",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("allows multiple variables bound to same premise", () => {
        const engine = makeEngine()
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        expect(engine.getVariable("vQ")).toBeDefined()
        expect(engine.getVariable("vR")).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — getVariablesBoundToPremise
// ---------------------------------------------------------------------------

describe("Premise-variable associations — getVariablesBoundToPremise", () => {
    it("returns variables bound to a specific premise", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const bound = engine.getVariablesBoundToPremise("p1")
        expect(bound).toHaveLength(3) // auto-P0 + vQ + vR
        expect(bound.map((v) => v.id).sort()).toContain("vQ")
        expect(bound.map((v) => v.id).sort()).toContain("vR")
        expect(engine.getVariablesBoundToPremise("p2")).toHaveLength(1) // auto-P1
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — removePremise cascade
// ---------------------------------------------------------------------------

describe("Premise-variable associations — removePremise cascade", () => {
    it("removes bound variables when their target premise is removed", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to premise 2's expression tree
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        // Remove p1 — should cascade: remove vQ, which cascades to remove e1 from p2
        engine.removePremise("p1")

        expect(engine.getVariable("vQ")).toBeUndefined()
        expect(p2.getExpressions()).toHaveLength(0)
        expect(engine.getVariable("vA")).toBeDefined()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — circularity prevention
// ---------------------------------------------------------------------------

describe("Premise-variable associations — circularity prevention", () => {
    function makeEngineWithBinding() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        return engine
    }

    it("rejects adding a variable expression to the premise it is bound to", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!
        expect(() =>
            p1.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p1",
                parentId: null,
                type: "variable",
                variableId: "vQ",
            })
        ).toThrow(/circular/i)
    })

    it("allows adding a variable expression to a different premise", () => {
        const engine = makeEngineWithBinding()
        const p2 = engine.getPremise("p2")!
        expect(() =>
            p2.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p2",
                parentId: null,
                type: "variable",
                variableId: "vQ",
            })
        ).not.toThrow()
    })

    it("rejects repointing a variable expression at the premise's own bound variable", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vA",
        })
        expect(() => p1.updateExpression("e1", { variableId: "vQ" })).toThrow(
            /circular/i
        )
        expect(p1.getExpression("e1")!).toMatchObject({ variableId: "vA" })
    })

    it("allows adding a claim-bound variable expression to any premise", () => {
        const engine = makeEngineWithBinding()
        const p1 = engine.getPremise("p1")!
        expect(() =>
            p1.appendExpression(null, {
                id: "e1",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p1",
                parentId: null,
                type: "variable",
                variableId: "vA",
            })
        ).not.toThrow()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — transitive circularity
// ---------------------------------------------------------------------------

describe("Premise-variable associations — transitive circularity", () => {
    it("rejects indirect cycles through binding chain", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Q bound to p1, R bound to p2
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        engine.bindVariableToPremise({
            id: "vR",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "R",
            boundPremiseId: "p2",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add R to p1's tree (R is bound to p2, this is fine)
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vR",
        })

        // Now try to add Q to p2 — Q bound to p1, which contains R, which is bound to p2
        // Transitive cycle: adding Q to p2 means p2 depends on Q → p1 → R → p2
        const p2 = engine.getPremise("p2")!
        expect(() =>
            p2.appendExpression(null, {
                id: "e2",
                argumentId: "a1",
                argumentVersion: 0,
                premiseId: "p2",
                parentId: null,
                type: "variable",
                variableId: "vQ",
            })
        ).toThrow(/circular/i)

        // The same cycle reached by repointing an existing expression.
        p2.appendExpression(null, {
            id: "e2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vA",
        })
        expect(() => p2.updateExpression("e2", { variableId: "vQ" })).toThrow(
            /circular/i
        )
        expect(p2.getExpression("e2")!).toMatchObject({ variableId: "vA" })
    })
})

describe("Premise-variable associations — evaluation filtering", () => {
    it("excludes premise-bound variables from truth table columns", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        claimLibrary.create({ id: "c2", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )

        // Premise 1: A implies B (the sub-argument)
        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "c2",
            claimVersion: 0,
        } as TClaimBoundVariable)
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vA",
            position: 0,
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vB",
            position: 1,
        })

        // Premise 2: P implies Q, where Q is bound to p1
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vP",
            position: 0,
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 1,
        })

        engine.setConclusionPremise("p2")

        // checkValidity should only generate assignments for A, B, P (not Q)
        const result = engine.checkValidity()
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            // 3 claim-bound variables → 2^3 = 8 assignments
            expect(result.numAssignmentsChecked).toBe(8)
        }
    })

    it("includes premise-bound variables in referencedVariableIds but not in assignment generation", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )

        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vA",
        })

        engine.createPremiseWithId("p2")
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        engine.setConclusionPremise("p2")

        // checkValidity should only assign A (not Q)
        const result = engine.checkValidity()
        expect(result.ok).toBe(true)
        if (result.ok) {
            // 1 claim-bound variable → 2^1 = 2 assignments
            expect(result.numAssignmentsChecked).toBe(2)
            // But both variables are referenced
            expect(result.checkedVariableIds).toContain("vA")
            // Q is not in checkedVariableIds since it's premise-bound
            expect(result.checkedVariableIds).not.toContain("vQ")
        }
    })
})

describe("Premise-variable associations — lazy evaluation", () => {
    function makeImplicationEngine() {
        // "P implies (A implies B)" via two premises:
        // Premise 1 (p1): A implies B
        // Premise 2 (p2): P implies Q, where Q bound to p1
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vA",
            position: 0,
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vB",
            position: 1,
        })

        // Q bound to p1
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P implies Q (this is the conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vP",
            position: 0,
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 1,
        })

        engine.setConclusionPremise("p2")
        return engine
    }

    it("evaluates premise-bound variable Q by resolving p1 tree", () => {
        const engine = makeImplicationEngine()
        // A=true, B=true, P=true → Q = (A implies B) = true → P implies Q = true
        const result = engine.evaluate({
            variables: { vA: true, vB: true, vP: true },
            operatorAssignments: {},
        })
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(true)
        }
    })

    it("evaluates Q as false when A=true, B=false", () => {
        const engine = makeImplicationEngine()
        // A=true, B=false → Q = (A implies B) = false
        // P=true → P implies Q = true implies false = false
        const result = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(false)
        }
    })

    it("evaluates Q as true when A=false (vacuous truth)", () => {
        const engine = makeImplicationEngine()
        // A=false, B=false → Q = (A implies B) = true (vacuous)
        // P=true → P implies Q = true implies true = true
        const result = engine.evaluate({
            variables: { vA: false, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(result).toBeDefined()
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(true)
        }
    })

    it("caches resolver results across multiple references in same evaluate call", () => {
        // Build: P and Q and Q, where Q is bound to p1 (A implies B)
        // Q appears twice — resolver should cache and return same value
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "operator",
            operator: "implies",
            position: 0,
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vA",
            position: 0,
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            type: "variable",
            variableId: "vB",
            position: 1,
        })

        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P and Q and Q (conclusion) — Q appears twice
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "operator",
            operator: "and",
            position: 0,
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vP",
            position: 0,
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 1,
        })
        p2.addExpression({
            id: "e2c",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            type: "variable",
            variableId: "vQ",
            position: 2,
        })

        engine.setConclusionPremise("p2")

        // A=true, B=true → Q = true; P=true → P and Q and Q = true and true and true = true
        const result = engine.evaluate({
            variables: { vA: true, vB: true, vP: true },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.conclusion!.rootValue).toBe(true)
        }

        // A=true, B=false → Q = false; P=true → P and Q and Q = true and false and false = false
        const result2 = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(result2.ok).toBe(true)
        if (result2.ok) {
            expect(result2.conclusion!.rootValue).toBe(false)
        }
    })

    it("checkValidity resolves premise-bound variables correctly", () => {
        const engine = makeImplicationEngine()
        // Structure: supporting premise p1 = (A implies B), conclusion p2 = (P implies Q)
        // where Q is bound to p1.
        // When the supporting premise (A implies B) is true, Q evaluates to true.
        // So the conclusion becomes (P implies true) = true for all P.
        // When the supporting premise is false (A=true, B=false), the assignment
        // is inadmissible, so no counterexample is possible.
        // Therefore the argument IS valid.
        const result = engine.checkValidity()
        expect(result.ok).toBe(true)
        if (result.ok) {
            // 3 claim-bound variables → 2^3 = 8 assignments
            expect(result.numAssignmentsChecked).toBe(8)
            expect(result.isValid).toBe(true)
            expect(result.counterexamples!.length).toBe(0)
        }
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — updateVariable
// ---------------------------------------------------------------------------

describe("Premise-variable associations — updateVariable", () => {
    function makeEngine() {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        claimLibrary.create({ id: "c2", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })
        return engine
    }

    it("updates symbol on premise-bound variable", () => {
        const engine = makeEngine()
        engine.updateVariable("vQ", { symbol: "R" })
        expect(engine.getVariable("vQ")!.symbol).toBe("R")
    })

    it("rebinds premise-bound variable to different premise", () => {
        const engine = makeEngine()
        engine.updateVariable("vQ", { boundPremiseId: "p2" })
        const v = engine.getVariable("vQ")!
        expect(isPremiseBound(v)).toBe(true)
        expect((v as TPremiseBoundVariable).boundPremiseId).toBe("p2")
    })

    it("rejects binding-type conversion on claim-bound variable", () => {
        const engine = makeEngine()
        expect(() =>
            engine.updateVariable("vA", { boundPremiseId: "p1" })
        ).toThrow()
    })

    it("rejects binding-type conversion on premise-bound variable", () => {
        const engine = makeEngine()
        expect(() => engine.updateVariable("vQ", { claimId: "c1" })).toThrow()
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — diff
// ---------------------------------------------------------------------------

describe("Premise-variable associations — diff", () => {
    it("detects changes on premise-bound variable fields", () => {
        const before: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const after: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p2",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const changes = defaultCompareVariable(before, after)
        expect(changes).toHaveLength(1)
        expect(changes[0].field).toBe("boundPremiseId")
    })

    it("detects cross-variant change", () => {
        const before: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            claimId: "c1",
            claimVersion: 0,
            checksum: "",
        }
        const after: TCorePropositionalVariable = {
            id: "v1",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
            checksum: "",
        }
        const changes = defaultCompareVariable<TCorePropositionalVariable>(
            before,
            after
        )
        const fields = changes.map((c) => c.field).sort()
        expect(fields).toEqual([
            "boundArgumentId",
            "boundArgumentVersion",
            "boundPremiseId",
            "claimId",
            "claimVersion",
        ])
    })
})

// ---------------------------------------------------------------------------
// Premise-variable associations — snapshot round-trip
// ---------------------------------------------------------------------------

describe("Premise-variable associations — snapshot round-trip", () => {
    it("restores premise-bound variables from snapshot", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const snapshot = engine.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snapshot, claimLibrary)

        const vQ = restored.getVariable("vQ")
        expect(vQ).toBeDefined()
        expect(isPremiseBound(vQ!)).toBe(true)
        expect((vQ as TPremiseBoundVariable).boundPremiseId).toBe("p1")

        const vA = restored.getVariable("vA")
        expect(vA).toBeDefined()
        expect(isClaimBound(vA!)).toBe(true)
    })
})

describe("Premise-variable associations — validateEvaluability", () => {
    it("warns when premise-bound variable targets an empty premise", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to p2's tree so it gets validated
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        expect(
            validation.issues.some((i) => i.code === "EXPR_BOUND_PREMISE_EMPTY")
        ).toBe(true)
    })

    it("does not warn when premise-bound variable targets a premise with expressions", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Add expression to p1 so it is not empty
        const p1 = engine.getPremise("p1")!
        p1.appendExpression(null, {
            id: "e0",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            type: "variable",
            variableId: "vA",
        })

        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Add Q to p2's tree
        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        expect(
            validation.issues.some((i) => i.code === "EXPR_BOUND_PREMISE_EMPTY")
        ).toBe(false)
    })

    it("warning does not block evaluation (ok is still true)", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "c1", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )
        engine.createPremiseWithId("p1")
        engine.createPremiseWithId("p2")
        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "c1",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        const p2 = engine.getPremise("p2")!
        p2.appendExpression(null, {
            id: "e1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            type: "variable",
            variableId: "vQ",
        })

        const validation = p2.validateEvaluability()
        // Warning severity does not set ok to false
        expect(validation.ok).toBe(true)
        expect(
            validation.issues.some(
                (i) =>
                    i.code === "EXPR_BOUND_PREMISE_EMPTY" &&
                    i.severity === "warning"
            )
        ).toBe(true)
    })
})

describe("Premise-variable associations — integration", () => {
    it("full round-trip: create, evaluate, snapshot, restore, re-evaluate", () => {
        // Build "P implies (A implies B)" argument
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // Premise 1: A implies B
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 0,
            type: "variable",
            variableId: "vA",
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 1,
            type: "variable",
            variableId: "vB",
        })

        // Q bound to p1
        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // Premise 2: P implies Q (conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 0,
            type: "variable",
            variableId: "vP",
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 1,
            type: "variable",
            variableId: "vQ",
        })

        engine.setConclusionPremise("p2")

        // Evaluate: A=true, B=false => Q = (true implies false) = false
        // P=true, Q=false => (true implies false) = false
        const evalResult = engine.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(evalResult).toBeDefined()
        expect(evalResult.conclusion!.rootValue).toBe(false)

        // Snapshot
        const snapshot = engine.snapshot()

        // Restore
        const restored = ArgumentEngine.fromSnapshot(snapshot, claimLibrary)

        // Re-evaluate with same assignment
        const reEvalResult = restored.evaluate({
            variables: { vA: true, vB: false, vP: true },
            operatorAssignments: {},
        })
        expect(reEvalResult).toBeDefined()
        expect(reEvalResult.conclusion!.rootValue).toBe(false)

        // Remove target premise and verify cascade
        restored.removePremise("p1")
        expect(restored.getVariable("vQ")).toBeUndefined()
        expect(restored.getPremise("p2")!.getExpressions().length).toBeLessThan(
            3
        )
    })

    it("checkValidity produces correct result for nested implication", () => {
        const claimLibrary = new ClaimLibrary()
        claimLibrary.create({ id: "cA", type: "normal" })
        claimLibrary.create({ id: "cB", type: "normal" })
        claimLibrary.create({ id: "cP", type: "normal" })
        const engine = new ArgumentEngine(
            { id: "a1", version: 0 },
            claimLibrary,
            { behavior: "permissive" }
        )

        engine.addVariable({
            id: "vA",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "A",
            claimId: "cA",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vB",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "B",
            claimId: "cB",
            claimVersion: 0,
        } as TClaimBoundVariable)
        engine.addVariable({
            id: "vP",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "P",
            claimId: "cP",
            claimVersion: 0,
        } as TClaimBoundVariable)

        // p1: A implies B (supporting)
        engine.createPremiseWithId("p1")
        const p1 = engine.getPremise("p1")!
        p1.addExpression({
            id: "op1",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p1.addExpression({
            id: "e1a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 0,
            type: "variable",
            variableId: "vA",
        })
        p1.addExpression({
            id: "e1b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p1",
            parentId: "op1",
            position: 1,
            type: "variable",
            variableId: "vB",
        })

        engine.bindVariableToPremise({
            id: "vQ",
            argumentId: "a1",
            argumentVersion: 0,
            symbol: "Q",
            boundPremiseId: "p1",
            boundArgumentId: "a1",
            boundArgumentVersion: 0,
        })

        // p2: P implies Q (conclusion)
        engine.createPremiseWithId("p2")
        const p2 = engine.getPremise("p2")!
        p2.addExpression({
            id: "op2",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: null,
            position: 0,
            type: "operator",
            operator: "implies",
        })
        p2.addExpression({
            id: "e2a",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 0,
            type: "variable",
            variableId: "vP",
        })
        p2.addExpression({
            id: "e2b",
            argumentId: "a1",
            argumentVersion: 0,
            premiseId: "p2",
            parentId: "op2",
            position: 1,
            type: "variable",
            variableId: "vQ",
        })

        engine.setConclusionPremise("p2")

        const result = engine.checkValidity()
        expect(result).toBeDefined()
        // 3 claim-bound variables -> 8 assignments
        expect(result.numAssignmentsChecked).toBe(8)
        // The argument "given (A implies B), therefore (P implies Q)" is valid
        expect(result.isValid).toBe(true)
    })
})
