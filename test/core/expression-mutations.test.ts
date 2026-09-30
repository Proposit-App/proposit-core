import { describe, expect, it } from "vitest"
import { ArgumentEngine, PremiseEngine } from "../../src/lib/index"
import {
    type TCoreArgument,
    type TCorePropositionalExpression,
    type TCorePropositionalVariable,
    type TCorePremise,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import type {
    TExpressionInput,
    TExpressionWithoutPosition,
} from "../../src/lib/core/expression-manager"
import { DEFAULT_CHECKSUM_CONFIG } from "../../src/lib/checksum-config"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared"
import type { TCoreChecksumConfig } from "../../src/lib/types/checksum"
import {
    ARG,
    aLib,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
    VAR_R,
} from "./fixtures"

// ---------------------------------------------------------------------------
// PremiseEngine — updateExpression
// ---------------------------------------------------------------------------

describe("PremiseEngine — updateExpression", () => {
    function setup() {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pm } = eng.createPremise()
        return { eng, pm }
    }

    it("updates position of an expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 3 })
        )

        const { result, changes } = pm.updateExpression("e-p", { position: 2 })

        expect(result.id).toBe("e-p")
        expect(result.position).toBe(2)
        // e-p is modified directly; op-and is also modified because its
        // descendantChecksum changed (child's combinedChecksum changed).
        const modifiedIds = (changes.expressions?.modified ?? []).map(
            (e) => e.id
        )
        expect(modifiedIds).toContain("e-p")
        expect(modifiedIds).toContain("op-and")
        const modifiedChild = changes.expressions!.modified.find(
            (e) => e.id === "e-p"
        )!
        expect(modifiedChild.position).toBe(2)
    })

    it("rejects position collision with sibling", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 3 })
        )

        expect(() => pm.updateExpression("e-p", { position: 3 })).toThrow(
            /Position/
        )
    })

    it("updates variableId on a variable expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.updateExpression("e-p", {
            variableId: VAR_Q.id,
        })

        expect(result.id).toBe("e-p")
        expect(
            (result as TCorePropositionalExpression<"variable">).variableId
        ).toBe(VAR_Q.id)
        expect(changes.expressions?.modified).toHaveLength(1)
    })

    it("rejects variableId update on non-variable expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )

        expect(() =>
            pm.updateExpression("op-and", { variableId: VAR_P.id })
        ).toThrow(/not a variable expression/)
    })

    it("rejects variableId referencing non-existent variable", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            pm.updateExpression("e-p", { variableId: "var-nonexistent" })
        ).toThrow(/non-existent variable/)
    })

    it("updates expressionsByVariableId index on variableId change (verify via cascade delete)", () => {
        const { pm } = setup()
        // Build: and(P, Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        // Change e-p from P to R
        pm.updateExpression("e-p", { variableId: VAR_R.id })

        // Cascade-delete P: should remove nothing since e-p is now R
        const { result: removedP } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(removedP).toHaveLength(0)

        // Cascade-delete R: should remove e-p (now referencing R)
        const { result: removedR } = pm.deleteExpressionsUsingVariable(VAR_R.id)
        expect(removedR.length).toBeGreaterThanOrEqual(1)
        expect(pm.getExpression("e-p")).toBeUndefined()
    })

    it("updates operator and to or", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        const { result } = pm.updateExpression("op-and", { operator: "or" })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("or")
    })

    it("updates operator or to and", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-or", "or", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )

        const { result } = pm.updateExpression("op-or", { operator: "and" })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("and")
    })

    it("updates operator implies to iff", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-impl", "implies", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-impl", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-impl", position: 2 })
        )

        const { result } = pm.updateExpression("op-impl", { operator: "iff" })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("iff")
    })

    it("updates operator iff to implies", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-iff", "iff", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-iff", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-iff", position: 2 })
        )

        const { result } = pm.updateExpression("op-iff", {
            operator: "implies",
        })

        expect(
            (result as TCorePropositionalExpression<"operator">).operator
        ).toBe("implies")
    })

    it("rejects operator change across groups: and to implies", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        expect(() =>
            pm.updateExpression("op-and", { operator: "implies" })
        ).toThrow(/not a permitted operator change/)
    })

    it("rejects operator change from not", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        expect(() =>
            pm.updateExpression("op-not", { operator: "and" })
        ).toThrow(/not a permitted operator change/)
    })

    it("rejects operator change to not", () => {
        const { pm } = setup()
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        expect(() =>
            pm.updateExpression("op-and", { operator: "not" })
        ).toThrow(/not a permitted operator change/)
    })

    it("rejects operator update on non-operator expression", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() => pm.updateExpression("e-p", { operator: "and" })).toThrow(
            /not an operator expression/
        )
    })

    it("rejects forbidden field: id", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { id: "new-id" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: parentId", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { parentId: "op-and" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: type", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { type: "operator" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: argumentId", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { argumentId: "arg-2" } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: argumentVersion", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { argumentVersion: 99 } as any)
        ).toThrow(/forbidden/)
    })

    it("rejects forbidden field: checksum", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(() =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
            pm.updateExpression("e-p", { checksum: "abcd1234" } as any)
        ).toThrow(/forbidden/)
    })

    it("throws for non-existent expression", () => {
        const { pm } = setup()

        expect(() =>
            pm.updateExpression("nonexistent", { position: 5 })
        ).toThrow(/not found/)
    })

    it("no-ops when updates object is empty", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.updateExpression("e-p", {})

        expect(result.id).toBe("e-p")
        // No expression changes when nothing is updated
        expect(changes.expressions?.modified ?? []).toHaveLength(0)
        expect(changes.expressions?.added ?? []).toHaveLength(0)
        expect(changes.expressions?.removed ?? []).toHaveLength(0)
    })

    it("marks premise combinedChecksum dirty after update", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const before = pm.combinedChecksum()
        pm.updateExpression("e-p", { variableId: VAR_Q.id })
        const after = pm.combinedChecksum()

        expect(before).not.toBe(after)
    })

    it("result includes checksum", () => {
        const { pm } = setup()
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.updateExpression("e-p", {
            variableId: VAR_Q.id,
        })

        expect(result.checksum).toMatch(/^[0-9a-f]{8}$/)
        expect(changes.expressions?.modified[0].checksum).toMatch(
            /^[0-9a-f]{8}$/
        )
    })
})

