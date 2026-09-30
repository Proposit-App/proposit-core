import { describe, expect, it } from "vitest"
import {
    ArgumentEngine,
    PremiseEngine,
    createLookup,
    EMPTY_CLAIM_LOOKUP,
} from "../../src/lib/index"
import {
    type TCorePremise,
    type TCoreClaimConnection,
} from "../../src/lib/schemata"
import { VariableManager } from "../../src/lib/core/variable-manager"
import type { TExpressionInput } from "../../src/lib/core/expression-manager"
import { emptyClaimConnectionLookup } from "../../src/lib/utils/lookup"
import {
    ARG,
    aLib,
    makeVar,
    makeVarExpr,
    makeOpExpr,
    makeFormulaExpr,
    VAR_P,
    VAR_Q,
    premiseWithVars,
    makePremise,
} from "./fixtures"

// ---------------------------------------------------------------------------
// ArgumentEngine premise CRUD
// ---------------------------------------------------------------------------

describe("ArgumentEngine premise CRUD", () => {
    it("createPremise returns a PremiseEngine with a generated ID", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise({ title: "test" })
        expect(pm.toPremiseData().id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
        )
        expect((pm.toPremiseData() as Record<string, unknown>).title).toBe(
            "test"
        )
    })

    it("getPremise(id) returns the same instance", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        expect(eng.getPremise(pm.toPremiseData().id)).toBe(pm)
    })

    it("getPremise returns undefined for unknown IDs", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        expect(eng.getPremise("unknown")).toBeUndefined()
    })

    it("removePremise causes getPremise to return undefined", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        const { id } = pm.toPremiseData()
        eng.removePremise(id)
        expect(eng.getPremise(id)).toBeUndefined()
    })

    it("multiple premises coexist independently", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm1 } = eng.createPremise({ title: "first" })
        const { result: pm2 } = eng.createPremise({ title: "second" })
        pm1.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm2.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        expect(pm1.getExpressions()).toHaveLength(1)
        expect(pm2.getExpressions()).toHaveLength(1)
        expect(pm1.getExpression("expr-q")).toBeUndefined()
        expect(pm2.getExpression("expr-p")).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// PremiseEngine
// ---------------------------------------------------------------------------

describe("ArgumentEngine — addVariable / removeVariable", () => {
    it("registers a variable and allows it to be referenced in a premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getExpression("expr-p")).toMatchObject({ id: "expr-p" })
    })

    it("throws when adding a duplicate variable symbol", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        expect(() => eng.addVariable(makeVar("var-p2", "P"))).toThrow(
            /already exists/
        )
    })

    it("removes an unreferenced variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        expect(eng.removeVariable(VAR_P.id).result).toMatchObject({
            id: VAR_P.id,
        })
    })

    it("cascade-deletes expressions when removing a referenced variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable(VAR_P)
        eng.addVariable(VAR_Q)
        const { result: pm } = eng.createPremise()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))

        const { result, changes } = eng.removeVariable(VAR_P.id)
        expect(result).toMatchObject({ id: VAR_P.id })
        // The expression referencing VAR_P should have been cascade-deleted
        expect(pm.getExpression("expr-p")).toBeUndefined()
        expect(changes.expressions?.removed).toHaveLength(1)
        expect(changes.expressions?.removed[0].id).toBe("expr-p")
    })

    it("throws when adding an expression that references an unregistered variable", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const { result: pm } = eng.createPremise()
        expect(() => pm.addExpression(makeVarExpr("expr-p", VAR_P.id))).toThrow(
            /references non-existent variable/
        )
    })

    it("throws when the variable does not belong to this argument", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const foreignVar = {
            ...makeVar("var-f", "F"),
            argumentId: "other-arg",
            argumentVersion: 99,
        }
        expect(() => eng.addVariable(foreignVar)).toThrow(/does not match/)
    })
})

