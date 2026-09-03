import { describe, it, expect } from "vitest"
import {
    validateE1,
    validateE3,
    validateE4,
    validateE5,
    validateE6,
    validateE7,
    validateEvaluable,
} from "../../src/lib/grammar/validators/evaluable.js"
import {
    buildContext,
    makeArgument,
    makeFreeformPremise,
    makeDerivationPremise,
    makeVariableExpression,
    makeOperatorExpression,
    makeClaimBoundVariable,
    makePremiseBoundVariable,
    makeNormalClaim,
} from "./fixtures.js"

describe("grammar/evaluable", () => {
    describe("E-1 variadic operator arity floor", () => {
        it("returns a violation when 'and' has 0 children", () => {
            const ctx = buildContext({
                expressions: [makeOperatorExpression("and", { id: "e-and" })],
            })
            const violations = validateE1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-1",
                expressionId: "e-and",
            })
        })

        it("returns a violation when 'and' has 1 child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeVariableExpression({
                        id: "c-0",
                        parentId: "e-and",
                        position: 0,
                    }),
                ],
            })
            const violations = validateE1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("E-1")
        })

        it("returns a violation when 'or' has 0 children", () => {
            const ctx = buildContext({
                expressions: [makeOperatorExpression("or", { id: "e-or" })],
            })
            const violations = validateE1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("E-1")
        })

        it("returns a violation when 'or' has 1 child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("or", { id: "e-or" }),
                    makeVariableExpression({
                        id: "c-0",
                        parentId: "e-or",
                        position: 0,
                    }),
                ],
            })
            const violations = validateE1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("E-1")
        })

        it("returns an empty array when 'and' and 'or' have 2+ children", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeVariableExpression({
                        id: "a-0",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "a-1",
                        parentId: "e-and",
                        position: 1,
                    }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        premiseId: "p-2",
                    }),
                    makeVariableExpression({
                        id: "o-0",
                        parentId: "e-or",
                        position: 0,
                        premiseId: "p-2",
                    }),
                    makeVariableExpression({
                        id: "o-1",
                        parentId: "e-or",
                        position: 1,
                        premiseId: "p-2",
                    }),
                    makeVariableExpression({
                        id: "o-2",
                        parentId: "e-or",
                        position: 2,
                        premiseId: "p-2",
                    }),
                ],
            })
            expect(validateE1(ctx)).toEqual([])
        })

        it("returns a violation when 'xor' has 0 children", () => {
            const ctx = buildContext({
                expressions: [makeOperatorExpression("xor", { id: "e-xor" })],
            })
            const violations = validateE1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-1",
                expressionId: "e-xor",
            })
        })

        it("returns a violation when 'xor' has 1 child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("xor", { id: "e-xor" }),
                    makeVariableExpression({
                        id: "x-0",
                        parentId: "e-xor",
                        position: 0,
                    }),
                ],
            })
            const violations = validateE1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-1",
                expressionId: "e-xor",
            })
        })

        it("returns an empty array when 'xor' has 2 children", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("xor", { id: "e-xor" }),
                    makeVariableExpression({
                        id: "x-0",
                        parentId: "e-xor",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "x-1",
                        parentId: "e-xor",
                        position: 1,
                    }),
                ],
            })
            expect(validateE1(ctx)).toEqual([])
        })

        it("returns an empty array when 'xor' has 3 children — it is variadic, not binary", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("xor", { id: "e-xor" }),
                    makeVariableExpression({
                        id: "x-0",
                        parentId: "e-xor",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "x-1",
                        parentId: "e-xor",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "x-2",
                        parentId: "e-xor",
                        position: 2,
                    }),
                ],
            })
            expect(validateE1(ctx)).toEqual([])
        })
    })

    // E-2 is reserved — see spec §4.2. No test block.

    describe("E-3 variable binding resolves", () => {
        it("returns a violation when a claim-bound variable references a non-existent claim", () => {
            const ctx = buildContext({
                variables: [
                    makeClaimBoundVariable({
                        id: "v-1",
                        claimId: "missing-claim",
                    }),
                ],
                claims: [makeNormalClaim({ id: "other-claim" })],
            })
            const violations = validateE3(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-3",
                variableId: "v-1",
                claimId: "missing-claim",
            })
        })

        it("returns a violation when an internally-bound premise variable references a non-existent premise", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                variables: [
                    makePremiseBoundVariable({
                        id: "v-1",
                        boundPremiseId: "missing-premise",
                        boundArgumentId: "arg-1",
                    }),
                ],
            })
            const violations = validateE3(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("E-3")
        })

        it("returns an empty array when every binding resolves", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                variables: [
                    makeClaimBoundVariable({ id: "v-1", claimId: "claim-1" }),
                    makePremiseBoundVariable({
                        id: "v-2",
                        boundPremiseId: "p-1",
                    }),
                ],
                claims: [makeNormalClaim({ id: "claim-1" })],
            })
            expect(validateE3(ctx)).toEqual([])
        })

        it("does not flag externally-bound variables (resolve in a different argument)", () => {
            const ctx = buildContext({
                variables: [
                    makePremiseBoundVariable({
                        id: "v-1",
                        boundPremiseId: "external-premise",
                        boundArgumentId: "other-arg",
                    }),
                ],
            })
            expect(validateE3(ctx)).toEqual([])
        })
    })

    describe("E-4 axiomatic-binding constraint (no-op at AST level)", () => {
        it("returns an empty array regardless of argument shape (runtime-only guard)", () => {
            const ctx = buildContext({
                variables: [makeClaimBoundVariable({ id: "v-1" })],
                claims: [makeNormalClaim({ id: "claim-1" })],
            })
            expect(validateE4(ctx)).toEqual([])
        })
    })

    describe("E-5 derivation premise consequent present", () => {
        it("returns a violation when a derivation premise tree contains no variable bound to derivedClaimId", () => {
            // Derivation premise for claim-Q, but tree has variable bound to claim-R.
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-root",
                        premiseId: "p-d",
                        variableId: "v-r",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({ id: "v-r", claimId: "claim-r" }),
                ],
                claims: [
                    makeNormalClaim({ id: "claim-q" }),
                    makeNormalClaim({ id: "claim-r" }),
                ],
            })
            const violations = validateE5(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-5",
                premiseId: "p-d",
            })
        })

        it("returns an empty array for naked-Q (lone variable at root is the consequent)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-root",
                        premiseId: "p-d",
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({ id: "v-q", claimId: "claim-q" }),
                ],
                claims: [makeNormalClaim({ id: "claim-q" })],
            })
            expect(validateE5(ctx)).toEqual([])
        })

        it("returns an empty array when consequent is wrapped in a formula buffer", () => {
            // E-5 scans every expression in the premise's tree, so the
            // consequent satisfies E-5 regardless of intervening formula
            // buffers. This is implicit in the implementation; explicit
            // test for the spec §4.2 expectation.
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
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-ant",
                    }),
                    // Position-1 child of root IMPLIES is a formula buffer
                    // wrapping the consequent variable.
                    {
                        id: "e-cons-formula",
                        argumentId: "arg-1",
                        argumentVersion: 1,
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        type: "formula" as const,
                        checksum: "x",
                        descendantChecksum: null,
                        combinedChecksum: "x",
                    },
                    makeVariableExpression({
                        id: "e-cons-q",
                        premiseId: "p-d",
                        parentId: "e-cons-formula",
                        position: 0,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-ant",
                        claimId: "claim-ant",
                        symbol: "A",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeNormalClaim({ id: "claim-q" }),
                    makeNormalClaim({ id: "claim-ant" }),
                ],
            })
            expect(validateE5(ctx)).toEqual([])
        })

        it("returns an empty array for populated form (consequent at position 1)", () => {
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
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 0,
                        variableId: "v-ant",
                    }),
                    makeVariableExpression({
                        id: "e-cons",
                        premiseId: "p-d",
                        parentId: "e-impl",
                        position: 1,
                        variableId: "v-q",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({
                        id: "v-ant",
                        claimId: "claim-ant",
                        symbol: "A",
                    }),
                    makeClaimBoundVariable({
                        id: "v-q",
                        claimId: "claim-q",
                        symbol: "Q",
                    }),
                ],
                claims: [
                    makeNormalClaim({ id: "claim-q" }),
                    makeNormalClaim({ id: "claim-ant" }),
                ],
            })
            expect(validateE5(ctx)).toEqual([])
        })
    })

    describe("E-6 claim-derivation pairing", () => {
        it("returns a violation when a normal claim has 2+ derivation premises with matching derivedClaimId", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d-1",
                        derivedClaimId: "claim-q",
                    }),
                    makeDerivationPremise({
                        id: "p-d-2",
                        derivedClaimId: "claim-q",
                    }),
                ],
                claims: [makeNormalClaim({ id: "claim-q" })],
            })
            const violations = validateE6(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("E-6")
        })

        it("returns an empty array when a normal claim has 0 derivation premises (post-pruning state)", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                claims: [makeNormalClaim({ id: "claim-q" })],
            })
            expect(validateE6(ctx)).toEqual([])
        })

        it("returns an empty array when a normal claim has exactly 1 derivation premise (mid-edit state)", () => {
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-d",
                        derivedClaimId: "claim-q",
                    }),
                ],
                claims: [makeNormalClaim({ id: "claim-q" })],
            })
            expect(validateE6(ctx)).toEqual([])
        })
    })

    describe("E-7 argument has conclusion premise", () => {
        // E-7 retains its strict pre-1.0.2 reading: any non-empty
        // argument with no `conclusionPremiseId` violates. The 1.0.2
        // change moved the constraint to the engine mutation surface
        // (`clearConclusionPremise` no-op on non-empty, `removePremise`
        // auto-reassigns on conclusion-deletion-with-others-remaining)
        // — E-7 stays as the validate-time safety net for snapshot
        // loads and direct data-shape construction that the
        // mutation-surface guards can't intercept.

        it("returns a violation when a 1-premise argument has no conclusion designated", () => {
            // Strict pre-1.0.2 reading: even a single premise requires
            // an explicit designation at the validator level. In
            // production this state is unreachable through the
            // mutation API (the engine guards `clearConclusionPremise`
            // / `removePremise`), but `validateE7` runs against
            // arbitrary contexts (snapshot loads, direct fixture
            // construction) and must still catch it.
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                roleState: {},
            })
            const violations = validateE7(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-7",
            })
        })

        it("returns a violation when a 2+-premise argument has no conclusion designated", () => {
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeFreeformPremise({ id: "p-2" }),
                ],
                roleState: {},
            })
            const violations = validateE7(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "evaluable",
                code: "E-7",
            })
        })

        it("returns a violation when the conclusion premise id doesn't match any premise", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                roleState: { conclusionPremiseId: "missing-premise" },
            })
            const violations = validateE7(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("E-7")
        })

        it("returns an empty array for an argument with zero premises (brand-new)", () => {
            const ctx = buildContext({
                argument: makeArgument(),
                premises: [],
                roleState: {},
            })
            expect(validateE7(ctx)).toEqual([])
        })

        it("returns an empty array for an argument with a designated conclusion", () => {
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeFreeformPremise({ id: "p-2" }),
                ],
                roleState: { conclusionPremiseId: "p-1" },
            })
            expect(validateE7(ctx)).toEqual([])
        })
    })

    describe("aggregator validateEvaluable", () => {
        it("concatenates every per-rule validator's output", () => {
            // Context that fails E-1 (and with 1 child) and E-7
            // (premise with no conclusion). A 1-premise no-conclusion
            // fixture suffices under the strict E-7 reading restored
            // in 1.0.2.
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("and", {
                        id: "e-and",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "e-only",
                        premiseId: "p-1",
                        parentId: "e-and",
                        position: 0,
                    }),
                ],
                roleState: {},
            })
            const codes = validateEvaluable(ctx).map((v) => v.code)
            expect(codes).toContain("E-1")
            expect(codes).toContain("E-7")
        })
    })
})
