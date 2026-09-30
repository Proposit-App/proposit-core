import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    ClaimLibrary,
    InvalidArgumentStructureError,
    UnknownExpressionError,
    NotOperatorNotDecidableError,
    collectArgumentReferencedClaims,
    canonicalizeOperatorAssignments,
} from "../../src/lib/index"
import { isPremiseBound } from "../../src/lib/schemata"
import { CONTESTED } from "../../src/lib/types/evaluation"
import {
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "../../src/lib/core/evaluation/argument-evaluation"
import {
    ARG,
    aLib,
    makeVar,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
} from "./fixtures"

// ---------------------------------------------------------------------------
// Operator constraint propagation
// ---------------------------------------------------------------------------

describe("operator constraint propagation", () => {
    it("implies accepted, antecedent true -> consequent derived true", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        // Single premise: A -> B (conclusion)
        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("impl", "implies", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "impl",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "impl",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: { impl: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: implies accepted + A=true => B must be true
        expect(result.assignment!.variables.vB).toBe(true)
        expect(result.conclusionTrue).toBe(true)
    })

    it("implies accepted, consequent false -> antecedent derived false", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("impl", "implies", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "impl",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "impl",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: null, vB: false },
            operatorAssignments: { impl: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: implies accepted + B=false => A must be false (modus tollens)
        expect(result.assignment!.variables.vA).toBe(false)
    })

    it("and accepted -> both children derived true", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("conj", "and", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "conj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "conj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: null, vB: null },
            operatorAssignments: { conj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: and accepted => both children must be true
        expect(result.assignment!.variables.vA).toBe(true)
        expect(result.assignment!.variables.vB).toBe(true)
    })

    it("or accepted, one child false -> other derived true", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("disj", "or", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "disj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "disj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: false, vB: null },
            operatorAssignments: { disj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: or accepted + A=false => B must be true
        expect(result.assignment!.variables.vB).toBe(true)
    })

    it("not accepted -> child derived false", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        eng.addVariable(vA)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("neg", "not", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "neg",
                position: 0,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: null },
            operatorAssignments: { neg: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: not accepted (= true) => child must be false
        expect(result.assignment!.variables.vA).toBe(false)
    })

    it("iff accepted -> bidirectional propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("bic", "iff", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "bic",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "bic",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: { bic: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation: iff accepted + A=true => B must be true
        expect(result.assignment!.variables.vB).toBe(true)
    })

    it("cross-premise fixed-point propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        const vC = makeVar("vC", "C")
        eng.addVariable(vA)
        eng.addVariable(vB)
        eng.addVariable(vC)

        // Premise 1 (supporting): A -> B
        const { result: pm1 } = eng.createPremiseWithId("p1")
        pm1.addExpression(makeOpExpr("impl1", "implies", { premiseId: "p1" }))
        pm1.addExpression(
            makeVarExpr("e1-a", "vA", {
                parentId: "impl1",
                position: 0,
                premiseId: "p1",
            })
        )
        pm1.addExpression(
            makeVarExpr("e1-b", "vB", {
                parentId: "impl1",
                position: 1,
                premiseId: "p1",
            })
        )

        // Premise 2 (conclusion): B -> C
        const { result: pm2 } = eng.createPremiseWithId("p2")
        pm2.addExpression(makeOpExpr("impl2", "implies", { premiseId: "p2" }))
        pm2.addExpression(
            makeVarExpr("e2-b", "vB", {
                parentId: "impl2",
                position: 0,
                premiseId: "p2",
            })
        )
        pm2.addExpression(
            makeVarExpr("e2-c", "vC", {
                parentId: "impl2",
                position: 1,
                premiseId: "p2",
            })
        )

        eng.setConclusionPremise("p2")

        const result = eng.evaluate({
            variables: { vA: true, vB: null, vC: null },
            operatorAssignments: { impl1: "accepted", impl2: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Propagation across premises:
        //   impl1 accepted + A=true => B=true
        //   impl2 accepted + B=true => C=true
        expect(result.assignment!.variables.vB).toBe(true)
        expect(result.assignment!.variables.vC).toBe(true)
        expect(result.conclusionTrue).toBe(true)
    })

    it("a granted step contradicting the reader's assignment contests it", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("conj", "and", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "conj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "conj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        // User explicitly sets A=false; the accepted conjunction forces both
        // conjuncts true, so A is told both and B is told true.
        const result = eng.evaluate({
            variables: { vA: false, vB: null },
            operatorAssignments: { conj: "accepted" },
        })
        expect(result.ok).toBe(true)
        expect(result.assignment!.variables.vA).toBe(CONTESTED)
        expect(result.assignment!.variables.vB).toBe(true)
        expect(result.variableProvenance?.vA).toMatchObject({
            value: CONTESTED,
            origin: "contested",
        })
        // contested AND true = contested
        expect(result.conclusionTrue).toBe(CONTESTED)
    })

    it("no propagation for unset operators", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("impl", "implies", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "impl",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "impl",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        // No operator assignment — no propagation should occur
        const result = eng.evaluate({
            variables: { vA: true, vB: null },
            operatorAssignments: {},
        })
        expect(result.ok).toBe(true)
        // B should remain null — no propagation without operator assignment
        expect(result.assignment!.variables.vB).toBeNull()
        expect(result.conclusionTrue).toBeNull()
    })

    it("or accepted, both unknown -> no propagation", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const vA = makeVar("vA", "A")
        const vB = makeVar("vB", "B")
        eng.addVariable(vA)
        eng.addVariable(vB)

        const { result: pm } = eng.createPremiseWithId("p1")
        pm.addExpression(makeOpExpr("disj", "or", { premiseId: "p1" }))
        pm.addExpression(
            makeVarExpr("e-a", "vA", {
                parentId: "disj",
                position: 0,
                premiseId: "p1",
            })
        )
        pm.addExpression(
            makeVarExpr("e-b", "vB", {
                parentId: "disj",
                position: 1,
                premiseId: "p1",
            })
        )
        eng.setConclusionPremise("p1")

        // Or accepted but both children unknown — insufficient info to derive either
        const result = eng.evaluate({
            variables: { vA: null, vB: null },
            operatorAssignments: { disj: "accepted" },
        })
        expect(result.ok).toBe(true)
        // Cannot determine which disjunct is true — both remain null
        expect(result.assignment!.variables.vA).toBeNull()
        expect(result.assignment!.variables.vB).toBeNull()
    })
})

describe("review helper errors", () => {
    it("InvalidArgumentStructureError carries a message and name", () => {
        const err = new InvalidArgumentStructureError("bad structure")
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("InvalidArgumentStructureError")
        expect(err.message).toBe("bad structure")
    })

    it("UnknownExpressionError carries the bad id", () => {
        const err = new UnknownExpressionError("expr-xyz")
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("UnknownExpressionError")
        expect(err.expressionId).toBe("expr-xyz")
        expect(err.message).toContain("expr-xyz")
    })

    it("NotOperatorNotDecidableError on a NOT operator carries reason and id", () => {
        const err = new NotOperatorNotDecidableError(
            "expr-not",
            "is-not-operator"
        )
        expect(err).toBeInstanceOf(Error)
        expect(err.name).toBe("NotOperatorNotDecidableError")
        expect(err.expressionId).toBe("expr-not")
        expect(err.reason).toBe("is-not-operator")
        expect(err.message).toContain("expr-not")
    })

    it("NotOperatorNotDecidableError on a non-operator expression carries reason", () => {
        const err = new NotOperatorNotDecidableError(
            "expr-var",
            "not-an-operator-type"
        )
        expect(err.reason).toBe("not-an-operator-type")
        expect(err.message).toContain("expr-var")
    })
})

describe("PremiseEngine — getDecidableOperatorExpressions", () => {
    it("returns [or] for a single or(a,b)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "P or Q" })
        const orId = `${pm.getId()}-or`
        pm.addExpression(makeOpExpr(orId, "or"))
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, { parentId: orId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, { parentId: orId, position: 1 })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([orId])
    })

    it("returns [and, or] in pre-order for and(or(a,b), c)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(makeVar("var-r", "R"))
        const { result: pm } = eng.createPremise({ title: "(P or Q) and R" })
        const andId = `${pm.getId()}-and`
        const orId = `${pm.getId()}-or`
        const formulaId = `${pm.getId()}-formula`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(orId, "or", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, { parentId: orId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, { parentId: orId, position: 1 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-r`, "var-r", { parentId: andId, position: 1 })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId, orId])
    })

    it("excludes NOT inside a premise: and(not(a), b) returns [and]", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "not(P) and Q" })
        const andId = `${pm.getId()}-and`
        const notId = `${pm.getId()}-not`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeOpExpr(notId, "not", { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${notId}-p`, VAR_P.id, {
                parentId: notId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-q`, VAR_Q.id, {
                parentId: andId,
                position: 1,
            })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId])
    })

    it("excludes wrapping NOT but keeps inner AND: not(and(a,b)) returns [and]", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise({ title: "not(P and Q)" })
        const notId = `${pm.getId()}-not`
        const formulaId = `${pm.getId()}-formula`
        const andId = `${pm.getId()}-and`
        pm.addExpression(makeOpExpr(notId, "not"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: notId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(andId, "and", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-p`, VAR_P.id, {
                parentId: andId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-q`, VAR_Q.id, {
                parentId: andId,
                position: 1,
            })
        )
        const result = pm.getDecidableOperatorExpressions()
        expect(result.map((e) => e.id)).toEqual([andId])
    })

    it("returns [] for a single-variable premise with no operators", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
        expect(pm.getDecidableOperatorExpressions()).toEqual([])
    })

    it("returns [] for an empty premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise({ title: "empty" })
        expect(pm.getDecidableOperatorExpressions()).toEqual([])
    })
})

describe("collectArgumentReferencedClaims", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    it("returns only the conclusion's claims when there are no supporting premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        pm.addExpression(makeVarExpr(`${pm.getId()}-p`, VAR_P.id))
        eng.setConclusionPremise(pm.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
        expect(r.byId["claim-default"].variableIds).toEqual([VAR_P.id])
        expect(r.byId["claim-default"].premiseIds).toEqual([pm.getId()])
        expect(r.byId["claim-default"].claimVersion).toBe(0)
    })

    it("emits a claim once at its first occurrence when shared across premises", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: support } = eng.createPremise({ title: "P (support)" })
        const { result: conclusion } = eng.createPremise({ title: "P (conc)" })
        support.addExpression(makeVarExpr(`${support.getId()}-p`, VAR_P.id))
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-p`, VAR_P.id)
        )
        eng.setConclusionPremise(conclusion.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
        expect(r.byId["claim-default"].premiseIds).toHaveLength(2)
        expect(r.byId["claim-default"].variableIds).toEqual([VAR_P.id])
    })

    it("skips premise-bound variables (no bound claim)", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: inner } = eng.createPremise({ title: "inner: P" })
        inner.addExpression(makeVarExpr(`${inner.getId()}-p`, VAR_P.id))
        const { result: outer } = eng.createPremise({ title: "outer" })
        const varsBound = eng.getVariables().filter((v) => isPremiseBound(v))
        expect(varsBound.length).toBeGreaterThan(0)
        void outer

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-default"])
    })

    it("throws InvalidArgumentStructureError when two variables bind the same claim with different versions", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-shared", type: "normal" })
        // freeze() leaves v0 (frozen) AND v1 (new mutable copy) both reachable.
        lib.freeze("claim-shared")

        const eng = new ArgumentEngine(ARG, lib, { behavior: "permissive" })
        eng.addVariable({
            id: "var-v0",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "X",
            claimId: "claim-shared",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "var-v1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "Y",
            claimId: "claim-shared",
            claimVersion: 1,
        })
        const { result: pm } = eng.createPremise({ title: "pm" })
        const andId = `${pm.getId()}-and`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeVarExpr(`${andId}-x`, "var-v0", {
                parentId: andId,
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-y`, "var-v1", {
                parentId: andId,
                position: 1,
            })
        )
        eng.setConclusionPremise(pm.getId())

        expect(() => collectArgumentReferencedClaims(evalCtxFrom(eng))).toThrow(
            InvalidArgumentStructureError
        )
    })

    it("orders claims by supporting → conclusion → constraint, then by first tree-order reference", () => {
        const lib = new ClaimLibrary()
        lib.create({ id: "claim-a", type: "normal" })
        lib.create({ id: "claim-b", type: "normal" })
        const eng = new ArgumentEngine(ARG, lib, { behavior: "permissive" })
        eng.addVariable({
            id: "var-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "A",
            claimId: "claim-a",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "var-b",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            symbol: "B",
            claimId: "claim-b",
            claimVersion: 0,
        })
        const { result: support } = eng.createPremise({ title: "B -> A" })
        const implId = `${support.getId()}-impl`
        support.addExpression(makeOpExpr(implId, "implies"))
        support.addExpression(
            makeVarExpr(`${implId}-b`, "var-b", {
                parentId: implId,
                position: 0,
            })
        )
        support.addExpression(
            makeVarExpr(`${implId}-a`, "var-a", {
                parentId: implId,
                position: 1,
            })
        )
        const { result: conclusion } = eng.createPremise({ title: "A" })
        conclusion.addExpression(
            makeVarExpr(`${conclusion.getId()}-a`, "var-a")
        )
        eng.setConclusionPremise(conclusion.getId())

        const r = collectArgumentReferencedClaims(evalCtxFrom(eng))
        expect(r.claimIds).toEqual(["claim-b", "claim-a"])
    })
})

describe("canonicalizeOperatorAssignments", () => {
    function evalCtxFrom(eng: ArgumentEngine): TArgumentEvaluationContext {
        return {
            argumentId: eng.getArgument().id,
            conclusionPremiseId: eng.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                eng.getConclusionPremise() as TEvaluablePremise | undefined,
            listSupportingPremises: () =>
                eng.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () => eng.listPremises() as TEvaluablePremise[],
            getVariable: (id) => eng.getVariable(id),
            getPremise: (id) =>
                eng.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => eng.validateEvaluability(),
        }
    }

    /** Builds eng with one premise containing AND(OR(p,q), r). Returns ids. */
    function buildNested(): {
        eng: ArgumentEngine
        premiseId: string
        andId: string
        orId: string
    } {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        eng.addVariable(makeVar("var-r", "R"))
        const { result: pm } = eng.createPremise({ title: "(P or Q) and R" })
        const andId = `${pm.getId()}-and`
        const orId = `${pm.getId()}-or`
        const formulaId = `${pm.getId()}-formula`
        pm.addExpression(makeOpExpr(andId, "and"))
        pm.addExpression(
            makeFormulaExpr(formulaId, { parentId: andId, position: 0 })
        )
        pm.addExpression(
            makeOpExpr(orId, "or", { parentId: formulaId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-p`, VAR_P.id, { parentId: orId, position: 0 })
        )
        pm.addExpression(
            makeVarExpr(`${orId}-q`, VAR_Q.id, { parentId: orId, position: 1 })
        )
        pm.addExpression(
            makeVarExpr(`${andId}-r`, "var-r", { parentId: andId, position: 1 })
        )
        eng.setConclusionPremise(pm.getId())
        return { eng, premiseId: pm.getId(), andId, orId }
    }

    it("empty input returns {}", () => {
        const { eng } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: {},
        })
        expect(r).toEqual({})
    })

    it("premiseScope fans out to every non-NOT operator in the premise", () => {
        const { eng, premiseId, andId, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: { [premiseId]: "accepted" },
        })
        expect(r).toEqual({
            [andId]: "accepted",
            [orId]: "accepted",
        })
    })

    it("expressionOverrides win over premiseScope fan-out", () => {
        const { eng, premiseId, andId, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: { [premiseId]: "accepted" },
            expressionOverrides: { [orId]: "rejected" },
        })
        expect(r).toEqual({
            [andId]: "accepted",
            [orId]: "rejected",
        })
    })

    it("expressionOverrides alone produce assignments even when parent premise is not in premiseScope", () => {
        const { eng, orId } = buildNested()
        const r = canonicalizeOperatorAssignments(evalCtxFrom(eng), {
            premiseScope: {},
            expressionOverrides: { [orId]: "rejected" },
        })
        expect(r).toEqual({ [orId]: "rejected" })
    })

    it("unknown expression id throws UnknownExpressionError", () => {
        const { eng } = buildNested()
        expect(() =>
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { "not-a-real-id": "accepted" },
            })
        ).toThrow(UnknownExpressionError)
    })

    it("NOT override throws NotOperatorNotDecidableError with reason=is-not-operator", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "not P" })
        const notId = `${pm.getId()}-not`
        pm.addExpression(makeOpExpr(notId, "not"))
        pm.addExpression(
            makeVarExpr(`${notId}-p`, VAR_P.id, {
                parentId: notId,
                position: 0,
            })
        )
        eng.setConclusionPremise(pm.getId())

        expect(() =>
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [notId]: "accepted" },
            })
        ).toThrow(NotOperatorNotDecidableError)
        try {
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [notId]: "accepted" },
            })
            expect.fail("expected throw")
        } catch (e) {
            expect(e).toBeInstanceOf(NotOperatorNotDecidableError)
            expect((e as NotOperatorNotDecidableError).reason).toBe(
                "is-not-operator"
            )
        }
    })

    it("override on a non-operator expression throws NotOperatorNotDecidableError with reason=not-an-operator-type", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise({ title: "P" })
        const varExprId = `${pm.getId()}-p`
        pm.addExpression(makeVarExpr(varExprId, VAR_P.id))
        eng.setConclusionPremise(pm.getId())

        try {
            canonicalizeOperatorAssignments(evalCtxFrom(eng), {
                premiseScope: {},
                expressionOverrides: { [varExprId]: "accepted" },
            })
            expect.fail("expected throw")
        } catch (e) {
            expect(e).toBeInstanceOf(NotOperatorNotDecidableError)
            expect((e as NotOperatorNotDecidableError).reason).toBe(
                "not-an-operator-type"
            )
        }
    })
})
