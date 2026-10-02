import { describe, expect, it } from "vitest"
import { ArgumentEngine, ClaimLibrary } from "../../src/lib/index"
import {
    isPremiseBound,
    isExternallyBound,
    type TPremiseBoundVariable,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import {
    ARG,
    aLib,
    makeVar,
    makeVarExpr,
    makeOpExpr,
    VAR_P,
    VAR_Q,
    VAR_R,
    premiseWithVars,
} from "./fixtures"

// ---------------------------------------------------------------------------
// ArgumentEngine — variable management
// ---------------------------------------------------------------------------

describe("ArgumentEngine — variable management", () => {
    it("addVariable registers a variable accessible from all premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm1 } = eng.createPremise()
        const { result: pm2 } = eng.createPremise()

        // Both premises can add expressions referencing VAR_P
        pm1.addExpression(
            makeVarExpr("e-p1", VAR_P.id, { parentId: null, position: 1 })
        )
        pm2.addExpression(
            makeVarExpr("e-p2", VAR_P.id, { parentId: null, position: 1 })
        )

        expect(pm1.getVariables()).toHaveLength(3) // 1 claim-bound + 2 auto premise-bound
        expect(pm2.getVariables()).toHaveLength(3)
    })

    it("addVariable throws for duplicate symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        expect(() =>
            eng.addVariable({
                id: "var-other",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                claimId: "claim-default",
                claimVersion: 0,
                symbol: "P",
            })
        ).toThrow(/already exists/)
    })

    it("addVariable throws for duplicate id", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(VAR_P)).toThrow(/already exists/)
    })

    it("addVariable throws for wrong argumentId", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(() =>
            eng.addVariable({
                id: "var-x",
                argumentId: "other",
                argumentVersion: ARG.version,
                claimId: "claim-default",
                claimVersion: 0,
                symbol: "X",
            })
        ).toThrow(/does not match/)
    })

    it("addVariable throws for wrong argumentVersion", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(() =>
            eng.addVariable({
                id: "var-x",
                argumentId: ARG.id,
                argumentVersion: 99,
                claimId: "claim-default",
                claimVersion: 0,
                symbol: "X",
            })
        ).toThrow(/does not match/)
    })

    it("addVariable returns mutation result with changeset", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result, changes } = eng.addVariable(VAR_P)
        expect(result.id).toBe(VAR_P.id)
        expect(result.checksum).toBeDefined()
        expect(changes.variables?.added).toHaveLength(1)
    })

    it("updateVariable renames a symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result } = eng.updateVariable(VAR_P.id, { symbol: "P_new" })
        expect(result?.symbol).toBe("P_new")

        const { result: pm } = eng.createPremise()
        const renamedVar = pm.getVariables().find((v) => v.id === VAR_P.id)
        expect(renamedVar?.symbol).toBe("P_new")
    })

    it("updateVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result } = eng.updateVariable("nope", { symbol: "X" })
        expect(result).toBeUndefined()
    })

    it("updateVariable throws for conflicting symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        expect(() => eng.updateVariable(VAR_P.id, { symbol: "Q" })).toThrow(
            /already in use/
        )
    })

    it("updateVariable returns changeset with modified variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { changes } = eng.updateVariable(VAR_P.id, { symbol: "X" })
        expect(changes.variables?.modified).toHaveLength(1)
        expect(changes.variables?.modified[0].symbol).toBe("X")
    })

    it("getVariables returns all variables with checksums", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const vars = eng.getVariables()
        expect(vars).toHaveLength(2)
        expect(vars[0].checksum).toBeDefined()
        expect(vars[1].checksum).toBeDefined()
    })

    it("removeVariable with no references removes cleanly", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result, changes } = eng.removeVariable(VAR_P.id)
        expect(result?.id).toBe(VAR_P.id)
        expect(changes.variables?.removed).toHaveLength(1)
        expect(eng.getVariables()).toHaveLength(0)
    })

    it("removeVariable returns undefined for non-existent variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result, changes } = eng.removeVariable("nonexistent")
        expect(result).toBeUndefined()
        expect(changes).toEqual({})
    })

    it("removeVariable cascade-deletes referencing expressions in one premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()

        // Add two root-level expressions (only one root allowed, so use an and operator)
        pm.addExpression(
            makeOpExpr("op-and", "and", { parentId: null, position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: "op-and", position: 1 })
        )
        pm.addExpression(
            makeVarExpr("e-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )

        const { changes } = eng.removeVariable(VAR_P.id)
        // e-p gone, operator collapsed (1 child remaining → Q promoted)
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(pm.getExpression("e-q")).toBeDefined()
        expect(changes.expressions?.removed.length).toBeGreaterThan(0)
    })

    it("removeVariable cascade-deletes across multiple premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm1 } = eng.createPremise()
        const { result: pm2 } = eng.createPremise()

        pm1.addExpression(
            makeVarExpr("e-p1", VAR_P.id, { parentId: null, position: 1 })
        )
        pm2.addExpression(
            makeVarExpr("e-p2", VAR_P.id, { parentId: null, position: 1 })
        )

        eng.removeVariable(VAR_P.id)

        expect(pm1.getExpression("e-p1")).toBeUndefined()
        expect(pm2.getExpression("e-p2")).toBeUndefined()
    })

    // removeVariable cascade-deletes referencing expressions Structurally,
    // but the operator's 1-child cleanup is owned by the AN-3
    // post-hook (assistive) or left as a P-3 violation surfaced via
    // validate('presentable') (permissive). The cascade-delete
    // primitive itself is covered by other tests in this describe
    // block; the AN-3 promotion contract is covered by
    // `test/grammar/an-rules.test.ts`.
})

