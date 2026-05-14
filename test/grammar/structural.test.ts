import { describe, it, expect } from "vitest"
import {
    validateS1,
    validateS2,
    validateS3,
    validateS4,
    validateS5,
    validateS6,
    validateS7,
} from "../../src/lib/grammar/validators/structural.js"
import {
    buildContext,
    makeFreeformPremise,
    makeDerivationPremise,
    makeVariableExpression,
    makeOperatorExpression,
    makeFormulaExpression,
    makeClaimBoundVariable,
    makePremiseBoundVariable,
    makeNormalClaim,
} from "./fixtures.js"
import type { TCorePropositionalExpression } from "../../src/lib/schemata/index.js"

describe("grammar/structural", () => {
    describe("S-1 FK soundness", () => {
        it("returns a violation when expression.parentId points at a missing expression", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeVariableExpression({
                        id: "e-1",
                        premiseId: "p-1",
                        parentId: "missing-parent",
                    }),
                ],
                variables: [makeClaimBoundVariable({ id: "v-1" })],
                claims: [makeNormalClaim({ id: "claim-1" })],
            })
            const violations = validateS1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-1",
                expressionId: "e-1",
                premiseId: "p-1",
            })
        })

        it("returns a violation when an internally-bound premise-bound variable references a missing premise", () => {
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
            const violations = validateS1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-1",
                variableId: "v-1",
                premiseId: "missing-premise",
            })
        })

        it("returns a violation when a claim-bound variable references a missing claim", () => {
            const ctx = buildContext({
                variables: [
                    makeClaimBoundVariable({
                        id: "v-1",
                        claimId: "missing-claim",
                    }),
                ],
                claims: [makeNormalClaim({ id: "claim-1" })],
            })
            const violations = validateS1(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-1",
                variableId: "v-1",
                claimId: "missing-claim",
            })
        })

        it("returns an empty array when every FK resolves", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("and", {
                        id: "e-root",
                        premiseId: "p-1",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-child-1",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 0,
                        variableId: "v-1",
                    }),
                    makeVariableExpression({
                        id: "e-child-2",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 1,
                        variableId: "v-2",
                    }),
                ],
                variables: [
                    makeClaimBoundVariable({ id: "v-1", claimId: "claim-1" }),
                    makeClaimBoundVariable({ id: "v-2", claimId: "claim-2" }),
                ],
                claims: [
                    makeNormalClaim({ id: "claim-1" }),
                    makeNormalClaim({ id: "claim-2" }),
                ],
            })
            const violations = validateS1(ctx)
            expect(violations).toEqual([])
        })

        it("does not flag externally-bound premise-bound variables (boundArgumentId !== argument.id)", () => {
            // External binding resolves in a different argument; S-1 is scoped
            // to the current argument's tree.
            const ctx = buildContext({
                variables: [
                    makePremiseBoundVariable({
                        id: "v-1",
                        boundPremiseId: "external-premise",
                        boundArgumentId: "other-arg",
                    }),
                ],
            })
            const violations = validateS1(ctx)
            expect(violations).toEqual([])
        })
    })

    describe("S-2 operator types", () => {
        it("returns a violation when expression.type is unknown", () => {
            const malformed = {
                ...makeVariableExpression({ id: "e-1" }),
                type: "junk" as unknown as "variable",
            } as TCorePropositionalExpression
            const ctx = buildContext({ expressions: [malformed] })
            const violations = validateS2(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-2",
                expressionId: "e-1",
            })
        })

        it("returns a violation when operator expression has an unknown operator", () => {
            const malformed = {
                ...makeOperatorExpression("and", { id: "e-1" }),
                operator: "xor" as unknown as "and",
            } as TCorePropositionalExpression
            const ctx = buildContext({ expressions: [malformed] })
            const violations = validateS2(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-2",
                expressionId: "e-1",
            })
        })

        it("returns an empty array for every legal expression type and operator", () => {
            const ctx = buildContext({
                expressions: [
                    makeVariableExpression({ id: "e-var" }),
                    makeOperatorExpression("not", { id: "e-not" }),
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeOperatorExpression("or", { id: "e-or" }),
                    makeOperatorExpression("implies", { id: "e-impl" }),
                    makeOperatorExpression("iff", { id: "e-iff" }),
                    makeFormulaExpression({ id: "e-formula" }),
                ],
            })
            expect(validateS2(ctx)).toEqual([])
        })
    })

    describe("S-3 variable required reference", () => {
        it("returns a violation when a variable has neither claim ref nor premise ref", () => {
            const malformed = {
                id: "v-1",
                argumentId: "arg-1",
                argumentVersion: 1,
                symbol: "P",
                checksum: "v-checksum",
            }
            const ctx = buildContext({
                // Cast: deliberately malformed (missing both ref kinds).
                variables: [
                    malformed as unknown as Parameters<
                        typeof validateS3
                    >[0]["variables"][number],
                ],
            })
            const violations = validateS3(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-3",
                variableId: "v-1",
            })
        })

        it("returns a violation when a variable has both claim ref and premise ref", () => {
            const malformed = {
                ...makeClaimBoundVariable({ id: "v-1" }),
                boundPremiseId: "p-1",
                boundArgumentId: "arg-1",
                boundArgumentVersion: 1,
            } as unknown as Parameters<
                typeof validateS3
            >[0]["variables"][number]
            const ctx = buildContext({ variables: [malformed] })
            const violations = validateS3(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-3",
                variableId: "v-1",
            })
        })

        it("returns an empty array for valid claim-bound and premise-bound variables", () => {
            const ctx = buildContext({
                variables: [
                    makeClaimBoundVariable({ id: "v-1" }),
                    makePremiseBoundVariable({ id: "v-2" }),
                ],
            })
            expect(validateS3(ctx)).toEqual([])
        })
    })

    describe("S-4 no cycles", () => {
        it("returns a violation when the expression tree contains a parent-pointer cycle", () => {
            // Two expressions forming a cycle: e-1 → e-2 → e-1.
            const ctx = buildContext({
                expressions: [
                    makeVariableExpression({
                        id: "e-1",
                        parentId: "e-2",
                    }),
                    makeVariableExpression({
                        id: "e-2",
                        parentId: "e-1",
                    }),
                ],
            })
            const violations = validateS4(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-4",
            })
        })

        it("returns a violation for a self-referential parent", () => {
            const ctx = buildContext({
                expressions: [
                    makeVariableExpression({
                        id: "e-1",
                        parentId: "e-1",
                    }),
                ],
            })
            const violations = validateS4(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-4",
                expressionId: "e-1",
            })
        })

        it("returns an empty array for an acyclic tree", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-root" }),
                    makeVariableExpression({
                        id: "e-1",
                        parentId: "e-root",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-2",
                        parentId: "e-root",
                        position: 1,
                    }),
                ],
            })
            expect(validateS4(ctx)).toEqual([])
        })
    })

    describe("S-5 root-only IMPLIES/IFF", () => {
        it("returns a violation when implies appears as a non-root child", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("and", {
                        id: "e-root",
                        premiseId: "p-1",
                    }),
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 0,
                    }),
                ],
            })
            const violations = validateS5(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-5",
                expressionId: "e-impl",
                premiseId: "p-1",
            })
        })

        it("returns a violation when iff appears as a non-root child", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("or", {
                        id: "e-root",
                        premiseId: "p-1",
                    }),
                    makeOperatorExpression("iff", {
                        id: "e-iff",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 0,
                    }),
                ],
            })
            const violations = validateS5(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-5",
                expressionId: "e-iff",
            })
        })

        it("returns a violation when a premise has more than one implies/iff at root", () => {
            // Two root-level implies in the same premise.
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-1",
                        premiseId: "p-1",
                        parentId: null,
                    }),
                    makeOperatorExpression("implies", {
                        id: "e-2",
                        premiseId: "p-1",
                        parentId: null,
                        position: 1,
                    }),
                ],
            })
            const violations = validateS5(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations.every((v) => v.code === "S-5")).toBe(true)
        })

        it("returns an empty array for a single implies at the root", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-root",
                        premiseId: "p-1",
                        parentId: null,
                    }),
                    makeVariableExpression({
                        id: "e-ant",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-cons",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 1,
                    }),
                ],
            })
            expect(validateS5(ctx)).toEqual([])
        })
    })

    describe("S-6 premise type discriminator consistency", () => {
        it("returns a violation when type='derivation' premise has null derivedClaimId", () => {
            const malformed = {
                ...makeDerivationPremise({ id: "p-1" }),
                derivedClaimId: null,
            } as unknown as Parameters<typeof validateS6>[0]["premises"][number]
            const ctx = buildContext({ premises: [malformed] })
            const violations = validateS6(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-6",
                premiseId: "p-1",
            })
        })

        it("returns a violation when type='freeform' premise has non-null derivedClaimId", () => {
            const malformed = {
                ...makeFreeformPremise({ id: "p-1" }),
                derivedClaimId: "claim-1",
            } as unknown as Parameters<typeof validateS6>[0]["premises"][number]
            const ctx = buildContext({ premises: [malformed] })
            const violations = validateS6(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-6",
                premiseId: "p-1",
            })
        })

        it("returns an empty array for consistent type+derivedClaimId pairs", () => {
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeDerivationPremise({
                        id: "p-2",
                        derivedClaimId: "claim-1",
                    }),
                ],
            })
            expect(validateS6(ctx)).toEqual([])
        })
    })

    describe("S-7 claim type immutability (AST-level no-op)", () => {
        it("returns an empty array for any context (creation-time invariant only)", () => {
            const ctx = buildContext({
                claims: [
                    makeNormalClaim({ id: "claim-1" }),
                    makeNormalClaim({ id: "claim-2" }),
                ],
            })
            expect(validateS7(ctx)).toEqual([])
        })
    })

    describe("S-8 binary operator arity + positions", () => {
        it.todo("returns a violation when implies has != 2 children")
        it.todo("returns a violation when iff has != 2 children")
        it.todo(
            "returns a violation when implies children are not at positions 0 and 1"
        )
        it.todo(
            "returns a violation when iff children are not at positions 0 and 1"
        )
        it.todo("returns an empty array for IMPLIES(a@0, b@1)")
    })

    describe("S-9 sibling position uniqueness", () => {
        it.todo(
            "returns a violation when two siblings under the same parent share a position value"
        )
        it.todo(
            "returns an empty array when every sibling group has unique positions"
        )
    })

    describe("S-10 entity ID uniqueness", () => {
        it.todo(
            "returns a violation when two premises in the same argument share an ID"
        )
        it.todo(
            "returns a violation when two expressions in the same argument share an ID"
        )
        it.todo(
            "returns a violation when two variables in the same argument share an ID"
        )
        it.todo("returns an empty array when all entity IDs are unique")
    })

    describe("S-11 variable symbol uniqueness", () => {
        it.todo(
            "returns a violation when two variables share a symbol within an argument"
        )
        it.todo("returns an empty array when every variable symbol is unique")
    })

    describe("S-12 NOT unary arity", () => {
        it.todo("returns a violation when a not expression has 0 children")
        it.todo("returns a violation when a not expression has 2 children")
        it.todo("returns an empty array when every not has exactly one child")
    })

    describe("S-13 formula unary arity", () => {
        it.todo("returns a violation when a formula expression has 0 children")
        it.todo("returns a violation when a formula expression has 2+ children")
        it.todo(
            "returns an empty array when every formula has exactly one child"
        )
    })

    describe("S-14 derivation premise root operator", () => {
        it.todo("returns a violation when a derivation premise root is 'and'")
        it.todo("returns a violation when a derivation premise root is 'or'")
        it.todo("returns a violation when a derivation premise root is 'not'")
        it.todo(
            "returns a violation when a derivation premise root is 'formula'"
        )
        it.todo(
            "returns an empty array when the root is 'variable', 'implies', or 'iff'"
        )
    })

    describe("aggregator validateStructural", () => {
        it.todo("concatenates every per-rule validator's output")
    })
})