// ---------------------------------------------------------------------------
// removeExpression — deleteSubtree parameter
// ---------------------------------------------------------------------------

describe("removeExpression — deleteSubtree parameter", () => {
    function setup() {
        const eng = new ArgumentEngine(
            { id: ARG.id, version: ARG.version },
            aLib(),
            { behavior: "permissive" }
        )
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        return { eng, pm }
    }

    // When removeExpression(_, deleteSubtree=true) leaves an operator
    // with one child, promoting that child is done by the AN-3
    // post-hook (assistive mode), not by the primitive; the primitive's own
    // deleteSubtree behavior is asserted by the tests in this describe
    // block.

    it("deleteSubtree: false — promotes single child (operator)", () => {
        const { pm } = setup()
        // Tree: formula(or(P, Q)) — formula buffers the operator nesting
        pm.addExpression(
            makeFormulaExpr("formula-1", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "formula-1",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )

        // Remove formula with deleteSubtree: false — or promoted to root
        pm.removeExpression("formula-1", false)

        expect(pm.getRootExpressionId()).toBe("op-or")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(3)
        const orExpr = expressions.find((e) => e.id === "op-or")!
        expect(orExpr.parentId).toBeNull()
        // Children of or are intact
        const pExpr = expressions.find((e) => e.id === "expr-p")!
        const qExpr = expressions.find((e) => e.id === "expr-q")!
        expect(pExpr.parentId).toBe("op-or")
        expect(qExpr.parentId).toBe("op-or")
    })

    it("deleteSubtree: false — promotes single child (leaf)", () => {
        const { pm } = setup()
        // Tree: not(P)
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        // Remove not with deleteSubtree: false — P promoted to root
        pm.removeExpression("op-not", false)

        expect(pm.getRootExpressionId()).toBe("expr-p")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(1)
        expect(expressions[0].id).toBe("expr-p")
        expect(expressions[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — errors on multiple children", () => {
        const { pm } = setup()
        // Tree: and(P, Q)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        // Removing and with deleteSubtree: false throws — has 2 children
        expect(() => pm.removeExpression("op-and", false)).toThrow(
            /multiple children/
        )

        // Tree is unchanged
        expect(pm.getExpressions()).toHaveLength(3)
        expect(pm.getRootExpressionId()).toBe("op-and")
    })

    // The removeExpression(_, false) primitive's own promotion semantics
    // for 1-child-after-removal cases are covered by the other
    // "deleteSubtree: false — promotes single child" tests in this
    // block; the multi-step cascade behavior is owned by the AN-3
    // post-hook.

    it("deleteSubtree: false — promotes child into non-root slot", () => {
        const { pm } = setup()
        // Tree: and(not(formula(or(P, Q))), P2)
        // Need two children for and so it doesn't collapse after not removal.
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeFormulaExpr("formula-1", {
                parentId: "op-not",
                position: 1,
            })
        )
        pm.addExpression(
            makeOpExpr("op-or", "or", {
                parentId: "formula-1",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-or", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-or", position: 2 })
        )
        pm.addExpression(
            makeVarExpr("expr-p2", VAR_P.id, {
                parentId: "op-and",
                position: 2,
            })
        )

        // Remove not with deleteSubtree: false — formula promoted into not's slot under and
        pm.removeExpression("op-not", false)

        expect(pm.getRootExpressionId()).toBe("op-and")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(6) // and, formula, or, P, Q, P2
        const formulaExpr = expressions.find((e) => e.id === "formula-1")!
        expect(formulaExpr.parentId).toBe("op-and")
        const orExpr = expressions.find((e) => e.id === "op-or")!
        expect(orExpr.parentId).toBe("formula-1")
        const pExpr = expressions.find((e) => e.id === "expr-p")!
        expect(pExpr.parentId).toBe("op-or")
        const qExpr = expressions.find((e) => e.id === "expr-q")!
        expect(qExpr.parentId).toBe("op-or")
    })

    it("deleteSubtree: false — changeset records removed and modified", () => {
        const { pm } = setup()
        // Tree: not(P)
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        // Remove not with deleteSubtree: false
        const { result, changes } = pm.removeExpression("op-not", false)

        expect(result?.id).toBe("op-not")
        // Changeset: 1 removed (not) + 1 modified (P promoted)
        expect(changes.expressions!.removed).toHaveLength(1)
        expect(changes.expressions!.removed[0].id).toBe("op-not")
        expect(changes.expressions!.modified).toHaveLength(1)
        expect(changes.expressions!.modified[0].id).toBe("expr-p")
        expect(changes.expressions!.modified[0].parentId).toBeNull()
    })

    it("deleteSubtree: false — no collapse runs after promotion", () => {
        const { pm } = setup()
        // Tree: and(not(P))
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeOpExpr("op-not", "not", { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not", position: 1 })
        )

        // Remove and with deleteSubtree: false — not promoted to root, tree intact as not(P)
        pm.removeExpression("op-and", false)

        expect(pm.getRootExpressionId()).toBe("op-not")
        const expressions = pm.getExpressions()
        expect(expressions).toHaveLength(2)
        const notExpr = expressions.find((e) => e.id === "op-not")!
        expect(notExpr.parentId).toBeNull()
        const pExpr = expressions.find((e) => e.id === "expr-p")!
        expect(pExpr.parentId).toBe("op-not")
    })

    it("deleteSubtree: false — expressionsByVariableId cleaned for removed expr only", () => {
        const { pm } = setup()
        // Tree: formula(P)
        pm.addExpression(
            makeFormulaExpr("f-1", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1", position: 1 })
        )

        // Remove formula with deleteSubtree: false — P promoted
        pm.removeExpression("f-1", false)

        expect(pm.getRootExpressionId()).toBe("expr-p")
        expect(pm.getExpressions()).toHaveLength(1)

        // Verify variable cascade still works on P
        // (P should still be tracked in expressionsByVariableId)
        pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(pm.getExpressions()).toHaveLength(0)
        expect(pm.getRootExpressionId()).toBeUndefined()
    })
})

describe("PremiseEngine — shared expression index", () => {
    const arg = { id: "arg-1", version: 0 }
    const makeVariable = (id: string, symbol: string) => ({
        id,
        symbol,
        argumentId: "arg-1",
        argumentVersion: 0,
        claimId: "claim-default",
        claimVersion: 0,
        checksum: "x",
    })
    const makeVarExpr = (
        id: string,
        parentId: string | null,
        premiseId: string,
        overrides: Record<string, unknown> = {}
    ) => ({
        id,
        type: "variable" as const,
        variableId: "v1",
        parentId,
        position: 0,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId,
        ...overrides,
    })

    it("populates the shared index on addExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        expect(index.get("e1")).toBe("p1")
    })

    it("removes entries from the shared index on removeExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        pe.removeExpression("e1", true)
        expect(index.has("e1")).toBe(false)
    })

    it("removes subtree entries from the shared index", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionInput)
        pe.addExpression(makeVarExpr("e1", "op1", "p1", { position: 0 }))
        pe.addExpression(
            makeVarExpr("e2", "op1", "p1", { position: 1, id: "e2" })
        )
        pe.removeExpression("op1", true)
        expect(index.has("op1")).toBe(false)
        expect(index.has("e1")).toBe(false)
        expect(index.has("e2")).toBe(false)
    })

    it("populates the shared index on appendExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.appendExpression(null, {
            id: "e1",
            type: "variable" as const,
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionWithoutPosition)
        expect(index.get("e1")).toBe("p1")
    })

    it("populates the shared index on insertExpression", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        pe.insertExpression(
            {
                id: "op1",
                type: "operator",
                operator: "not",
                parentId: null,
                position: 0,
                argumentId: "arg-1",
                argumentVersion: 0,
                premiseId: "p1",
            } as TExpressionInput,
            "e1"
        )
        expect(index.get("op1")).toBe("p1")
        expect(index.get("e1")).toBe("p1")
    })

    it("works correctly when no shared index is provided", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            { argument: arg as TCoreArgument, variables: vm }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        pe.removeExpression("e1", true)
    })

    it("removes entries on deleteExpressionsUsingVariable", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        vm.addVariable(makeVariable("v2", "Q"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression({
            id: "op1",
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        } as TExpressionInput)
        pe.addExpression(makeVarExpr("e1", "op1", "p1", { position: 0 }))
        pe.addExpression({
            id: "e2",
            type: "variable" as const,
            variableId: "v2",
            parentId: "op1",
            position: 1,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        })
        pe.deleteExpressionsUsingVariable("v1")
        expect(index.has("e1")).toBe(false)
    })

    it("populates the shared index via fromSnapshot", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVariable("v1", "P"))
        const index = new Map<string, string>()
        const pe = new PremiseEngine(
            {
                id: "p1",
                argumentId: "arg-1",
                argumentVersion: 0,
                type: "freeform" as const,
            } as TCorePremise,
            {
                argument: arg as TCoreArgument,
                variables: vm,
                expressionIndex: index,
            }
        )
        pe.addExpression(makeVarExpr("e1", null, "p1"))
        const snap = pe.snapshot()

        const newIndex = new Map<string, string>()
        PremiseEngine.fromSnapshot(snap, arg as TCoreArgument, vm, newIndex)
        expect(newIndex.get("e1")).toBe("p1")
    })
})