// ---------------------------------------------------------------------------
// PremiseEngine — deleteExpressionsUsingVariable
// ---------------------------------------------------------------------------

describe("PremiseEngine — deleteExpressionsUsingVariable", () => {
    it("returns empty result when variable has no expressions", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        const { result, changes } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(0)
        expect(changes).toEqual({})
    })

    it("deletes a single variable expression", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()

        pm.addExpression(
            makeVarExpr("e-p", VAR_P.id, { parentId: null, position: 1 })
        )

        const { result, changes } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toHaveLength(1)
        expect(pm.getExpression("e-p")).toBeUndefined()
        expect(changes.expressions?.removed.length).toBeGreaterThan(0)
    })

    // deleteExpressionsUsingVariable deletes only the matching
    // expressions (and their subtrees); any resulting operator/formula cleanup is owned by the AN-3
    // post-hook. The primitive's own cascade behavior is covered by
    // "deletes a single variable expression" + the assistive
    // post-hook tests in `test/grammar/auto-normalize.test.ts`.
})

// ---------------------------------------------------------------------------
// Variable expressions cannot have children
// ---------------------------------------------------------------------------

describe("variable expressions cannot have children", () => {
    it("addExpression rejects a child whose parent is a variable expression", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.addExpression(
                makeVarExpr("expr-q", VAR_Q.id, { parentId: "expr-p" })
            )
        ).toThrow(/is not an operator expression/)
    })

    it("insertExpression rejects inserting a variable expression (which would gain children)", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() =>
            premise.insertExpression(
                makeVarExpr("wrap-var", VAR_Q.id),
                "expr-p"
            )
        ).toThrow(/variable.*cannot have children/i)
    })

    it("insertExpression rejects a variable expression wrapping two nodes", () => {
        const premise = premiseWithVars()
        premise.addExpression(makeOpExpr("op-and", "and"))
        premise.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        premise.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        expect(() =>
            premise.insertExpression(
                makeVarExpr("wrap-var", VAR_R.id),
                "expr-p",
                "expr-q"
            )
        ).toThrow(/variable.*cannot have children/i)
    })
})

