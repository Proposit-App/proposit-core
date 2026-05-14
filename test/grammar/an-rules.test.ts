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

import { describe, it, expect } from "vitest"
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