describe("PremiseEngine.reparentExpression", () => {
    // Public bundled-composite mutation. Atomically moves an
    // existing expression onto a new parent at a given position with no
    // externally observable transient orphan state. Used by AN-1
    // (formula-buffer insertion) and AN-4 (multi-child
    // same-operator absorption) in `src/lib/grammar/an-rules.ts`.
    //
    // Throws only on Structural rules + entity-not-found: S-1 (FK
    // soundness), S-4 (no-cycles), S-9 (sibling-position uniqueness —
    // only when a
    // sibling other than the moved expression already occupies the
    // target slot; same-position no-op is tolerated).

    function permissivePremise(): PremiseEngine {
        // Use permissive behavior so we can construct multi-level shapes
        // (e.g. OR with operator children for the reparent target setup)
        // without the assistive AN post-hook re-normalizing between
        // setup calls.
        const eng = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(VAR_R)
        const { result: pe } = eng.createPremise()
        return pe
    }

    it("reparents an expression onto a new parent at the given position (happy path)", () => {
        // OR(formula(P), formula(Q)) → move expr-p to be a direct child of
        // OR at position 2.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeFormulaExpr("f1", { parentId: "or-root", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "f1",
                position: 0,
            })
        )
        pe.addExpression(
            makeFormulaExpr("f2", { parentId: "or-root", position: 1 })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "f2",
                position: 0,
            })
        )

        const { result } = pe.reparentExpression("expr-p", "or-root", 2)
        expect(result.parentId).toBe("or-root")
        expect(result.position).toBe(2)
        const orChildren = pe.getChildExpressions("or-root")
        expect(orChildren.map((c) => c.id).sort()).toEqual([
            "expr-p",
            "f1",
            "f2",
        ])
        // f1 now has no children — expr-p moved out.
        expect(pe.getChildExpressions("f1")).toHaveLength(0)
    })

    it("supports newPosition: 0 cleanly (used by AN-1)", () => {
        // Setup: F → OR (the formula has the OR at some non-zero
        // position). Reparent OR to position 0 under F.
        const pe = permissivePremise()
        pe.addExpression(makeFormulaExpr("f", { parentId: null }))
        pe.addExpression(
            makeOpExpr("or-1", "or", { parentId: "f", position: 5 })
        )

        const { result } = pe.reparentExpression("or-1", "f", 0)
        expect(result.position).toBe(0)
        expect(result.parentId).toBe("f")
        const children = pe.getChildExpressions("f")
        expect(children).toHaveLength(1)
        expect(children[0].id).toBe("or-1")
        expect(children[0].position).toBe(0)
    })

    it("throws when expressionId does not exist (entity-not-found)", () => {
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("and-root", "and"))
        expect(() =>
            pe.reparentExpression("does-not-exist", "and-root", 0)
        ).toThrow(/not found in premise/)
    })

    it("throws when newParentId does not exist (S-1 FK soundness)", () => {
        const pe = permissivePremise()
        pe.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            pe.reparentExpression("expr-p", "ghost-parent", 0)
        ).toThrow(/not found in premise/)
    })

    it("throws S-4 when newParentId === expressionId (self-parent cycle)", () => {
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 0,
            })
        )
        expect(() => pe.reparentExpression("or-root", "or-root", 0)).toThrow(
            /S-4.*under itself/
        )
    })

    it("throws S-4 when newParentId is a descendant of expressionId (would create a cycle)", () => {
        // OR_outer → formula → OR_inner. Try to reparent OR_outer under
        // OR_inner — a cycle.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-outer", "or"))
        pe.addExpression(
            makeFormulaExpr("f", { parentId: "or-outer", position: 0 })
        )
        pe.addExpression(
            makeOpExpr("or-inner", "or", { parentId: "f", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-inner",
                position: 0,
            })
        )
        expect(() => pe.reparentExpression("or-outer", "or-inner", 1)).toThrow(
            /S-4.*cycle/
        )
    })

    it("throws S-9 when newPosition is already occupied by a different sibling", () => {
        // OR(P at 0, Q at 1). Try to reparent P to position 1 — Q
        // already there.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "or-root",
                position: 1,
            })
        )
        expect(() => pe.reparentExpression("expr-p", "or-root", 1)).toThrow(
            /S-9.*already occupied/
        )
    })

    it("tolerates same-parent, same-position no-op (does not throw S-9 on its own slot)", () => {
        // expr-p is already at (or-root, 0). Reparenting it to the same
        // slot should be a no-op, not an S-9 throw. (The expression's
        // own position is not a "colliding sibling" against itself.)
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 0,
            })
        )
        const { result } = pe.reparentExpression("expr-p", "or-root", 0)
        expect(result.parentId).toBe("or-root")
        expect(result.position).toBe(0)
    })

    // Parent-type validation gap: `reparentExpression` must enforce
    // that `newParent` is an `operator` or `formula`. Otherwise a
    // caller could reparent under a variable (or any other
    // non-container) and produce a malformed AST that no validator
    // catches. `addExpression` enforces this at em.ts:418-422 and
    // `reparentExpression` must reach parity. The same applies to the
    // arity guards: reparenting under a unary `not` that already has
    // its one child, or under a binary `implies`/`iff` that already
    // has its two children, must throw (the move crosses parents — the
    // new parent's child count increases by one).

    it("throws when newParent is a variable expression (S-1 parent-type)", () => {
        // Setup: AND(P_var, Q_var). Try to reparent Q_var under P_var.
        // P_var is a variable — invalid parent. Without the guard the
        // call would silently produce a malformed AST.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("and-root", "and"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "and-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "and-root",
                position: 1,
            })
        )
        expect(() => pe.reparentExpression("expr-q", "expr-p", 0)).toThrow(
            /S-1.*non-operator\/formula parent.*type=variable/
        )
    })

    it("throws S-1 arity when reparenting under a unary `not` that already has its child", () => {
        // Setup: OR(NOT(P_var), Q_var). Try to reparent Q_var under
        // NOT. NOT is unary; it already holds P_var. Reparent would
        // make NOT a binary node — must throw.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeOpExpr("not-1", "not", { parentId: "or-root", position: 0 })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "not-1",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "or-root",
                position: 1,
            })
        )
        expect(() => pe.reparentExpression("expr-q", "not-1", 1)).toThrow(
            /"not" can only have one child/
        )
    })

    // Note: the implies/iff arity case (2-children cap) is not
    // separately covered here because S-5 (implies/iff root-only) is
    // enforced by `addExpression` so a realistic premise cannot host
    // an implies node with siblings available to reparent into it.
    // The arity guard is shared with `addExpression`'s
    // `assertChildLimit` helper, which is independently tested via
    // the existing addExpression test suite.

    it("tolerates same-parent reparent under a full binary operator (no net count change)", () => {
        // Setup: IMPLIES(P_var at 0, Q_var at 1). Reparent Q_var to
        // position 1 under the same implies — same-parent move,
        // count unchanged. Must NOT trip the arity guard.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("implies-root", "implies"))
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "implies-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "implies-root",
                position: 1,
            })
        )
        const { result } = pe.reparentExpression("expr-q", "implies-root", 1)
        expect(result.parentId).toBe("implies-root")
        expect(result.position).toBe(1)
    })
})