describe("PremiseEngine — single-root enforcement", () => {
    it("accepts the first root expression", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        ).not.toThrow()
    })

    it("throws when a second root expression is added", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(() => pm.addExpression(makeVarExpr("expr-q", VAR_Q.id))).toThrow(
            /already has a root expression/
        )
    })

    it("throws when the parent is not in this premise", () => {
        const pm = premiseWithVars()
        expect(() =>
            pm.addExpression(
                makeVarExpr("expr-p", VAR_P.id, { parentId: "ghost" })
            )
        ).toThrow(/does not exist in this premise/)
    })

    it("allows a new root after the old root is removed (premise emptied)", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.removeExpression("expr-p", true)
        expect(() =>
            pm.addExpression(makeVarExpr("expr-q", VAR_Q.id))
        ).not.toThrow()
    })
})

describe("PremiseEngine — addExpression / removeExpression / insertExpression", () => {
    it("builds a tree and getExpression finds each node", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(pm.getExpression("op-and")).toMatchObject({ type: "operator" })
        expect(pm.getExpression("expr-p")).toMatchObject({ type: "variable" })
    })

    it("removeExpression cascades through descendants", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        pm.removeExpression("op-and", true)
        expect(pm.getExpression("op-and")).toBeUndefined()
        expect(pm.getExpression("expr-p")).toBeUndefined()
        expect(pm.getExpression("expr-q")).toBeUndefined()
    })

    it("removeExpression cleans up variable references in expressionsByVariableId", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-not", "not"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-not" })
        )
        // Removing the root cascades to expr-p; the variable tracking should be cleaned up.
        pm.removeExpression("op-not", true)
        // deleteExpressionsUsingVariable should be a no-op since all refs are already gone
        const { result } = pm.deleteExpressionsUsingVariable(VAR_P.id)
        expect(result).toEqual([])
    })

    it("insertExpression wraps a node and toDisplayString reflects it", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        pm.insertExpression(makeOpExpr("op-not", "not"), "expr-p")
        expect(pm.toDisplayString()).toBe("¬(P)")
    })

    // Root promotion when a collapse leaves one child is also done by
    // the AN post-mutation hook, not by `removeExpression`; see
    // `test/grammar/an-rules.test.ts` (AN-3 rule 2).
})

describe("PremiseEngine — toDisplayString", () => {
    it("returns empty string when the premise is empty", () => {
        expect(makePremise().toDisplayString()).toBe("")
    })

    it("renders a binary operator", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        expect(pm.toDisplayString()).toBe("(P ∧ Q)")
    })

    it("renders an implies root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-impl", "implies"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, {
                parentId: "op-impl",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, {
                parentId: "op-impl",
                position: 1,
            })
        )
        expect(pm.toDisplayString()).toBe("(P → Q)")
    })

    it("renders a formula wrapper", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeFormulaExpr("f-1"))
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id, { parentId: "f-1" }))
        expect(pm.toDisplayString()).toBe("(P)")
    })
})

describe("PremiseEngine — toData", () => {
    it("returns correct id and extras", () => {
        const pm = new PremiseEngine(
            {
                id: "my-id",
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                title: "My Premise",
                type: "freeform" as const,
            } as unknown as TCorePremise,
            { argument: ARG, variables: new VariableManager() }
        )
        const data = pm.toPremiseData()
        expect(data.id).toBe("my-id")
        expect((data as Record<string, unknown>).title).toBe("My Premise")
    })

    it("rootExpressionId is absent before any expression is added", () => {
        expect(makePremise().getRootExpressionId()).toBeUndefined()
    })

    it("rootExpressionId is set after adding the root expression", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id))
        expect(pm.getRootExpressionId()).toBe("expr-p")
    })

    it("isConstraint for non-inference roots", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        expect(pm.isConstraint()).toBe(true)
        expect(pm.isInference()).toBe(false)
    })

    it("isInference for an implies root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-impl", "implies"))
        expect(pm.isInference()).toBe(true)
        expect(pm.isConstraint()).toBe(false)
    })

    it("isInference for an iff root", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-iff", "iff"))
        expect(pm.isInference()).toBe(true)
        expect(pm.isConstraint()).toBe(false)
    })

    it("isConstraint when the premise is empty", () => {
        expect(makePremise().isConstraint()).toBe(true)
        expect(makePremise().isInference()).toBe(false)
    })

    it("variables contains only referenced variables without duplicates", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p1", VAR_P.id, {
                parentId: "op-and",
                position: 0,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-p2", VAR_P.id, {
                parentId: "op-and",
                position: 1,
            })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 2 })
        )
        const variables = pm.getReferencedVariableIds()
        expect([...variables].sort()).toEqual([VAR_P.id, VAR_Q.id].sort())
    })

    it("variables does not include registered-but-unreferenced variables", () => {
        const pm = premiseWithVars() // P, Q, R all registered
        pm.addExpression(makeVarExpr("expr-p", VAR_P.id)) // only P referenced
        const variables = pm.getReferencedVariableIds()
        expect([...variables]).toEqual([VAR_P.id])
    })

    it("expressions contains all nodes in the tree", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("op-and", "and"))
        pm.addExpression(
            makeVarExpr("expr-p", VAR_P.id, { parentId: "op-and", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("expr-q", VAR_Q.id, { parentId: "op-and", position: 1 })
        )
        const ids = pm
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(ids).toEqual(["expr-p", "expr-q", "op-and"].sort())
    })
})