describe("VariableManager — getVariableBySymbol", () => {
    const makeVar = (id: string, symbol: string) => ({
        id,
        symbol,
        argumentId: "arg-1",
        argumentVersion: 0,
        claimId: "claim-default",
        claimVersion: 0,
        checksum: "x",
    })

    it("returns undefined for unknown symbol", () => {
        const vm = new VariableManager()
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
    })

    it("returns the variable matching the symbol", () => {
        const vm = new VariableManager()
        const v = makeVar("v1", "P")
        vm.addVariable(v)
        expect(vm.getVariableBySymbol("P")).toEqual(v)
    })

    it("returns undefined after the variable is removed", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.removeVariable("v1")
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
    })

    it("tracks symbol changes after rename", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.renameVariable("v1", "Q")
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
        expect(vm.getVariableBySymbol("Q")?.id).toBe("v1")
    })

    it("tracks symbol changes after updateVariable", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.updateVariable("v1", { symbol: "R" })
        expect(vm.getVariableBySymbol("P")).toBeUndefined()
        expect(vm.getVariableBySymbol("R")?.id).toBe("v1")
    })

    it("survives snapshot round-trip", () => {
        const vm = new VariableManager()
        vm.addVariable(makeVar("v1", "P"))
        vm.addVariable(makeVar("v2", "Q"))
        const restored = VariableManager.fromSnapshot(vm.snapshot())
        expect(restored.getVariableBySymbol("P")?.id).toBe("v1")
        expect(restored.getVariableBySymbol("Q")?.id).toBe("v2")
    })
})

