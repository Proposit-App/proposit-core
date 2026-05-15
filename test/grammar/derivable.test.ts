import { describe, it, expect } from "vitest"
import {
    validateD1,
    validateD2,
    validateD3,
    validateD4,
    validateD5,
    validateD6,
    validateDerivable,
} from "../../src/lib/grammar/validators/derivable.js"
import {
    buildContext,
    makeFreeformPremise,
    makeDerivationPremise,
    makeVariableExpression,
    makeOperatorExpression,
    makeFormulaExpression,
    makeClaimBoundVariable,
    makeNormalClaim,
    makeCitationClaim,
    makeAxiomaticClaim,
} from "./fixtures.js"

// Convenience: a populated-form derivation premise for claim Q with the
// given antecedent layout. The `antecedent` parameter is an array of
// expressions whose root has parentId=null (which the helper then wires
// under the IMPLIES at position 0).
//
// Test fixtures inline the full expression tree for clarity.

describe("grammar/derivable", () => {
    describe("D-1 derivation premise canonical shape", () => {
        it("accepts naked-Q form (single variable at root bound to derivedClaimId)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: null,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [makeNormalClaim({ id: "claim-q" })],
            })
            expect(validateD1(ctx)).toEqual([])
        })

        it("accepts populated form IMPLIES(citation-var, Q) (single citation)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-cit",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-cit",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
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
                ],
                claims: [
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD1(ctx)).toEqual([])
        })

        it("accepts populated form IMPLIES(OR(c1, c2), Q) (multi-citation, no buffer)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
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
                        id: "e-c1",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 0,
                        variableId: "v-c1",
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 1,
                        variableId: "v-c2",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-c1",
                        claimId: "claim-c1",
                        symbol: "C1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-c2",
                        claimId: "claim-c2",
                        symbol: "C2",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-c1" }),
                    makeCitationClaim({ id: "claim-c2" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD1(ctx)).toEqual([])
        })

        it("accepts populated form with intervening formula buffer IMPLIES(formula(OR(c1, c2)), Q)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeFormulaExpression({
                        id: "e-formula",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                    }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        premiseId: "p-d",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c1",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 0,
                        variableId: "v-c1",
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 1,
                        variableId: "v-c2",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-c1",
                        claimId: "claim-c1",
                        symbol: "C1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-c2",
                        claimId: "claim-c2",
                        symbol: "C2",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-c1" }),
                    makeCitationClaim({ id: "claim-c2" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD1(ctx)).toEqual([])
        })

        it("rejects populated form with IFF at root", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("iff", {
                        id: "e-iff",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-cit",
                        premiseId: "p-d",
                        parentId: "e-iff",
                        position: 0,
                        variableId: "v-cit",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-iff",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
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
                ],
                claims: [
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            const violations = validateD1(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-1",
                premiseId: "p-d",
            })
        })

        it("rejects populated form where consequent is missing", () => {
            // Root IMPLIES with antecedent variable but no position-1 child.
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-cit",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-cit",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-cit",
                        claimId: "claim-cit",
                        symbol: "C",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            const violations = validateD1(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-1")
        })

        it("rejects naked-Q when the variable doesn't bind to derivedClaimId", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-x",
                        premiseId: "p-d",
                        parentId: null,
                        variableId: "v-other",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-other",
                        claimId: "claim-other",
                        symbol: "X",
                    }),
                ],
                claims: [
                    makeNormalClaim({ id: "claim-q" }),
                    makeNormalClaim({ id: "claim-other" }),
                ],
            })
            const violations = validateD1(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-1")
        })

        it("rejects populated form with a single-child OR antecedent (must be unwrapped per D-2; D-1 also rejects)", () => {
            // The single-citation canonical form is IMPLIES(c, Q) without
            // the OR wrapper. A 1-child OR is neither the single-grounding
            // form (D-2) nor the multi-grounding form (needs ≥ 2 children).
            // D-1 must reject so consumers gating on "D-1 clean" don't
            // accept invalid populated structure; D-2 also fires on the
            // same shape (Derivable-tier UI hint, "drop the OR wrapper").
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
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
                        id: "e-c1",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 0,
                        variableId: "v-c1",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-c1",
                        claimId: "claim-c1",
                        symbol: "C1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-c1" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            const violations = validateD1(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-1",
                premiseId: "p-d",
            })
        })

        it("rejects populated form where antecedent is a non-claim variable (premise-bound)", () => {
            // Antecedent is a premise-bound variable rather than a citation/axiom claim.
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-other" }),
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-pb",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    {
                        id: "v-pb",
                        argumentId: "arg-1",
                        argumentVersion: 1,
                        symbol: "PB",
                        boundPremiseId: "p-other",
                        boundArgumentId: "arg-1",
                        boundArgumentVersion: 1,
                        checksum: "x",
                    },
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [makeNormalClaim({ id: "claim-q" })],
            })
            const violations = validateD1(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-1")
        })
    })

    describe("D-2 single-citation derivation form", () => {
        it("rejects IMPLIES(OR(single-citation-var), Q) — should be IMPLIES(citation-var, Q)", () => {
            // Note: an OR with 1 child also fails E-1 (variadic arity ≥ 2) and
            // P-4 (single-child binary). D-2 is the Derivable-tier UI hint:
            // "this single-citation antecedent should drop the OR wrapper."
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
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
                        id: "e-c1",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 0,
                        variableId: "v-c1",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-c1",
                        claimId: "claim-c1",
                        symbol: "C1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-c1" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            const violations = validateD2(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-2",
                premiseId: "p-d",
            })
        })

        it("accepts IMPLIES(citation-var, Q) — single-citation already in canonical form", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-cit",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-cit",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
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
                ],
                claims: [
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD2(ctx)).toEqual([])
        })
    })

    describe("D-3 no mixing axioms and citations in one derivation", () => {
        it("rejects IMPLIES(OR(axiom-var, citation-var), Q)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
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
                ],
                variables: [
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
                ],
                claims: [
                    makeAxiomaticClaim({ id: "claim-ax" }),
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            const violations = validateD3(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-3",
                premiseId: "p-d",
            })
        })

        it("rejects IMPLIES(formula(OR(axiom-var, citation-var)), Q) — formula transparency", () => {
            // Same mixed-grounding violation, but with the canonical formula buffer
            // between IMPLIES and OR. D-3 should still fire — formula nodes are
            // transparent for the mixed-grounding scan.
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeFormulaExpression({
                        id: "e-formula",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                    }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        premiseId: "p-d",
                        parentId: "e-formula",
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
                ],
                variables: [
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
                ],
                claims: [
                    makeAxiomaticClaim({ id: "claim-ax" }),
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            const violations = validateD3(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-3")
        })

        it("accepts IMPLIES(OR(citation-var, citation-var), Q) — all citations", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
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
                        id: "e-c1",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 0,
                        variableId: "v-c1",
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 1,
                        variableId: "v-c2",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-c1",
                        claimId: "claim-c1",
                        symbol: "C1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-c2",
                        claimId: "claim-c2",
                        symbol: "C2",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-c1" }),
                    makeCitationClaim({ id: "claim-c2" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD3(ctx)).toEqual([])
        })

        it("accepts IMPLIES(OR(axiom-var, axiom-var), Q) — all axioms", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
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
                        id: "e-a1",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 0,
                        variableId: "v-a1",
                    }),
                    makeVariableExpression({
                        id: "e-a2",
                        premiseId: "p-d",
                        parentId: "e-or",
                        position: 1,
                        variableId: "v-a2",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-a1",
                        claimId: "claim-a1",
                        symbol: "A1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-a2",
                        claimId: "claim-a2",
                        symbol: "A2",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeAxiomaticClaim({ id: "claim-a1" }),
                    makeAxiomaticClaim({ id: "claim-a2" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD3(ctx)).toEqual([])
        })
    })

    describe("D-4 axiomatic claim placement", () => {
        it("rejects axiomatic-bound variable appearing in a freeform premise", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-free" })],
                expressions: [
                    makeVariableExpression({
                        id: "e-ax",
                        premiseId: "p-free",
                        parentId: null,
                        variableId: "v-ax",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-ax",
                        claimId: "claim-ax",
                        symbol: "A",
                    }),
                ],
                claims: [makeAxiomaticClaim({ id: "claim-ax" })],
            })
            const violations = validateD4(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-4",
            })
        })

        it("rejects axiomatic-bound variable at the consequent slot of a derivation premise", () => {
            // Position-1 child of root IMPLIES is the consequent slot. An
            // axiomatic-bound variable there is misplaced (only normal claims
            // belong at the consequent).
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-ax",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-other-ax",
                    }),
                    makeVariableExpression({
                        id: "e-cons-ax",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-ax-as-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-other-ax",
                        claimId: "claim-other-ax",
                        symbol: "A1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-ax-as-q",
                        claimId: "claim-ax",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeAxiomaticClaim({ id: "claim-other-ax" }),
                    makeAxiomaticClaim({ id: "claim-ax" }),
                ],
            })
            const violations = validateD4(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-4")
        })

        it("rejects axiomatic-bound variable at the naked-Q root of a derivation premise", () => {
            // Naked-Q form: the single variable at root IS the consequent
            // (per spec §4.3 D-1). An axiomatic-bound variable there is
            // misplaced — the consequent must bind to a 'normal' claim.
            // `isInDerivationAntecedent` has an explicit short-circuit for
            // this case (root.type === 'variable' → false).
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-ax",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-naked-ax",
                        premiseId: "p-d",
                        parentId: null,
                        variableId: "v-ax",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-ax",
                        claimId: "claim-ax",
                        symbol: "A",
                    }),
                ],
                claims: [makeAxiomaticClaim({ id: "claim-ax" })],
            })
            const violations = validateD4(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-4")
        })

        it("accepts axiomatic-bound variable in the antecedent of a derivation premise", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-ax",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-ax",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-ax",
                        claimId: "claim-ax",
                        symbol: "A",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeAxiomaticClaim({ id: "claim-ax" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD4(ctx)).toEqual([])
        })
    })

    describe("D-5 citation claim placement", () => {
        it("rejects citation-bound variable in a freeform premise", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-free" })],
                expressions: [
                    makeVariableExpression({
                        id: "e-cit",
                        premiseId: "p-free",
                        parentId: null,
                        variableId: "v-cit",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-cit",
                        claimId: "claim-cit",
                        symbol: "C",
                    }),
                ],
                claims: [makeCitationClaim({ id: "claim-cit" })],
            })
            const violations = validateD5(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-5",
            })
        })

        it("rejects citation-bound variable at the consequent slot of a derivation premise", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-cit",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-other-cit",
                    }),
                    makeVariableExpression({
                        id: "e-cons-cit",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-cit-as-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-other-cit",
                        claimId: "claim-other-cit",
                        symbol: "C1",
                    }),
                    makeClaimBoundVariable({
                        id: "v-cit-as-q",
                        claimId: "claim-cit",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeCitationClaim({ id: "claim-other-cit" }),
                    makeCitationClaim({ id: "claim-cit" }),
                ],
            })
            const violations = validateD5(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-5")
        })

        it("rejects citation-bound variable at the naked-Q root of a derivation premise", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-cit",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-naked-cit",
                        premiseId: "p-d",
                        parentId: null,
                        variableId: "v-cit",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-cit",
                        claimId: "claim-cit",
                        symbol: "C",
                    }),
                ],
                claims: [makeCitationClaim({ id: "claim-cit" })],
            })
            const violations = validateD5(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("D-5")
        })

        it("accepts citation-bound variable in the antecedent of a derivation premise", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-cit",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-cit",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
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
                ],
                claims: [
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
            })
            expect(validateD5(ctx)).toEqual([])
        })
    })

    describe("D-6 derivation premise role", () => {
        it("rejects a derivation premise designated as conclusion", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                roleState: { conclusionPremiseId: "p-d" },
            })
            const violations = validateD6(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "derivable",
                code: "D-6",
                premiseId: "p-d",
            })
        })

        it("accepts a derivation premise as supporting (default)", () => {
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-free" }),
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                roleState: { conclusionPremiseId: "p-free" },
            })
            expect(validateD6(ctx)).toEqual([])
        })
    })

    // D-7 reserved — see spec §4.3. No test block.

    describe("aggregator validateDerivable", () => {
        it("concatenates every per-rule validator's output", () => {
            // Composite fixture: derivation premise with IFF at root (D-1)
            // designated as conclusion (D-6).
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeOperatorExpression("iff", {
                        id: "e-iff",
                        premiseId: "p-d",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-d",
                        parentId: "e-iff",
                        position: 0,
                        variableId: "v-cit",
                    }),
                    makeVariableExpression({
                        id: "e-q",
                        premiseId: "p-d",
                        parentId: "e-iff",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
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
                ],
                claims: [
                    makeCitationClaim({ id: "claim-cit" }),
                    makeNormalClaim({ id: "claim-q" }),
                ],
                roleState: { conclusionPremiseId: "p-d" },
            })
            const codes = validateDerivable(ctx).map((v) => v.code)
            expect(codes).toContain("D-1")
            expect(codes).toContain("D-6")
        })
    })
})
