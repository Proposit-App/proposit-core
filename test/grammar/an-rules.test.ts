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