describe("PremiseEngine.wrapInFormula", () => {
    // S-10 enforcement gap.
    //
    // `wrapInFormula` must not route through a `registerFormulaBuffer`
    // that calls `this.expressions.set(formulaId, ...)` without a
    // `has()` check — a caller passing an already-existing id would
    // silently overwrite the prior expression, violating S-10 (entity
    // ID uniqueness). This is a public-API surface promise gap.

    function permissivePremise(): PremiseEngine {
        const eng = new ArgumentEngine(ARG, aLib(), {
            behavior: "permissive",
        })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pe } = eng.createPremise()
        return pe
    }

    it("throws S-10 when formulaId already exists in this premise", () => {
        // Setup: OR(P) with an existing "f-existing" formula sibling.
        // Try to wrapInFormula(P, "f-existing") — should throw S-10.
        const pe = permissivePremise()
        pe.addExpression(makeOpExpr("or-root", "or"))
        pe.addExpression(
            makeFormulaExpr("f-existing", {
                parentId: "or-root",
                position: 0,
            })
        )
        pe.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "or-root",
                position: 1,
            })
        )
        expect(() => pe.wrapInFormula("expr-p", "f-existing")).toThrow(
            /S-10.*already exists/
        )
    })
})

// patchExpressionAppFields
// ---------------------------------------------------------------------------

