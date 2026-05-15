import { describe, it, expect } from "vitest"
import { validate } from "../../src/lib/grammar/validate.js"
import type { TValidatorContext } from "../../src/lib/grammar/validators/context.js"
import {
    buildContext,
    makeFreeformPremise,
    makeDerivationPremise,
    makeVariableExpression,
    makeOperatorExpression,
    makeClaimBoundVariable,
    makeNormalClaim,
    makeCitationClaim,
} from "./fixtures.js"

/**
 * Build a TValidatorContext that contains exactly one violation per
 * tier:
 *
 * - Structural: S-1 — expression with a dangling parentId.
 * - Evaluable: E-7 — argument has a premise but no conclusion designated.
 *   (S-1 doesn't bleed into the rest of the context because the dangling
 *   parent is the only Structural breakage.)
 * - Derivable: D-3 — derivation premise antecedent mixes axiomatic and
 *   citation grounding. Built carefully so it doesn't also trigger D-1
 *   (canonical-shape) — we use a populated form whose antecedent is the
 *   mixed OR.
 * - Presentable: P-1 — non-`not` operator as a direct child of another
 *   operator (no formula buffer).
 *
 * Each tier's violation is independent so the dispatcher's union output
 * has predictable size.
 */
function oneViolationPerTier(): TValidatorContext {
    return buildContext({
        premises: [
            // E-7 trigger: this premise has no designated conclusion in roleState.
            makeFreeformPremise({ id: "p-free" }),
            // Derivation premise that triggers D-3 (mixed grounding) but
            // satisfies D-1's populated-form skeleton.
            makeDerivationPremise({
                id: "p-d",
                derivedClaimId: "claim-q",
            }),
        ],
        expressions: [
            // S-1 trigger: free-floating expression with dangling parentId.
            makeVariableExpression({
                id: "e-dangling",
                premiseId: "p-free",
                parentId: "missing-parent",
                variableId: "v-arbitrary",
            }),

            // Populated form for p-d (claim-q): IMPLIES(OR(axiom, citation), Q).
            // The mixed OR antecedent triggers D-3; structure otherwise matches
            // D-1's populated form so D-1 doesn't fire.
            makeOperatorExpression("implies", {
                id: "e-impl",
                premiseId: "p-d",
                parentId: null,
            }),
            makeOperatorExpression("or", {
                id: "e-or",
                premiseId: "p-d",
                parentId: "e-impl",
                position: 0,
            }),
            makeVariableExpression({
                id: "e-ax",
                premiseId: "p-d",
                parentId: "e-or",
                position: 0,
                variableId: "v-ax",
            }),
            makeVariableExpression({
                id: "e-cit",
                premiseId: "p-d",
                parentId: "e-or",
                position: 1,
                variableId: "v-cit",
            }),
            makeVariableExpression({
                id: "e-q",
                premiseId: "p-d",
                parentId: "e-impl",
                position: 1,
                variableId: "v-q",
            }),

            // P-1 trigger: standalone AND(OR(...)) tree with no formula buffer.
            // Lives in p-free but at a separate root (parentId=null) so it
            // doesn't interact with the dangling-parentId expression above.
            makeOperatorExpression("and", {
                id: "e-and",
                premiseId: "p-free",
                parentId: null,
                position: 100,
            }),
            makeOperatorExpression("or", {
                id: "e-or-p1",
                premiseId: "p-free",
                parentId: "e-and",
                position: 0,
            }),
            makeVariableExpression({
                id: "e-p1-a",
                premiseId: "p-free",
                parentId: "e-or-p1",
                position: 0,
                variableId: "v-p1-a",
            }),
            makeVariableExpression({
                id: "e-p1-b",
                premiseId: "p-free",
                parentId: "e-or-p1",
                position: 1,
                variableId: "v-p1-b",
            }),
            makeVariableExpression({
                id: "e-p1-c",
                premiseId: "p-free",
                parentId: "e-and",
                position: 1,
                variableId: "v-p1-c",
            }),
        ],
        variables: [
            makeClaimBoundVariable({
                id: "v-arbitrary",
                claimId: "claim-arbitrary",
                symbol: "X",
            }),
            makeClaimBoundVariable({
                id: "v-ax",
                claimId: "claim-ax",
                symbol: "A",
            }),
            makeClaimBoundVariable({
                id: "v-cit",
                claimId: "claim-cit",
                symbol: "C",
            }),
            makeClaimBoundVariable({
                id: "v-q",
                claimId: "claim-q",
                symbol: "Q",
            }),
            makeClaimBoundVariable({
                id: "v-p1-a",
                claimId: "claim-p1-a",
                symbol: "P1A",
            }),
            makeClaimBoundVariable({
                id: "v-p1-b",
                claimId: "claim-p1-b",
                symbol: "P1B",
            }),
            makeClaimBoundVariable({
                id: "v-p1-c",
                claimId: "claim-p1-c",
                symbol: "P1C",
            }),
        ],
        claims: [
            makeNormalClaim({ id: "claim-arbitrary" }),
            makeNormalClaim({ id: "claim-q" }),
            makeCitationClaim({ id: "claim-cit" }),
            // Note: claim-ax is axiomatic. We import that helper but to keep
            // this file's imports minimal, we inline it here.
            {
                id: "claim-ax",
                version: 0,
                frozen: false,
                checksum: "c-checksum",
                type: "axiomatic",
            },
            makeNormalClaim({ id: "claim-p1-a" }),
            makeNormalClaim({ id: "claim-p1-b" }),
            makeNormalClaim({ id: "claim-p1-c" }),
        ],
        // roleState left empty → E-7 fires.
    })
}