describe("cross-argument variable binding", () => {
    it("isExternallyBound returns true when boundArgumentId differs", () => {
        const variable: TPremiseBoundVariable = {
            id: "v-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "",
            boundPremiseId: "p-1",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 1,
        }
        expect(isExternallyBound(variable, "arg-1")).toBe(true)
    })

    it("isExternallyBound returns false when boundArgumentId matches", () => {
        const variable: TPremiseBoundVariable = {
            id: "v-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            symbol: "P",
            checksum: "",
            boundPremiseId: "p-1",
            boundArgumentId: "arg-1",
            boundArgumentVersion: 0,
        }
        expect(isExternallyBound(variable, "arg-1")).toBe(false)
    })

    it("createPremise auto-creates a premise-bound variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm, changes } = eng.createPremise()

        // Changeset includes a variable addition
        expect(changes.variables?.added).toBeDefined()
        expect(changes.variables!.added.length).toBeGreaterThanOrEqual(1)

        const autoVar = changes.variables!.added.find((v) => isPremiseBound(v))!
        expect(autoVar).toBeDefined()

        // Variable is bound to the new premise
        const pmVar = autoVar as unknown as TPremiseBoundVariable
        expect(pmVar.boundPremiseId).toBe(pm.getId())
        expect(pmVar.boundArgumentId).toBe(ARG.id)
        expect(pmVar.boundArgumentVersion).toBe(ARG.version)

        // Auto-generated symbol
        expect(pmVar.symbol).toBe("P0")
    })

    it("createPremise accepts a custom symbol for the auto-variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { changes } = eng.createPremise(undefined, "MyPremise")
        const autoVar = changes.variables!.added.find((v) => isPremiseBound(v))!
        expect((autoVar as unknown as TPremiseBoundVariable).symbol).toBe(
            "MyPremise"
        )
    })

    it("createPremise auto-generates unique symbols on collision", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { changes: c1 } = eng.createPremise()
        const { changes: c2 } = eng.createPremise()
        const sym1 = (
            c1.variables!.added.find((v) =>
                isPremiseBound(v)
            )! as unknown as TPremiseBoundVariable
        ).symbol
        const sym2 = (
            c2.variables!.added.find((v) =>
                isPremiseBound(v)
            )! as unknown as TPremiseBoundVariable
        ).symbol
        expect(sym1).not.toBe(sym2)
        expect(sym1).toBe("P0")
        expect(sym2).toBe("P1")
    })

    it("canBind rejects when overridden to return false", () => {
        class RestrictedEngine extends ArgumentEngine {
            protected override canBind(
                _boundArgumentId: string,
                _boundArgumentVersion: number
            ): boolean {
                return false
            }
        }
        const eng = new RestrictedEngine(ARG, aLib())
        expect(() =>
            eng.bindVariableToExternalPremise({
                id: "v-ext",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "Ext",
                boundPremiseId: "p-other",
                boundArgumentId: "arg-other",
                boundArgumentVersion: 0,
            })
        ).toThrow()
    })

    it("bindVariableToExternalPremise registers an externally bound variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: varResult } = eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-in-other-arg",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 2,
        })

        expect(varResult.id).toBe("v-ext")
        expect(varResult.symbol).toBe("ExtVar")

        const retrieved = eng.getVariable("v-ext")
        expect(retrieved).toBeDefined()
        expect(isPremiseBound(retrieved!)).toBe(true)
        const pv = retrieved! as unknown as TPremiseBoundVariable
        expect(pv.boundArgumentId).toBe("arg-other")
        expect(pv.boundArgumentVersion).toBe(2)
        expect(pv.boundPremiseId).toBe("p-in-other-arg")
    })

    it("bindVariableToExternalPremise rejects internal binding", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(() =>
            eng.bindVariableToExternalPremise({
                id: "v-int",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "IntVar",
                boundPremiseId: "p1",
                boundArgumentId: ARG.id,
                boundArgumentVersion: ARG.version,
            })
        ).toThrow(/internal/)
    })

    it("bindVariableToArgument sets boundPremiseId to conclusionPremiseId", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.bindVariableToArgument(
            {
                id: "v-arg",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                symbol: "ArgRef",
                boundArgumentId: "arg-other",
                boundArgumentVersion: 3,
            },
            "conclusion-premise-in-other-arg"
        )

        const retrieved = eng.getVariable("v-arg")!
        const pv = retrieved as unknown as TPremiseBoundVariable
        expect(pv.boundPremiseId).toBe("conclusion-premise-in-other-arg")
        expect(pv.boundArgumentId).toBe("arg-other")
        expect(pv.boundArgumentVersion).toBe(3)
    })

    it("evaluation: internal binding is still lazily resolved", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("v-p", "X"))
        const { result: pm1 } = eng.createPremiseWithId("p1")
        pm1.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-p",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })

        // Find the auto-created variable for p1
        const autoVarId = eng
            .getVariables()
            .find(
                (v) =>
                    isPremiseBound(v) &&
                    (v as unknown as TPremiseBoundVariable).boundPremiseId ===
                        "p1"
            )!.id

        const { result: pm2 } = eng.createPremiseWithId("p2")
        pm2.addExpression({
            id: "e2",
            type: "variable",
            variableId: autoVarId,
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p2",
        })

        // Set p2 as conclusion so evaluate works
        eng.setConclusionPremise("p2")

        // X = true -> pm1 evaluates to true -> auto-variable resolves to true -> pm2 = true
        const result = eng.evaluate({
            variables: { "v-p": true },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        // p2 uses the auto-variable bound to p1; p1 is a supporting premise
        // The conclusion (p2) should resolve to true via lazy internal binding
        expect(result.conclusionTrue).toBe(true)
    })

    it("evaluation: external binding is evaluator-assigned", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-ext",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })

        // Set conclusion so evaluate works
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { "v-ext": true },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        expect(result.conclusionTrue).toBe(true)
    })

    it("truth table: external binding included in columns", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-ext",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })
        eng.setConclusionPremise("p1")

        const validity = eng.checkValidity({ mode: "exhaustive" })
        expect(validity.ok).toBe(true)
        expect(validity.checkedVariableIds).toContain("v-ext")
        expect(validity.numAssignmentsChecked).toBeGreaterThan(0)
    })

    it("fromSnapshot restores both internal and external bound variables", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(makeVar("v-claim", "Claim"))
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "ExtVar",
            boundPremiseId: "p-other",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 2,
        })

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression({
            id: "e1",
            type: "variable",
            variableId: "v-ext",
            parentId: null,
            position: 0,
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: "p1",
        })

        eng.setConclusionPremise("p1")

        const snap = eng.snapshot()
        const restored = ArgumentEngine.fromSnapshot(snap, aLib())

        const vars = restored.getVariables()
        const extVar = vars.find((v) => v.id === "v-ext")
        expect(extVar).toBeDefined()
        expect(isPremiseBound(extVar!)).toBe(true)
        const pv = extVar! as unknown as TPremiseBoundVariable
        expect(pv.boundArgumentId).toBe("arg-other")

        // Evaluation still works after restoration
        const result = restored.evaluate({
            variables: { "v-ext": true, "v-claim": false },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
    })
})