// ---------------------------------------------------------------------------
// Evaluation support plan
// ---------------------------------------------------------------------------

describe("PremiseEngine — validation and evaluation", () => {
    it("validateEvaluability reports empty premise", () => {
        const pm = makePremise()
        const result = pm.validateEvaluability()
        expect(result.ok).toBe(false)
        expect(result.issues.map((i) => i.code)).toContain("PREMISE_EMPTY")
    })

    it("evaluates a simple implication with diagnostics", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("impl", "implies"))
        pm.addExpression(
            makeVarExpr("p-expr", VAR_P.id, { parentId: "impl", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("q-expr", VAR_Q.id, { parentId: "impl", position: 1 })
        )

        const result = pm.evaluate({
            variables: { [VAR_P.id]: true, [VAR_Q.id]: false },
            operatorAssignments: {},
        })
        expect(result.rootValue).toBe(false)
        expect(result.premiseType).toBe("inference")
        expect(result.inferenceDiagnostic).toMatchObject({
            kind: "implies",
            antecedentTrue: true,
            consequentTrue: false,
            fired: true,
            firedAndHeld: false,
            isVacuouslyTrue: false,
        })
    })

    it("evaluates iff with directional vacuity diagnostics", () => {
        const pm = premiseWithVars()
        pm.addExpression(makeOpExpr("iff", "iff"))
        pm.addExpression(
            makeVarExpr("p-expr", VAR_P.id, { parentId: "iff", position: 0 })
        )
        pm.addExpression(
            makeVarExpr("q-expr", VAR_Q.id, { parentId: "iff", position: 1 })
        )

        const result = pm.evaluate({
            variables: { [VAR_P.id]: false, [VAR_Q.id]: true },
            operatorAssignments: {},
        })
        expect(result.rootValue).toBe(false)
        expect(result.inferenceDiagnostic).toMatchObject({
            kind: "iff",
            bothSidesTrue: false,
            bothSidesFalse: false,
        })
        if (result.inferenceDiagnostic?.kind === "iff") {
            expect(result.inferenceDiagnostic.leftToRight.isVacuouslyTrue).toBe(
                true
            )
            expect(result.inferenceDiagnostic.rightToLeft.fired).toBe(true)
        }
    })
})

// ---------------------------------------------------------------------------
// ArgumentEngine — auto-conclusion on first premise
// ---------------------------------------------------------------------------

describe("ArgumentEngine — auto-conclusion on first premise", () => {
    it("first createPremise auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm.getId())
    })

    it("first createPremiseWithId auto-sets conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { changes } = eng.createPremiseWithId("my-premise")
        expect(eng.getRoleState().conclusionPremiseId).toBe("my-premise")
        expect(changes.roles?.conclusionPremiseId).toBe("my-premise")
    })

    it("second createPremise does not change conclusion", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: first } = eng.createPremise()
        const { changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(first.getId())
        expect(changes.roles).toBeUndefined()
    })

    it("createPremise after the argument is fully drained re-fires auto-conclusion-assignment", () => {
        // The invariant guard makes `clearConclusionPremise` a
        // no-op while premises exist, so the only path to a no-conclusion
        // state on a previously non-empty argument is to drain all
        // premises. Once drained, `clearConclusionPremise` is allowed
        // (the vacuous zero-premise case), and the next `createPremise`
        // is the "first premise" again — auto-conclusion-assignment
        // re-fires.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: first } = eng.createPremise()
        eng.removePremise(first.getId())
        eng.clearConclusionPremise() // vacuous on zero-premise argument
        const { result: pm2, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(pm2.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(pm2.getId())
    })

    it("createPremise after removing conclusion premise auto-sets again", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: first } = eng.createPremise()
        eng.removePremise(first.getId())
        const { result: second, changes } = eng.createPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
        expect(changes.roles?.conclusionPremiseId).toBe(second.getId())
    })

    it("setConclusionPremise overrides auto-assignment", () => {
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremise()
        const { result: second } = eng.createPremise()
        eng.setConclusionPremise(second.getId())
        expect(eng.getRoleState().conclusionPremiseId).toBe(second.getId())
    })
})