describe("patchExpressionAppFields", () => {
    // Expression type extended with app-level fields, mirroring how the
    // server instantiates the engine with a consumer-supplied expression type.
    type TAppExpression = TCorePropositionalExpression & {
        creatorId?: string
        createdOn?: string
    }

    const APP_ARG: TOptionalChecksum<TCoreArgument> = {
        id: "arg-app",
        version: 1,
    }

    // Extended checksum config that includes app-level fields, matching
    // how the server configures the engine so that creatorId / createdOn
    // are included in expression entity checksums.
    const APP_CHECKSUM_CONFIG: TCoreChecksumConfig = {
        expressionFields: new Set([
            "type",
            "parentId",
            "position",
            "argumentId",
            "argumentVersion",
            "premiseId",
            "variableId",
            "operator",
            "creatorId",
            "createdOn",
        ]),
        variableFields: DEFAULT_CHECKSUM_CONFIG.variableFields!,
        premiseFields: DEFAULT_CHECKSUM_CONFIG.premiseFields!,
        argumentFields: DEFAULT_CHECKSUM_CONFIG.argumentFields!,
    }

    function makeAppEngine() {
        return new ArgumentEngine<
            TCoreArgument,
            TCorePremise,
            TAppExpression,
            TCorePropositionalVariable
        >(APP_ARG, aLib(), {
            behavior: "permissive",
            checksumConfig: APP_CHECKSUM_CONFIG,
        })
    }

    it("patches a checksum-bearing field and the expression checksum changes", () => {
        const engine = makeAppEngine()
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-app",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremise()
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-app",
            argumentVersion: 1,
            premiseId: pm.getId(),
            parentId: null,
            position: 1,
        } as TExpressionInput<TAppExpression>)
        engine.flushChecksums()

        const beforeSnap = engine.snapshot()
        const exprBefore = beforeSnap.premises[0].expressions.expressions.find(
            (e) => e.id === "e1"
        )
        expect(exprBefore).toBeDefined()

        // Patch with a checksum-bearing field (creatorId is in expressionFields).
        engine.patchExpressionAppFields("e1", { creatorId: "user-42" })

        engine.flushChecksums()

        const afterSnap = engine.snapshot()
        const exprAfter = afterSnap.premises[0].expressions.expressions.find(
            (e) => e.id === "e1"
        )
        expect(exprAfter?.creatorId).toBe("user-42")
        // The expression checksum must differ because creatorId is checksum-bearing.
        expect(exprAfter?.checksum).not.toBe(exprBefore?.checksum)
    })

    it("dirty propagates: parent combinedChecksum recomputes after patch", () => {
        const engine = makeAppEngine()
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-app",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        engine.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-app",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremise()

        // Build P → Q (implies): e4 = P implies Q (root), e2 = P (left child), e3 = Q (right child)
        pm.addExpression({
            id: "e4",
            type: "operator",
            operator: "implies",
            argumentId: "arg-app",
            argumentVersion: 1,
            premiseId: pm.getId(),
            parentId: null,
            position: 1,
        } as TExpressionInput<TAppExpression>)
        pm.addExpression({
            id: "e2",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-app",
            argumentVersion: 1,
            premiseId: pm.getId(),
            parentId: "e4",
            position: 1,
        } as TExpressionInput<TAppExpression>)
        pm.addExpression({
            id: "e3",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-app",
            argumentVersion: 1,
            premiseId: pm.getId(),
            parentId: "e4",
            position: 2,
        } as TExpressionInput<TAppExpression>)

        engine.flushChecksums()
        const beforeParentCs = pm.combinedChecksum()

        // Patch the child expression with a checksum-bearing field.
        engine.patchExpressionAppFields("e3", { createdOn: "2026-01-01" })

        engine.flushChecksums()
        const afterParentCs = pm.combinedChecksum()

        // Parent's combined checksum must have changed because a child's
        // entity checksum changed.
        expect(afterParentCs).not.toBe(beforeParentCs)
    })

    it("throws on unknown expression id", () => {
        const engine = makeAppEngine()
        expect(() =>
            engine.patchExpressionAppFields("nonexistent", { creatorId: "x" })
        ).toThrow('Expression "nonexistent" not found in any premise.')
    })

    it("snapshot() reflects patched value and post-patch checksum", () => {
        const engine = makeAppEngine()
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-app",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: pm } = engine.createPremise()
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-app",
            argumentVersion: 1,
            premiseId: pm.getId(),
            parentId: null,
            position: 1,
        } as TExpressionInput<TAppExpression>)
        engine.flushChecksums()

        engine.patchExpressionAppFields("e1", {
            creatorId: "user-99",
            createdOn: "2026-06-26T00:00:00Z",
        })
        engine.flushChecksums()

        const snap = engine.snapshot()
        const expr = snap.premises[0].expressions.expressions.find(
            (e) => e.id === "e1"
        )

        expect(expr?.creatorId).toBe("user-99")
        expect(expr?.createdOn).toBe("2026-06-26T00:00:00Z")
        expect(expr?.checksum).toBeDefined()
        expect(expr?.checksum).not.toBeUndefined()
    })
})