describe("grammar/validate dispatcher (spec §7.1)", () => {
    it("validate('structural') returns Structural violations only", () => {
        const ctx = oneViolationPerTier()
        const tiers = validate("structural", ctx).map((v) => v.tier)
        expect(tiers.length).toBeGreaterThan(0)
        expect(tiers.every((t) => t === "structural")).toBe(true)
    })

    it("validate('evaluable') returns Structural + Evaluable violations in that order", () => {
        const ctx = oneViolationPerTier()
        const violations = validate("evaluable", ctx)
        const tiers = violations.map((v) => v.tier)
        // Every Structural violation precedes every Evaluable violation.
        const lastStructural = tiers.lastIndexOf("structural")
        const firstEvaluable = tiers.indexOf("evaluable")
        expect(firstEvaluable).toBeGreaterThan(-1)
        expect(firstEvaluable).toBeGreaterThan(lastStructural)
        // No higher-tier violations leak in.
        expect(
            tiers.every((t) => t === "structural" || t === "evaluable")
        ).toBe(true)
    })

    it("validate('derivable') returns Structural + Evaluable + Derivable in that order", () => {
        const ctx = oneViolationPerTier()
        const violations = validate("derivable", ctx)
        const tiers = violations.map((v) => v.tier)
        const codes = violations.map((v) => v.code)
        const lastStructural = tiers.lastIndexOf("structural")
        const firstEvaluable = tiers.indexOf("evaluable")
        const lastEvaluable = tiers.lastIndexOf("evaluable")
        const firstDerivable = tiers.indexOf("derivable")
        expect(firstEvaluable).toBeGreaterThan(lastStructural)
        expect(firstDerivable).toBeGreaterThan(lastEvaluable)
        expect(
            tiers.every(
                (t) =>
                    t === "structural" || t === "evaluable" || t === "derivable"
            )
        ).toBe(true)
        // The `oneViolationPerTier()` fixture is built carefully so that
        // its OR(axiom, citation) antecedent triggers D-3 (mixed grounding)
        // without also firing D-1 (antecedentMatchesPopulatedForm passes
        // because the antecedent IS an OR of ≥ 2 claim-bound variables —
        // homogeneity is D-3's concern, not D-1's). Assert that
        // structural guarantee inline rather than relying on the fixture
        // comment.
        expect(codes.filter((c) => c === "D-1")).toHaveLength(0)
    })

    it("validate('presentable') returns Structural + Evaluable + Derivable + Presentable in that order", () => {
        const ctx = oneViolationPerTier()
        const violations = validate("presentable", ctx)
        const tiers = violations.map((v) => v.tier)
        const lastStructural = tiers.lastIndexOf("structural")
        const firstEvaluable = tiers.indexOf("evaluable")
        const lastEvaluable = tiers.lastIndexOf("evaluable")
        const firstDerivable = tiers.indexOf("derivable")
        const lastDerivable = tiers.lastIndexOf("derivable")
        const firstPresentable = tiers.indexOf("presentable")
        expect(firstEvaluable).toBeGreaterThan(lastStructural)
        expect(firstDerivable).toBeGreaterThan(lastEvaluable)
        expect(firstPresentable).toBeGreaterThan(lastDerivable)
        // The union covers all four tiers — at least one of each.
        expect(tiers).toContain("structural")
        expect(tiers).toContain("evaluable")
        expect(tiers).toContain("derivable")
        expect(tiers).toContain("presentable")
    })

    it("returns an empty array when the context is at the requested tier or stricter", () => {
        // A trivially well-formed Presentable argument: one freeform premise
        // with a single root variable expression, designated as conclusion.
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [
                makeVariableExpression({
                    id: "e-1",
                    premiseId: "p-1",
                    parentId: null,
                    variableId: "v-1",
                }),
            ],
            variables: [
                makeClaimBoundVariable({ id: "v-1", claimId: "claim-1" }),
            ],
            claims: [makeNormalClaim({ id: "claim-1" })],
            roleState: { conclusionPremiseId: "p-1" },
        })
        expect(validate("presentable", ctx)).toEqual([])
        expect(validate("derivable", ctx)).toEqual([])
        expect(validate("evaluable", ctx)).toEqual([])
        expect(validate("structural", ctx)).toEqual([])
    })

    it("never throws on grammar issues — handles a deliberately broken context", () => {
        // S-2 trigger: expression with an unknown type. The dispatcher must
        // surface the violation, not crash.
        const broken: TCorePropExpr = {
            id: "e-junk",
            argumentId: "arg-1",
            argumentVersion: 1,
            premiseId: "p-1",
            parentId: null,
            position: 0,
            type: "junk" as unknown as "variable",
            variableId: "v-1",
            checksum: "x",
            descendantChecksum: null,
            combinedChecksum: "x",
        } as unknown as TCorePropExpr
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [broken],
            variables: [makeClaimBoundVariable({ id: "v-1" })],
            claims: [makeNormalClaim({ id: "claim-1" })],
            roleState: { conclusionPremiseId: "p-1" },
        })
        expect(() => validate("presentable", ctx)).not.toThrow()
        const violations = validate("presentable", ctx)
        expect(violations.some((v) => v.code === "S-2")).toBe(true)
    })
})

// Local alias to keep the broken-shape test concise.
type TCorePropExpr =
    import("../../src/lib/schemata/index.js").TCorePropositionalExpression