// ---------------------------------------------------------------------------
// E-7 invariant guard — engine refuses to leave non-empty argument without
// conclusion
// ---------------------------------------------------------------------------
//
// A consumer that creates the first premise of a fresh argument and
// then calls `engine.clearConclusionPremise()` (to honor a caller's
// `role: "supporting"`) must not be able to leave the argument with one
// premise and no conclusion, which would trip E-7.
//
// The engine enforces the invariant: a non-empty argument always has a
// conclusion designated. `clearConclusionPremise()` on a non-empty
// argument is a no-op; the auto-assigned conclusion survives even when
// a caller asks to clear it, so the state is `1 premise / that premise
// is the conclusion`, and E-7 passes.
//
// E-7 itself stays strict; the validate-time safety net still catches snapshot loads or direct data-shape
// construction that the mutation-time guard cannot intercept.
describe("ArgumentEngine — E-7 invariant guard on non-empty argument", () => {
    it("createPremise + clearConclusionPremise on fresh argument keeps the premise as conclusion", () => {
        // Call sequence:
        //   1. engine.createPremiseWithId(premiseId, { type: "freeform" })
        //      → core auto-sets conclusionPremiseId = premiseId
        //   2. engine.clearConclusionPremise()
        //      → the caller asks to honor "supporting" by clearing
        // Step 2 is a no-op → 1 premise / that premise is still the
        // conclusion → E-7 passes.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "assistive",
        })
        eng.createPremiseWithId("p-supporting")
        eng.clearConclusionPremise()
        // Post-mutation state: 1 premise, that premise IS the
        // conclusion (the no-op refused to clear).
        expect(eng.listPremiseIds()).toEqual(["p-supporting"])
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-supporting")
        // Derivable validate cleanly — no E-7.
        const violations = eng.validate("derivable")
        expect(violations.filter((v) => v.code === "E-7")).toEqual([])
    })

    it("validate('presentable') is empty after clearConclusionPremise on a one-premise argument (no E-7 leakage at any tier)", () => {
        // Presentable is the strictest tier (Structural + Evaluable +
        // Derivable + Presentable). The invariant-guard post-mutation
        // state must satisfy every tier including E-7 at Evaluable.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "assistive",
        })
        eng.createPremiseWithId("p-supporting")
        eng.clearConclusionPremise()
        const violations = eng.validate("presentable")
        expect(violations.filter((v) => v.code === "E-7")).toEqual([])
    })

    it("clearConclusionPremise is a no-op on a 2+ premise argument too (guard is cardinality-independent for non-empty)", () => {
        // The invariant guard fires the same way regardless of premise
        // count — any non-empty argument must keep a conclusion.
        // Whichever premise is currently the conclusion stays the
        // conclusion across a clear attempt.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive", // permissive so AN doesn't intervene
        })
        eng.createPremiseWithId("p-1") // auto-conclusion
        eng.createPremiseWithId("p-2")
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-1")
        const { changes } = eng.clearConclusionPremise()
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-1")
        expect(changes.roles).toBeUndefined()
        // E-7 still satisfied because p-1 is still the conclusion.
        const violations = eng.validate("derivable")
        expect(violations.filter((v) => v.code === "E-7")).toEqual([])
    })

    it("E-7 still fires via validate when a snapshot is loaded with premises but no conclusion (safety net)", () => {
        // The mutation-surface guard cannot intercept snapshot loads
        // — `fromSnapshot` / `fromData` accept any Structural state
        // and surface Evaluable/Derivable/Presentable issues via
        // `validate(tier)`. E-7 remains the safety net for that
        // path. Simulated here by constructing the validator context
        // directly (the snapshot-load test for E-7 lives in
        // test/grammar/evaluable.test.ts; this asserts the
        // engine-level passthrough).
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        const { result: pm } = eng.createPremise()
        eng.setConclusionPremise(pm.getId())
        // Take a snapshot of the 1 premise / conclusion-set state,
        // then surgically reproduce the invariant break via a fresh
        // engine instance loaded from a manipulated snapshot.
        const snapshot = eng.snapshot()
        const broken = {
            ...snapshot,
            conclusionPremiseId: undefined,
        }
        const restored = ArgumentEngine.fromSnapshot(broken, aLib())
        // The restored engine accepts the snapshot (Structural-clean)
        // but `validate('evaluable')` reports the E-7 violation.
        const violations = restored.validate("evaluable")
        const e7s = violations.filter((v) => v.code === "E-7")
        expect(e7s.length).toBeGreaterThanOrEqual(1)
        expect(e7s[0].message).toMatch(/no conclusion designated/)
    })

    // --- removePremise(conclusionPremiseId) — auto-reassign on
    // multi-premise argument (invariant guard) ---
    //
    // Deleting the conclusion premise while other premises remain must
    // not leave an E-7-violating state: the engine atomically reassigns
    // conclusion to the lowest-id remaining premise (sorted
    // lexicographically) so the invariant holds across the delete.

    it("removePremise auto-reassigns conclusion to lowest-id remaining premise (2-premise argument)", () => {
        // Two explicit premise ids, chosen so the lexicographic order
        // is deterministic and the auto-promoted choice is unambiguous.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremiseWithId("p-aaa") // auto-conclusion
        eng.createPremiseWithId("p-bbb")
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-aaa")
        // Promote p-bbb to conclusion so we can test the
        // "remove-conclusion-that-isn't-also-the-lowest-id" case.
        eng.setConclusionPremise("p-bbb")
        const { changes } = eng.removePremise("p-bbb")
        // Auto-reassign picks p-aaa (lowest-id remaining).
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-aaa")
        expect(changes.roles?.conclusionPremiseId).toBe("p-aaa")
        // E-7 stays satisfied.
        expect(
            eng.validate("evaluable").filter((v) => v.code === "E-7")
        ).toEqual([])
    })

    it("removePremise cycle: 3-premise argument → delete middle conclusion → delete next conclusion → both auto-promote", () => {
        // Walk the auto-promote chain
        // across two consecutive deletes to confirm the lowest-id
        // selector composes cleanly.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremiseWithId("p-aaa")
        eng.createPremiseWithId("p-bbb")
        eng.createPremiseWithId("p-ccc")
        // Make the middle (p-bbb) the conclusion so the first delete
        // exercises the "conclusion isn't lowest-id" path.
        eng.setConclusionPremise("p-bbb")
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-bbb")

        // First delete: remove p-bbb (conclusion). Remaining: [p-aaa,
        // p-ccc]. Auto-promote picks p-aaa (lowest id).
        eng.removePremise("p-bbb")
        expect(eng.listPremiseIds()).toEqual(["p-aaa", "p-ccc"])
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-aaa")
        expect(
            eng.validate("evaluable").filter((v) => v.code === "E-7")
        ).toEqual([])

        // Second delete: remove p-aaa (now the conclusion). Remaining:
        // [p-ccc]. Auto-promote picks p-ccc (only id left).
        eng.removePremise("p-aaa")
        expect(eng.listPremiseIds()).toEqual(["p-ccc"])
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-ccc")
        expect(
            eng.validate("evaluable").filter((v) => v.code === "E-7")
        ).toEqual([])

        // Third delete: remove p-ccc (last). Remaining: []. Conclusion
        // clears (vacuous on empty argument).
        eng.removePremise("p-ccc")
        expect(eng.listPremiseIds()).toEqual([])
        expect(eng.getRoleState().conclusionPremiseId).toBeUndefined()
        expect(
            eng.validate("evaluable").filter((v) => v.code === "E-7")
        ).toEqual([])
    })

    it("removePremise on a non-conclusion premise leaves conclusionPremiseId untouched", () => {
        // The auto-reassign only fires when the deleted premise IS
        // the conclusion. Deleting a non-conclusion premise touches
        // no roles, and the changeset includes no roles delta.
        const eng = new ArgumentEngine({ id: "arg1", version: 0 }, aLib(), {
            behavior: "permissive",
        })
        eng.createPremiseWithId("p-aaa") // auto-conclusion
        eng.createPremiseWithId("p-bbb")
        const { changes } = eng.removePremise("p-bbb")
        expect(eng.getRoleState().conclusionPremiseId).toBe("p-aaa")
        expect(changes.roles).toBeUndefined()
    })
})