describe("ensureClaimBoundVariable", () => {
    function setupArgumentWithClaim() {
        const claimLib = new ClaimLibrary()
        const claim = claimLib.create({ type: "normal" })
        const claimId = claim.id
        const argumentEngine = new ArgumentEngine(ARG, claimLib, {
            behavior: "permissive",
        })
        return { argumentEngine, claimLib, claimId }
    }

    it("creates a new claim-bound variable when none exists", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const variable = argumentEngine.ensureClaimBoundVariable(claimId)
        expect(variable.claimId).toBe(claimId)
        expect(variable.symbol).toMatch(/^[A-Z]/)
        expect(
            argumentEngine.getVariables().find((v) => v.id === variable.id)
        ).toBeDefined()
    })

    it("returns the existing variable when one is already bound to the claim", () => {
        const { argumentEngine, claimId } = setupArgumentWithClaim()
        const first = argumentEngine.ensureClaimBoundVariable(claimId)
        const second = argumentEngine.ensureClaimBoundVariable(claimId)
        expect(second.id).toBe(first.id)
    })

    it("pins to the current claim version from the library", () => {
        const { argumentEngine, claimLib, claimId } = setupArgumentWithClaim()
        // freeze() bumps the version to 1 (the new current)
        claimLib.freeze(claimId)
        const variable = argumentEngine.ensureClaimBoundVariable(claimId)
        expect(variable.claimVersion).toBe(1)
    })

    it("throws CLAIM_NOT_FOUND when the claim is not in the library", () => {
        const { argumentEngine } = setupArgumentWithClaim()
        expect(() =>
            argumentEngine.ensureClaimBoundVariable(
                "00000000-0000-0000-0000-000000000999"
            )
        ).toThrow(/CLAIM_NOT_FOUND/)
    })
})

describe("a binding into another argument whose premise shares a local premise's id", () => {
    const setup = () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: local } = eng.createPremiseWithId("p1")
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Ext",
            boundPremiseId: "p1",
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })
        return { eng, local }
    }

    it("is not one of the variables bound to the local premise", () => {
        const { eng } = setup()
        expect(
            eng.getVariablesBoundToPremise("p1").map((v) => v.id)
        ).not.toContain("v-ext")
    })

    it("survives removing the local premise", () => {
        const { eng } = setup()
        eng.removePremise("p1")
        expect(eng.getVariable("v-ext")).toBeDefined()
    })

    it("can be placed in the local premise without a circularity error", () => {
        const { local } = setup()
        expect(() =>
            local.addExpression(
                makeVarExpr("e-ext", "v-ext", {
                    parentId: null,
                    position: 1,
                    premiseId: "p1",
                })
            )
        ).not.toThrow()
    })
})

describe("the empty-bound-premise warning for a binding into another argument", () => {
    const placeInLocalPremise = (boundPremiseId: string) => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.createPremiseWithId("p1")
        const { result: user } = eng.createPremiseWithId("p2")
        eng.bindVariableToExternalPremise({
            id: "v-ext",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Ext",
            boundPremiseId,
            boundArgumentId: "arg-other",
            boundArgumentVersion: 0,
        })
        user.addExpression(
            makeVarExpr("e-ext", "v-ext", {
                parentId: null,
                position: 1,
                premiseId: "p2",
            })
        )
        return user
    }
    const emptyBoundWarnings = (user: ReturnType<typeof placeInLocalPremise>) =>
        user
            .validateEvaluability()
            .issues.filter((i) => i.code === "EXPR_BOUND_PREMISE_EMPTY")

    it("is not raised when no local premise has the bound premise's id", () => {
        expect(emptyBoundWarnings(placeInLocalPremise("p-remote"))).toEqual([])
    })

    it("is not raised when an empty local premise shares the bound premise's id", () => {
        expect(emptyBoundWarnings(placeInLocalPremise("p1"))).toEqual([])
    })
})
