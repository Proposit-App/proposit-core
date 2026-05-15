// AN rule set per-rule tests.
//
// Per the Phase D plan (`docs/superpowers/plans/grammar-tiers-core-plan.md`
// D0a step 1): "Add unit tests per rule in test/grammar/an-rules.test.ts".
// These assert the contract every `applyAN*` must honor — the eventual
// native rewrite (D0b-D0e) must keep these green.
//
// D0a scaffold: each `applyAN*` currently delegates to the legacy
// `pe.normalizeExpressions()` full sweep, so an `applyAN2` call also
// fires AN-1/3/4 — the rule-level isolation is a future state. Tests
// here therefore check that the AN end-state is reached after the call,
// without asserting "only AN-N fired". When the native rewrites land
// the tests stay valid (each rule still produces the documented
// effect); a stricter set of "rule N is no-op when its pattern is
// absent" tests can be added at that point.

import { describe, it, expect, vi } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import {
    applyAN1,
    applyAN2,
    applyAN3,
    applyAN4,
    applyANToFixedPoint,
} from "../../src/lib/grammar/an-rules.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

// Helper: build a permissive-mode engine (so we can construct
// non-Presentable states without the per-mutation AN cleaning them up
// before the test gets to run).
function makePermissiveEngine(): ArgumentEngine {
    return new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
        behavior: "permissive",
    })
}