describe("ArgumentEngine — toDisplayString", () => {
    const ARG = { id: "arg-1", version: 1 }

    it("renders an empty argument", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        const display = eng.toDisplayString()
        expect(display).toContain("Argument: arg-1 (v1)")
    })

    it("labels conclusion premise", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: p1 } = eng.createPremise()
        p1.appendExpression(null, {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: null,
        })
        const display = eng.toDisplayString()
        expect(display).toContain("[Conclusion]")
        expect(display).toContain("P")
    })

    it("labels constraint and supporting premises correctly", () => {
        const eng = new ArgumentEngine(ARG, aLib(), { behavior: "permissive" })
        eng.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })
        eng.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 1,
            claimId: "claim-default",
            claimVersion: 0,
        })

        // p1: implies (inference) - will be conclusion (auto-assigned as first)
        const { result: p1 } = eng.createPremise()
        p1.appendExpression(null, {
            id: "op1",
            type: "operator",
            operator: "implies",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: null,
        })
        p1.appendExpression("op1", {
            id: "e1",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: "op1",
        })
        p1.appendExpression("op1", {
            id: "e2",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p1.getId(),
            parentId: "op1",
        })

        // p2: implies (inference) - will be supporting
        const { result: p2 } = eng.createPremise()
        p2.appendExpression(null, {
            id: "op2",
            type: "operator",
            operator: "implies",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p2.getId(),
            parentId: null,
        })
        p2.appendExpression("op2", {
            id: "e3",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p2.getId(),
            parentId: "op2",
        })
        p2.appendExpression("op2", {
            id: "e4",
            type: "variable",
            variableId: "v2",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p2.getId(),
            parentId: "op2",
        })

        // p3: plain variable (constraint)
        const { result: p3 } = eng.createPremise()
        p3.appendExpression(null, {
            id: "e5",
            type: "variable",
            variableId: "v1",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: p3.getId(),
            parentId: null,
        })

        const display = eng.toDisplayString()
        expect(display).toContain("[Conclusion]")
        expect(display).toContain("[Supporting]")
        expect(display).toContain("[Constraint]")
    })
})

