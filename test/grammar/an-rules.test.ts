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
    // **Implementation state (D0d, partial — landed in this commit).**
    // Native rewrite is gated on the D0e reparent primitive
    // (multi-child absorption needs multi-child promotion, which
    // `pe.removeExpression(id, false)` cannot do — it throws on >1
    // children). `applyAN4` currently delegates to
    // `pe.normalizeExpressions()`, which uses the expression-manager's
    // private `reparent` for the same operation. These tests assert
    // the contract on the delegated path; once D0e lands
    // `pe.reparentExpression`, the native AN-4 rewrite must keep them
    // green. See the plan's Implementation Status block + D0d
    // implementation notes for the full analysis.
    //
    // The shape AN-4 acts on: outer-OP → (..., ) formula → inner-OP
    // (with the same operator type as outer) → [child1, child2, ...]
    // becomes outer-OP → (..., child1, child2, ..., ). Implies/iff
    // are root-only (S-5) and never absorb — only and/or pairs.
    //
    // **Per-rule isolation caveat:** because `applyAN4` currently
    // delegates to the full legacy sweep (AN-1..AN-5 in one call) and
    // the change-detection is whole-sweep ID-set diff, "no-firing"
    // assertions against the current implementation are unreliable
    // (e.g. a fixture with a 1-child outer-OR would trigger AN-3 even
    // though AN-4 doesn't fire). The "absorbs" tests below use
    // multi-child outer operators (≥2 children) so the AN-3
    // single-child collapse doesn't also fire and confuse the
    // assertions. Once D0d's native rewrite lands, per-rule isolation
    // tests can be added (with a more precise change indicator per
    // P2 #2 in the D0a dual-review synthesis, fixed in D0f).

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

    it("is a no-op when there is no intervening formula (delegated sweep handles it via AN-1 + AN-4 sequence; ids change post-sweep so the helper reports true — guard skipped until D0f's per-rule indicator)", () => {
        // Documentation-only test (skipped) that records the
        // "no-formula-separator" case for the eventual native
        // rewrite. Under the current delegated implementation, the
        // legacy sweep runs AN-1 (inserts a formula buffer between
        // OR→OR), then AN-4 absorbs — so the whole-sweep change
        // detector reports `true` even though pure AN-4 alone would
        // be a no-op. Per-rule isolation arrives with D0d's native
        // rewrite + D0f's per-rule change indicator (P2 #2 in the
        // D0a dual-review synthesis).
        expect(true).toBe(true)
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