describe("applyAN3 — collapse 0/1-child operator/formula", () => {
    it("collapses an AND operator with zero children (preserves P-3 / P-4)", () => {
        const eng = makePermissiveEngine()
        const { result: pe } = eng.createPremise()
        // Construct: AND operator at root, no children.
        pe.addExpression({
            id: "and-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        expect(pe.getExpressions()).toHaveLength(1)

        applyAN3(eng)

        // AND with 0 children disappears entirely (the premise tree
        // becomes empty).
        expect(pe.getExpressions()).toHaveLength(0)
    })

    it("collapses an unjustified formula wrapping a single NOT operator (no binary in bounded subtree)", () => {
        const eng = makePermissiveEngine()
        const { result: pe } = eng.createPremise()
        // formula wrapping a single NOT operator — NOT is unary so its
        // bounded subtree contains no binary operator, making the
        // formula unjustified.
        pe.addExpression({
            id: "formula-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "formula",
            parentId: null,
            position: 0,
        })
        pe.addExpression({
            id: "not-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "operator",
            operator: "not",
            parentId: "formula-root",
            position: 0,
        })

        applyAN3(eng)

        // The formula collapses (single child, NOT subtree has no
        // binary operator). The NOT itself then collapses because it
        // has 0 children — and the residue is an empty premise.
        expect(pe.getExpressions()).toHaveLength(0)
    })

    // D0c — sub-case-specific guards. These exercise the four native
    // collapse paths (0-child operator, 1-child non-not operator,
    // 0-child formula, 1-child formula with no bounded-subtree binary)
    // and the keep case (1-child formula whose subtree DOES contain a
    // binary operator — must NOT collapse).

    it("collapses a 1-child non-not operator by promoting its single child (D0c)", () => {
        // Build peB: AND with a single variable child. AN-3 must
        // promote the variable into AND's slot, then remove AND.
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!

        peB.addExpression({
            id: "and-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varA.id,
            parentId: "and-1",
            position: 0,
        })

        const changed = applyAN3(eng)

        expect(changed).toBe(true)
        const after = peB.getExpressions()
        expect(after).toHaveLength(1)
        expect(after[0].id).toBe("ve-x")
        expect(after[0].parentId).toBe(null)
    })

    it("does NOT collapse a 1-child not operator (NOT(x) is Presentable; D0c)", () => {
        // NOT is unary — 1-child NOT is its canonical Presentable
        // form. AN-3 must not touch it.
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!

        peB.addExpression({
            id: "not-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varA.id,
            parentId: "not-1",
            position: 0,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN3(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("preserves a 1-child formula whose bounded subtree contains a binary operator (D0c)", () => {
        // Build peB: formula → AND(a, b). The formula's bounded
        // subtree contains AND (binary), so the formula is justified
        // per P-3 and AN-3 must NOT collapse it. (a and b are two
        // variables — uses two cross-premise vars from peA and peC.)
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peC } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!
        const varC = allVars.find((v) => v.boundPremiseId === peC.getId())!

        peB.addExpression({
            id: "formula-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "formula",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "and-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: "formula-root",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varA.id,
            parentId: "and-1",
            position: 0,
        })
        peB.addExpression({
            id: "ve-c",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varC.id,
            parentId: "and-1",
            position: 1,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN3(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("issues PremiseEngine.removeExpression(_, false) calls for AN-3 collapses (native code path; D0c)", () => {
        // Spy-style guard that locks down the public-API drive. A
        // 0-child AND collapses via a single removeExpression call;
        // the same fingerprint will hold for native AN-3 going forward.
        const eng = makePermissiveEngine()
        const { result: pe } = eng.createPremise()
        pe.addExpression({
            id: "and-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })

        const removeSpy = vi.spyOn(pe, "removeExpression")

        applyAN3(eng)

        expect(removeSpy).toHaveBeenCalled()
        expect(removeSpy).toHaveBeenCalledWith("and-root", false)

        removeSpy.mockRestore()
    })
})

describe("applyAN2 — collapse double negation (D0b native)", () => {
    // Helper: build a two-premise setup where peB hosts the
    // double-negation shape and references peA's auto-created
    // premise-bound variable (avoids the circular-binding check that
    // fires when a premise references its own bound variable).
    function setupTwoPremisesWithCrossVar(): {
        eng: ArgumentEngine
        peA: ReturnType<ArgumentEngine["createPremise"]>["result"]
        peB: ReturnType<ArgumentEngine["createPremise"]>["result"]
        varAId: string
    } {
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!
        return { eng, peA, peB, varAId: varA.id }
    }

    it("collapses direct NOT(NOT(variable)) → variable", () => {
        // Build: NOT_outer → NOT_inner → variable (in peB; variable is
        // peA's bound variable so there's no self-circularity).
        // Permissive engine avoids the per-mutation AN cleaning up
        // before applyAN2 runs.
        const { eng, peB, varAId } = setupTwoPremisesWithCrossVar()
        peB.addExpression({
            id: "not-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "not-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: "not-outer",
            position: 0,
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "not-inner",
            position: 0,
        })

        const changed = applyAN2(eng)

        expect(changed).toBe(true)
        // Both NOTs removed; only the variable expression remains.
        const after = peB.getExpressions()
        expect(after).toHaveLength(1)
        expect(after[0].id).toBe("ve-x")
        expect(after[0].parentId).toBe(null)
        expect(after[0].position).toBe(0)
    })

    it("collapses buffered NOT(formula(NOT(variable))) — leaves residual formula for AN-3", () => {
        // Buffered double negation: NOT_outer → formula → NOT_inner → x.
        // Native AN-2 removes both NOTs but does NOT collapse the
        // unjustified `formula(x)` residue — AN-3 owns that cleanup.
        const { eng, peB, varAId } = setupTwoPremisesWithCrossVar()
        peB.addExpression({
            id: "not-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "formula-buf",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "formula",
            parentId: "not-outer",
            position: 0,
        })
        peB.addExpression({
            id: "not-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: "formula-buf",
            position: 0,
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "not-inner",
            position: 0,
        })

        const changed = applyAN2(eng)

        expect(changed).toBe(true)
        // After AN-2 alone: formula(x) at root. AN-3 would remove the
        // formula; AN-2's contract stops at the NOT-NOT collapse.
        const after = peB.getExpressions()
        const ids = after.map((e) => e.id).sort()
        expect(ids).toEqual(["formula-buf", "ve-x"])
        const formula = after.find((e) => e.id === "formula-buf")!
        expect(formula.parentId).toBe(null)
        const veX = after.find((e) => e.id === "ve-x")!
        expect(veX.parentId).toBe("formula-buf")
    })

    it("issues two PremiseEngine.removeExpression(_, false) calls per direct NOT-NOT collapse (native code path)", () => {
        // Spy-style guard: the D0b native implementation must drive the
        // collapse via the public `removeExpression(id, false)` API
        // (per briefing §2 / plan D0b). The legacy delegation routed
        // through `pe.normalizeExpressions()`, which would register zero
        // removeExpression calls because it uses the private
        // `promoteChild` primitive. This test fails loudly if AN-2 ever
        // regresses to delegation, and locks down the
        // `removeExpression(_, false)` semantic the plan calls out.
        const { eng, peB, varAId } = setupTwoPremisesWithCrossVar()
        peB.addExpression({
            id: "not-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "not-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: "not-outer",
            position: 0,
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "not-inner",
            position: 0,
        })

        const removeSpy = vi.spyOn(peB, "removeExpression")

        applyAN2(eng)

        // Exactly two removeExpression calls for the single
        // double-negation pattern: inner NOT first (promoting x into
        // its slot), outer NOT second (promoting x into its slot).
        // Both with deleteSubtree=false.
        expect(removeSpy).toHaveBeenCalledTimes(2)
        expect(removeSpy).toHaveBeenNthCalledWith(1, "not-inner", false)
        expect(removeSpy).toHaveBeenNthCalledWith(2, "not-outer", false)

        removeSpy.mockRestore()
    })

    it("returns false and is a no-op when no NOT-NOT pattern is present", () => {
        // Single NOT over a variable is a legitimate Presentable shape
        // (NOT(x)). AN-2 must not touch it and must report no change.
        const { eng, peB, varAId } = setupTwoPremisesWithCrossVar()
        peB.addExpression({
            id: "not-1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "not-1",
            position: 0,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN2(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("collapses a chain NOT(NOT(NOT(NOT(variable)))) to variable within a single applyAN2 call", () => {
        // Cascading NOT chains converge inside a single applyAN2 call
        // because the implementation loops on each premise until the
        // pattern is exhausted. This keeps the outer fixed-point
        // driver from re-walking the engine four times.
        const { eng, peB, varAId } = setupTwoPremisesWithCrossVar()
        // Four NOTs stacked.
        const notIds = ["not-1", "not-2", "not-3", "not-4"]
        notIds.forEach((id, idx) => {
            peB.addExpression({
                id,
                argumentId: ARG.id,
                argumentVersion: ARG.version,
                premiseId: peB.getId(),
                type: "operator",
                operator: "not",
                parentId: idx === 0 ? null : notIds[idx - 1],
                position: 0,
            })
        })
        peB.addExpression({
            id: "ve-x",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "not-4",
            position: 0,
        })

        const changed = applyAN2(eng)

        expect(changed).toBe(true)
        const after = peB.getExpressions()
        expect(after).toHaveLength(1)
        expect(after[0].id).toBe("ve-x")
        expect(after[0].parentId).toBe(null)
    })
})

describe("applyAN4 — absorb same-operator adjacency through a formula", () => {
    // Contract / regression-guard tests for AN-4 (P-5).
    //
    // **Implementation state (D0e — native).** `applyAN4` is a
    // native single-rule pass: it walks each premise's tree looking
    // for `OUTER_OP → formula → INNER_OP (same operator) → [c1,…,cN]`
    // and, for each match, uses `pe.reparentExpression(c_i, outerId,
    // position_i)` to move every inner child into the outer at
    // legacy-spacing positions, then removes the empty inner OP and
    // formula wrapper via `pe.removeExpression`. The legacy
    // delegation through `pe.normalizeExpressions()` is gone (see
    // `src/lib/grammar/an-rules.ts` for the implementation + the
    // ported position-spacing + redistribution-fallback from
    // `ExpressionManager.absorbSameOperator`). These tests are the
    // contract regression guards — any future refactor of AN-4 must
    // keep them green.
    //
    // The shape AN-4 acts on: outer-OP → (..., ) formula → inner-OP
    // (with the same operator type as outer) → [child1, child2, ...]
    // becomes outer-OP → (..., child1, child2, ..., ). Implies/iff
    // are root-only (S-5) and never absorb — only and/or pairs.
    //
    // **Per-rule isolation caveat (historical, now resolved at the
    // AN-4 level).** Pre-D0e `applyAN4` delegated to the legacy full
    // sweep, so a fixture with a 1-child outer-OR would also trigger
    // AN-3 in the same call and confuse "no-firing" assertions. The
    // multi-child outer operators (≥2 children) below were chosen to
    // avoid that confusion under the delegated path. Native AN-4
    // fires only on its specific pattern, so the same fixtures now
    // assert genuinely per-rule behavior.

    // Helper: build a four-premise setup so peB hosts the absorption
    // shape using peA, peC, and peD's auto-created premise-bound
    // variables. (peB's own bound variable cannot appear in peB's tree
    // because that would be a circular binding — we need three
    // *distinct* non-peB bound vars for the three-leaf absorption
    // tests.)
    function setupFourPremisesWithCrossVars(): {
        eng: ArgumentEngine
        peB: ReturnType<ArgumentEngine["createPremise"]>["result"]
        varAId: string
        varCId: string
        varDId: string
    } {
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peC } = eng.createPremise()
        const { result: peD } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!
        const varC = allVars.find((v) => v.boundPremiseId === peC.getId())!
        const varD = allVars.find((v) => v.boundPremiseId === peD.getId())!
        return {
            eng,
            peB,
            varAId: varA.id,
            varCId: varC.id,
            varDId: varD.id,
        }
    }

    it("absorbs OR(a, formula(OR(c, d))) into OR(a, c, d) and removes the formula+inner-OR", () => {
        // Multi-child outer-OR avoids the AN-3 single-child collapse
        // path that would otherwise also fire under the delegated
        // legacy sweep.
        const { eng, peB, varAId, varCId, varDId } =
            setupFourPremisesWithCrossVars()
        peB.addExpression({
            id: "or-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-outer",
            position: 0,
        })
        peB.addExpression({
            id: "formula-buf",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "formula",
            parentId: "or-outer",
            position: 1,
        })
        peB.addExpression({
            id: "or-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "formula-buf",
            position: 0,
        })
        peB.addExpression({
            id: "ve-c",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varCId,
            parentId: "or-inner",
            position: 0,
        })
        peB.addExpression({
            id: "ve-d",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varDId,
            parentId: "or-inner",
            position: 1,
        })

        const changed = applyAN4(eng)

        expect(changed).toBe(true)
        const after = peB.getExpressions()
        const ids = after.map((e) => e.id).sort()
        // formula-buf and or-inner are gone; or-outer absorbed
        // ve-c + ve-d next to ve-a.
        expect(ids).toEqual(["or-outer", "ve-a", "ve-c", "ve-d"])
        // Identity preservation: each variable expression keeps its
        // id through absorption (the legacy path uses the
        // expression-manager's private `reparent`, so IDs survive).
        // The eventual native rewrite via the D0e reparent primitive
        // must keep this invariant.
        const veA = after.find((e) => e.id === "ve-a")!
        const veC = after.find((e) => e.id === "ve-c")!
        const veD = after.find((e) => e.id === "ve-d")!
        expect(veA.parentId).toBe("or-outer")
        expect(veC.parentId).toBe("or-outer")
        expect(veD.parentId).toBe("or-outer")
        // Order preserved: a (was outer-position 0) < c (first inner
        // child) < d (second inner child). The legacy path slots
        // absorbed children between the formula's left and right
        // neighbors.
        expect(veA.position).toBeLessThan(veC.position)
        expect(veC.position).toBeLessThan(veD.position)
    })

    it("absorbs AND(a, formula(AND(c, d))) into AND(a, c, d) (same pattern, AND operator)", () => {
        const { eng, peB, varAId, varCId, varDId } =
            setupFourPremisesWithCrossVars()
        peB.addExpression({
            id: "and-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "and-outer",
            position: 0,
        })
        peB.addExpression({
            id: "formula-buf",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "formula",
            parentId: "and-outer",
            position: 1,
        })
        peB.addExpression({
            id: "and-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: "formula-buf",
            position: 0,
        })
        peB.addExpression({
            id: "ve-c",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varCId,
            parentId: "and-inner",
            position: 0,
        })
        peB.addExpression({
            id: "ve-d",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varDId,
            parentId: "and-inner",
            position: 1,
        })

        const changed = applyAN4(eng)

        expect(changed).toBe(true)
        const after = peB.getExpressions()
        const ids = after.map((e) => e.id).sort()
        expect(ids).toEqual(["and-outer", "ve-a", "ve-c", "ve-d"])
        // Inner children promoted to direct children of and-outer.
        const veC = after.find((e) => e.id === "ve-c")!
        const veD = after.find((e) => e.id === "ve-d")!
        expect(veC.parentId).toBe("and-outer")
        expect(veD.parentId).toBe("and-outer")
    })

    it("does NOT absorb when outer and inner operators differ (OR-outer with AND-inner)", () => {
        // Mixed-operator shape: OR(a, formula(AND(c, d))). Not an
        // AN-4 firing condition. The formula is justified per P-3
        // (bounded subtree contains AND), AN-3 leaves it. The outer
        // OR has 2 children, AN-3 leaves it. Whole tree stays
        // stable — change-detection in `runLegacyNormalizeAndReportChange`
        // returns false because no ids appear/disappear.
        const { eng, peB, varAId, varCId, varDId } =
            setupFourPremisesWithCrossVars()
        peB.addExpression({
            id: "or-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-outer",
            position: 0,
        })
        peB.addExpression({
            id: "formula-buf",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "formula",
            parentId: "or-outer",
            position: 1,
        })
        peB.addExpression({
            id: "and-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: "formula-buf",
            position: 0,
        })
        peB.addExpression({
            id: "ve-c",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varCId,
            parentId: "and-inner",
            position: 0,
        })
        peB.addExpression({
            id: "ve-d",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varDId,
            parentId: "and-inner",
            position: 1,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN4(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("is a no-op when there is no intervening formula (native AN-4 fires only on the OP → formula → same-OP shape)", () => {
        // Native AN-4 matches only when the inner operator's parent
        // is a formula. Without the intervening formula, the shape
        // `OUTER_OP → INNER_OP` is a P-1 violation (handled by AN-1,
        // not AN-4) — so AN-4 alone is a no-op here. The fixture
        // builds the unbuffered shape, then asserts `applyAN4`
        // returns false and the tree is unchanged.
        const { eng, peB, varAId, varCId, varDId } =
            setupFourPremisesWithCrossVars()
        peB.addExpression({
            id: "or-outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-outer",
            position: 0,
        })
        peB.addExpression({
            id: "or-inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "or-outer",
            position: 1,
        })
        peB.addExpression({
            id: "ve-c",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varCId,
            parentId: "or-inner",
            position: 0,
        })
        peB.addExpression({
            id: "ve-d",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varDId,
            parentId: "or-inner",
            position: 1,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN4(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })
})

describe("applyAN1 — insert formula buffer between operators (D0e native)", () => {
    // Contract / regression-guard tests for AN-1 (P-1).
    //
    // **Implementation state (D0e — native).** `applyAN1` walks each
    // premise's expression tree looking for non-`not` operators whose
    // parent is also an operator (the P-1 violation shape) and calls
    // `pe.wrapInFormula(childOpId, formulaId)` to insert a freshly-
    // minted formula between parent and child. The formula takes the
    // child's original slot; the child becomes the formula's sole
    // child at position 0.
    //
    // Mirrors the structure of AN-2/AN-3 tests: cross-premise variables
    // are used to avoid the self-circular-binding check, and the engine
    // is permissive so the per-mutation AN post-hook doesn't fire
    // between setup `addExpression` calls.

    function setupTwoPremisesWithCrossVars(): {
        eng: ArgumentEngine
        peB: ReturnType<ArgumentEngine["createPremise"]>["result"]
        varAId: string
        varBId: string
    } {
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peC } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!
        const varB = allVars.find((v) => v.boundPremiseId === peC.getId())!
        return { eng, peB, varAId: varA.id, varBId: varB.id }
    }

    it("inserts a formula buffer when an OR is a direct child of an AND", () => {
        // Build: AND(OR(a, b), b). Native AN-1 wraps the OR in a
        // formula so the tree becomes AND(formula(OR(a, b)), b).
        const { eng, peB, varAId, varBId } = setupTwoPremisesWithCrossVars()
        peB.addExpression({
            id: "and-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "or-child",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "and-root",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-child",
            position: 0,
        })
        peB.addExpression({
            id: "ve-b1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "or-child",
            position: 1,
        })
        peB.addExpression({
            id: "ve-b2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "and-root",
            position: 1,
        })

        const changed = applyAN1(eng)

        expect(changed).toBe(true)
        // Tree should be AND → [formula → OR → [a, b1], b2]. The OR's
        // id and the variable expression ids are preserved.
        const orChild = peB.getExpression("or-child")!
        expect(orChild.parentId).not.toBe("and-root")
        const formulaParent = peB.getExpression(orChild.parentId!)!
        expect(formulaParent.type).toBe("formula")
        expect(formulaParent.parentId).toBe("and-root")
        expect(orChild.position).toBe(0)
        // Variable expressions under the OR survive the wrap.
        const veA = peB.getExpression("ve-a")!
        const veB1 = peB.getExpression("ve-b1")!
        expect(veA.parentId).toBe("or-child")
        expect(veB1.parentId).toBe("or-child")
    })

    it("inserts a formula buffer when an OR is a direct child of NOT (single-child-parent case)", () => {
        // Build: NOT(OR(a, b)). Native AN-1 wraps the OR in a formula
        // so the tree becomes NOT(formula(OR(a, b))). The NOT parent
        // has assertChildLimit=1, so this case exercises the
        // `pe.wrapInFormula` primitive's child-limit sidestep.
        const { eng, peB, varAId, varBId } = setupTwoPremisesWithCrossVars()
        peB.addExpression({
            id: "not-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "or-child",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "not-root",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-child",
            position: 0,
        })
        peB.addExpression({
            id: "ve-b",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "or-child",
            position: 1,
        })

        const changed = applyAN1(eng)

        expect(changed).toBe(true)
        const orChild = peB.getExpression("or-child")!
        const formulaParent = peB.getExpression(orChild.parentId!)!
        expect(formulaParent.type).toBe("formula")
        expect(formulaParent.parentId).toBe("not-root")
    })

    it("inserts a formula buffer when an OR is a direct child of IMPLIES (binary-parent case)", () => {
        // Build: IMPLIES(OR(a, b), b). assertChildLimit("implies")=2,
        // so wrapping OR in a formula transiently would violate the
        // limit if expressed as `addExpression(formula) + reparent`.
        // `wrapInFormula` handles it atomically.
        const { eng, peB, varAId, varBId } = setupTwoPremisesWithCrossVars()
        peB.addExpression({
            id: "implies-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "implies",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "or-antecedent",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "implies-root",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-antecedent",
            position: 0,
        })
        peB.addExpression({
            id: "ve-b1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "or-antecedent",
            position: 1,
        })
        peB.addExpression({
            id: "ve-b2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "implies-root",
            position: 1,
        })

        const changed = applyAN1(eng)

        expect(changed).toBe(true)
        // IMPLIES should still have exactly 2 children (formula at
        // antecedent slot, ve-b2 at consequent slot).
        const impliesChildren = peB.getChildExpressions("implies-root")
        expect(impliesChildren).toHaveLength(2)
        const antecedent = impliesChildren.find(
            (c) => c.position === impliesChildren[0].position
        )!
        expect(antecedent.type).toBe("formula")
        // The OR's id is preserved through the wrap.
        const orChild = peB.getExpression("or-antecedent")!
        expect(orChild.parentId).toBe(antecedent.id)
    })

    it("is a no-op when there is no operator-under-operator violation (Presentable shape)", () => {
        // Build: AND(formula(OR(a, b)), b). Already Presentable per
        // P-1 — formula already buffers the OR under AND. AN-1 must
        // not fire.
        const { eng, peB, varAId, varBId } = setupTwoPremisesWithCrossVars()
        peB.addExpression({
            id: "and-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "f-buf",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "formula",
            parentId: "and-root",
            position: 0,
        })
        peB.addExpression({
            id: "or-child",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "f-buf",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-child",
            position: 0,
        })
        peB.addExpression({
            id: "ve-b1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "or-child",
            position: 1,
        })
        peB.addExpression({
            id: "ve-b2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "and-root",
            position: 1,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN1(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("does NOT fire when child is `not` (P-1's exception — NOT can be a direct operator child)", () => {
        // Build: AND(NOT(a), b). The NOT child does NOT require a
        // formula buffer per P-1; AN-1 must skip it.
        const { eng, peB, varAId, varBId } = setupTwoPremisesWithCrossVars()
        peB.addExpression({
            id: "and-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "not-child",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "not",
            parentId: "and-root",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "not-child",
            position: 0,
        })
        peB.addExpression({
            id: "ve-b",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "and-root",
            position: 1,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        const changed = applyAN1(eng)

        expect(changed).toBe(false)
        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("uses pe.wrapInFormula (not addExpression+reparent) on the native code path", () => {
        // Spy on `pe.wrapInFormula` to confirm AN-1 issues the
        // wrap-primitive call directly. Locks in the native code path
        // — a future regression that goes back through
        // `pe.normalizeExpressions()` or composes the operation from
        // simpler primitives would fail this assertion.
        const { eng, peB, varAId, varBId } = setupTwoPremisesWithCrossVars()
        peB.addExpression({
            id: "and-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        peB.addExpression({
            id: "or-child",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "operator",
            operator: "or",
            parentId: "and-root",
            position: 0,
        })
        peB.addExpression({
            id: "ve-a",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varAId,
            parentId: "or-child",
            position: 0,
        })
        peB.addExpression({
            id: "ve-b1",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "or-child",
            position: 1,
        })
        peB.addExpression({
            id: "ve-b2",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varBId,
            parentId: "and-root",
            position: 1,
        })

        const wrapSpy = vi.spyOn(peB, "wrapInFormula")

        applyAN1(eng)

        expect(wrapSpy).toHaveBeenCalledTimes(1)
        // First arg is the child operator id; second is a fresh
        // formula id minted by engine.idGenerator (verified by
        // shape — it's a string).
        const [childIdArg, formulaIdArg] = wrapSpy.mock.calls[0]
        expect(childIdArg).toBe("or-child")
        expect(typeof formulaIdArg).toBe("string")

        wrapSpy.mockRestore()
    })
})

describe("applyANToFixedPoint — drives all four rules to convergence", () => {
    it("is a no-op on a Presentable-clean tree", () => {
        // Two-premise setup: peA's auto-created premise-bound variable
        // is used as a non-circular variable expression in peB. peB's
        // tree is then a single variable expression at root — a
        // canonical Presentable form. AN should be a no-op.
        const eng = makePermissiveEngine()
        const { result: peA } = eng.createPremise()
        const { result: peB } = eng.createPremise()
        // getVariables() returns all variables in the engine's variable
        // manager (not just peB's). Filter for the one bound to peA so
        // peB's expression references peA's variable, not its own.
        const allVars = peB.getVariables() as {
            id: string
            boundPremiseId?: string
        }[]
        const varA = allVars.find((v) => v.boundPremiseId === peA.getId())!
        peB.addExpression({
            id: "v-root",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: peB.getId(),
            type: "variable",
            variableId: varA.id,
            parentId: null,
            position: 0,
        })

        const beforeIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()

        applyANToFixedPoint(eng)

        const afterIds = peB
            .getExpressions()
            .map((e) => e.id)
            .sort()
        expect(afterIds).toEqual(beforeIds)
    })

    it("converges within the MAX_AN_ITERATIONS safety cap on realistic input", () => {
        // The cap is 10; convergence on well-formed input should be
        // ≤ 3 iterations (spec §5.1). This test exercises a tree with
        // multiple AN-3 firings (nested empty operators) to make sure
        // the fixed-point loop terminates without hitting the cap.
        const eng = makePermissiveEngine()
        const { result: pe } = eng.createPremise()
        // Two stacked empty operators: AND wrapping OR with no children.
        pe.addExpression({
            id: "outer",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "operator",
            operator: "and",
            parentId: null,
            position: 0,
        })
        pe.addExpression({
            id: "inner",
            argumentId: ARG.id,
            argumentVersion: ARG.version,
            premiseId: pe.getId(),
            type: "operator",
            operator: "or",
            parentId: "outer",
            position: 0,
        })

        // Should not throw the convergence-cap error.
        expect(() => applyANToFixedPoint(eng)).not.toThrow()

        // The whole tree collapses (both operators have 0 effective
        // children after AN-3 fires bottom-up).
        expect(pe.getExpressions()).toHaveLength(0)
    })
})

// D0a smoke test — exported names are callable and return booleans.
describe("an-rules module surface (D0a)", () => {
    it("exports applyAN1 / applyAN2 / applyAN3 / applyAN4 / applyANToFixedPoint", () => {
        const eng = makePermissiveEngine()
        // Empty-engine smoke check: every rule returns `false` (no
        // change) on an engine with no premises.
        expect(applyAN1(eng)).toBe(false)
        expect(applyAN2(eng)).toBe(false)
        expect(applyAN3(eng)).toBe(false)
        expect(applyAN4(eng)).toBe(false)
        expect(() => applyANToFixedPoint(eng)).not.toThrow()
    })
})