describe("ArgumentEngine — lookup methods", () => {
    function setupEngine() {
        const arg = { id: "arg-1", version: 0 }
        const engine = new ArgumentEngine(arg, aLib(), {
            behavior: "permissive",
        })
        engine.addVariable({
            id: "v1",
            symbol: "P",
            argumentId: "arg-1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        engine.addVariable({
            id: "v2",
            symbol: "Q",
            argumentId: "arg-1",
            argumentVersion: 0,
            claimId: "claim-default",
            claimVersion: 0,
        })
        const { result: p1 } = engine.createPremiseWithId("p1")
        const { result: p2 } = engine.createPremiseWithId("p2")

        p1.addExpression({
            id: "e1",
            type: "variable" as const,
            variableId: "v1",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p1",
        })

        p2.addExpression({
            id: "op1",
            type: "operator" as const,
            operator: "and",
            parentId: null,
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        } as TExpressionInput)
        p2.addExpression({
            id: "e2",
            type: "variable" as const,
            variableId: "v1",
            parentId: "op1",
            position: 0,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        })
        p2.addExpression({
            id: "e3",
            type: "variable" as const,
            variableId: "v2",
            parentId: "op1",
            position: 1,
            argumentId: "arg-1",
            argumentVersion: 0,
            premiseId: "p2",
        })

        return { engine, p1, p2 }
    }

    describe("getVariable", () => {
        it("returns the variable by ID", () => {
            const { engine } = setupEngine()
            expect(engine.getVariable("v1")?.symbol).toBe("P")
        })

        it("returns undefined for unknown ID", () => {
            const { engine } = setupEngine()
            expect(engine.getVariable("unknown")).toBeUndefined()
        })
    })

    describe("hasVariable", () => {
        it("returns true for existing variable", () => {
            const { engine } = setupEngine()
            expect(engine.hasVariable("v1")).toBe(true)
        })

        it("returns false for unknown variable", () => {
            const { engine } = setupEngine()
            expect(engine.hasVariable("unknown")).toBe(false)
        })
    })

    describe("getVariableBySymbol", () => {
        it("returns the variable by symbol", () => {
            const { engine } = setupEngine()
            expect(engine.getVariableBySymbol("P")?.id).toBe("v1")
        })

        it("returns undefined for unknown symbol", () => {
            const { engine } = setupEngine()
            expect(engine.getVariableBySymbol("Z")).toBeUndefined()
        })

        it("reflects updates after updateVariable", () => {
            const { engine } = setupEngine()
            engine.updateVariable("v1", { symbol: "R" })
            expect(engine.getVariableBySymbol("P")).toBeUndefined()
            expect(engine.getVariableBySymbol("R")?.id).toBe("v1")
        })
    })

    describe("buildVariableIndex", () => {
        it("builds a custom-keyed map from variables", () => {
            const { engine } = setupEngine()
            const bySymbol = engine.buildVariableIndex((v) => v.symbol)
            expect(bySymbol.get("P")?.id).toBe("v1")
            expect(bySymbol.get("Q")?.id).toBe("v2")
            expect(bySymbol.size).toBe(4) // 2 claim-bound + 2 auto premise-bound
        })
    })

    describe("getExpression", () => {
        it("returns an expression from any premise by ID", () => {
            const { engine } = setupEngine()
            const e1 = engine.getExpression("e1")
            expect(e1?.id).toBe("e1")
            const e3 = engine.getExpression("e3")
            expect(e3?.id).toBe("e3")
        })

        it("returns undefined for unknown ID", () => {
            const { engine } = setupEngine()
            expect(engine.getExpression("unknown")).toBeUndefined()
        })
    })

    describe("hasExpression", () => {
        it("returns true for existing expression", () => {
            const { engine } = setupEngine()
            expect(engine.hasExpression("e1")).toBe(true)
        })

        it("returns false for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.hasExpression("unknown")).toBe(false)
        })
    })

    describe("getExpressionPremiseId", () => {
        it("returns the premiseId for an expression", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionPremiseId("e1")).toBe("p1")
            expect(engine.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("returns undefined for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionPremiseId("unknown")).toBeUndefined()
        })
    })

    describe("findPremiseByExpressionId", () => {
        it("returns the PremiseEngine containing the expression", () => {
            const { engine } = setupEngine()
            const pe = engine.findPremiseByExpressionId("e3")
            expect(pe?.getId()).toBe("p2")
        })

        it("returns undefined for unknown expression", () => {
            const { engine } = setupEngine()
            expect(engine.findPremiseByExpressionId("unknown")).toBeUndefined()
        })
    })

    describe("getAllExpressions", () => {
        it("returns all expressions across all premises sorted by ID", () => {
            const { engine } = setupEngine()
            const all = engine.getAllExpressions()
            const ids = all.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "e2", "e3", "op1"])
        })
    })

    describe("getExpressionsByVariableId", () => {
        it("returns expressions referencing the variable across premises", () => {
            const { engine } = setupEngine()
            const exprs = engine.getExpressionsByVariableId("v1")
            const ids = exprs.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "e2"])
        })

        it("returns empty array for unreferenced variable", () => {
            const { engine } = setupEngine()
            expect(engine.getExpressionsByVariableId("unknown")).toEqual([])
        })
    })

    describe("listRootExpressions", () => {
        it("returns root expressions from all premises", () => {
            const { engine } = setupEngine()
            const roots = engine.listRootExpressions()
            const ids = roots.map((e) => e.id).sort()
            expect(ids).toEqual(["e1", "op1"])
        })
    })

    describe("expression index stays in sync after mutations", () => {
        it("tracks expression removal via PremiseEngine", () => {
            const { engine, p2 } = setupEngine()
            p2.removeExpression("e2", true)
            expect(engine.hasExpression("e2")).toBe(false)
            expect(engine.hasExpression("e3")).toBe(true)
        })

        it("tracks premise removal via ArgumentEngine", () => {
            const { engine } = setupEngine()
            engine.removePremise("p1")
            expect(engine.hasExpression("e1")).toBe(false)
        })

        it("tracks cascade variable removal", () => {
            const { engine } = setupEngine()
            engine.removeVariable("v1")
            expect(engine.hasExpression("e1")).toBe(false)
            expect(engine.hasExpression("e2")).toBe(false)
        })

        it("survives snapshot round-trip", () => {
            const { engine } = setupEngine()
            const snap = engine.snapshot()
            const restored = ArgumentEngine.fromSnapshot(snap, aLib())
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives fromData round-trip", () => {
            const { engine } = setupEngine()
            const vars = engine.getVariables()
            const premises = engine
                .listPremises()
                .map((pe) => pe.toPremiseData())
            const expressions = engine.getAllExpressions()
            const roles = engine.getRoleState()
            const restored = ArgumentEngine.fromData(
                engine.getArgument(),
                aLib(),
                vars,
                premises,
                expressions,
                roles
            )
            expect(restored.getExpression("e1")?.id).toBe("e1")
            expect(restored.getExpressionPremiseId("e3")).toBe("p2")
        })

        it("survives rollback", () => {
            const { engine, p1 } = setupEngine()
            const snap = engine.snapshot()
            // e1 is the root (type variable, parentId null) — can't add children to a variable.
            // Instead, remove the root and add an operator with children.
            p1.removeExpression("e1", true)
            p1.addExpression({
                id: "op99",
                type: "operator" as const,
                operator: "and",
                parentId: null,
                position: 0,
                argumentId: "arg-1",
                argumentVersion: 0,
                premiseId: "p1",
            } as TExpressionInput)
            expect(engine.hasExpression("op99")).toBe(true)
            engine.rollback(snap)
            expect(engine.hasExpression("op99")).toBe(false)
            expect(engine.hasExpression("e1")).toBe(true)
        })
    })
})

