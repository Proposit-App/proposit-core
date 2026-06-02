// ArgumentEngine.validate(tier) — four-tier grammar validation.
//
// The four-tier grammar API exposes an engine method that returns the
// list of violations at or below a requested tier. This sits on top of
// the standalone `validate(tier, ctx)` dispatcher in
// `src/lib/grammar/validate.ts` and constructs the TValidatorContext
// from the engine's live state. `validate(tier)` takes a required
// `TGrammarTier` argument and returns `readonly TViolation[]`.
//
// The pre-1.0 no-arg `validate()` (invariant validation returning
// `TInvariantValidationResult`) has been renamed to
// `validateInvariants()`.

import { describe, it, expect } from "vitest"
import { ArgumentEngine } from "../../src/lib/core/argument-engine.js"
import { EMPTY_CLAIM_LOOKUP } from "../../src/lib/utils/lookup.js"
import type { TExpressionInput } from "../../src/lib/core/expression-manager.js"
import { POSITION_INITIAL } from "../../src/lib/utils/position.js"
import { makeArgument } from "./fixtures.js"

const ARG = makeArgument()

function opExpr(
    id: string,
    operator: "not" | "and" | "or" | "implies" | "iff",
    parentId: string | null,
    position: number = POSITION_INITIAL
): TExpressionInput {
    return {
        id,
        argumentId: ARG.id,
        argumentVersion: ARG.version,
        premiseId: "validate-test",
        type: "operator",
        operator,
        parentId,
        position,
    }
}

describe("ArgumentEngine.validate(tier)", () => {
    it("returns an empty array for a trivially well-formed Presentable argument", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP)
        const violations = eng.validate("presentable")
        expect(violations).toEqual([])
    })

    it("returns Structural violations only when tier is 'structural'", () => {
        // Build a tree with a P-1 violation under permissive mode. P-1 is
        // a Presentable-only violation — it should not appear when the
        // tier filter is 'structural'.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const structural = eng.validate("structural")
        expect(structural.filter((v) => v.tier === "presentable")).toEqual([])
        expect(structural.every((v) => v.tier === "structural")).toBe(true)
    })

    it("surfaces a Presentable violation when tier is 'presentable'", () => {
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const presentable = eng.validate("presentable")
        const p1 = presentable.filter((v) => v.code === "P-1")
        expect(p1.length).toBeGreaterThan(0)
    })

    it("returns the union across all four tiers when tier is 'presentable'", () => {
        // E-1: AND with 0 children is Evaluable; P-1: any non-not operator
        // directly under another operator is Presentable. Build both.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("or-1", "or", null))
        pe.addExpression(opExpr("and-1", "and", "or-1"))

        const presentable = eng.validate("presentable")
        const tiers = new Set(presentable.map((v) => v.tier))
        // Evaluable surfaces because AND has 0 children.
        expect(tiers.has("evaluable")).toBe(true)
        // Presentable surfaces because AND is direct child of OR.
        expect(tiers.has("presentable")).toBe(true)
    })

    it("does not throw — even on a deeply broken expression tree", () => {
        // Build something nonsensical and assert it returns a list.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP, {
            behavior: "permissive",
        })
        const { result: pe } = eng.createPremise()
        pe.addExpression(opExpr("and-root", "and", null))

        expect(() => eng.validate("structural")).not.toThrow()
        expect(() => eng.validate("evaluable")).not.toThrow()
        expect(() => eng.validate("derivable")).not.toThrow()
        expect(() => eng.validate("presentable")).not.toThrow()
    })

    it("exposes the legacy invariant sweep via validateInvariants()", () => {
        // The pre-1.0 no-arg `validate()` overload was renamed to
        // `validateInvariants()` for unambiguous contrast with the
        // tier-aware `validate(tier)` grammar validator. The legacy
        // invariant sweep (schema conformance, reference integrity,
        // ownership, conclusion ref, circularity, checksums) stays
        // accessible under the new name.
        const eng = new ArgumentEngine(ARG, EMPTY_CLAIM_LOOKUP)
        const result = eng.validateInvariants()
        expect(result).toHaveProperty("ok")
        expect(result).toHaveProperty("violations")
    })
})