describe("createLookup", () => {
    it("builds a lookup from an array", () => {
        const items = [
            { id: "c1", version: 0, frozen: false, checksum: "" },
            { id: "c1", version: 1, frozen: true, checksum: "abc" },
            { id: "c2", version: 0, frozen: false, checksum: "" },
        ]
        const lookup = createLookup(items, (c) => `${c.id}:${c.version}`)
        expect(lookup.get("c1", 0)).toEqual(items[0])
        expect(lookup.get("c1", 1)).toEqual(items[1])
        expect(lookup.get("c2", 0)).toEqual(items[2])
    })

    it("returns undefined for missing keys", () => {
        const lookup = createLookup(
            [] as { id: string; version: number }[],
            (c) => `${c.id}:${c.version}`
        )
        expect(lookup.get("missing", 0)).toBeUndefined()
    })

    it("last item wins when keys collide", () => {
        const items = [
            { id: "c1", version: 0, frozen: false, checksum: "first" },
            { id: "c1", version: 0, frozen: false, checksum: "second" },
        ]
        const lookup = createLookup(items, (c) => `${c.id}:${c.version}`)
        expect(lookup.get("c1", 0)?.checksum).toBe("second")
    })
})

describe("empty lookup constants", () => {
    it("EMPTY_CLAIM_LOOKUP.get returns undefined", () => {
        expect(EMPTY_CLAIM_LOOKUP.get("any", 0)).toBeUndefined()
    })

    it("emptyClaimConnectionLookup().get returns undefined", () => {
        expect(
            emptyClaimConnectionLookup<TCoreClaimConnection>().get("any")
        ).toBeUndefined()
    })

    it("emptyClaimConnectionLookup().getConnectionsForClaim returns empty array", () => {
        expect(
            emptyClaimConnectionLookup<TCoreClaimConnection>().getConnectionsForClaim(
                "any"
            )
        ).toEqual([])
    })
})
