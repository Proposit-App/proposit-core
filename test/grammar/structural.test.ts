import { describe, it, expect } from "vitest"
import { validateS1 } from "../../src/lib/grammar/validators/structural.js"
import {
    buildContext,
    makeFreeformPremise,
    makeVariableExpression,
    makeOperatorExpression,
    makeClaimBoundVariable,
    makePremiseBoundVariable,
    makeNormalClaim,
} from "./fixtures.js"

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
        it.todo(
            "returns a violation when expression.type is not one of the allowed discriminators"
        )
        it.todo("returns an empty array for every legal operator type")
    })

    describe("S-3 variable required reference", () => {
        it.todo(
            "returns a violation when a variable has neither claim ref nor premise ref"
        )
        it.todo(
            "returns a violation when a variable has both claim ref and premise ref"
        )
        it.todo(
            "returns an empty array when exactly one of the two refs is present"
        )
    })

    describe("S-4 no cycles", () => {
        it.todo(
            "returns a violation when the expression tree of a premise has a cycle"
        )
        it.todo(
            "returns a violation when the argument's claim/citation/axiom graph has a cycle"
        )
        it.todo("returns an empty array for acyclic graphs")
    })

    describe("S-5 root-only IMPLIES/IFF", () => {
        it.todo("returns a violation when implies appears as a non-root child")
        it.todo("returns a violation when iff appears as a non-root child")
        it.todo(
            "returns a violation when a premise has more than one implies/iff at root"
        )
        it.todo(
            "returns an empty array when implies/iff is exactly at root and there is at most one per premise"
        )
    })

    describe("S-6 premise type discriminator consistency", () => {
        it.todo(
            "returns a violation when type='derivation' premise has null derivedClaimId"
        )
        it.todo(
            "returns a violation when type='freeform' premise has non-null derivedClaimId"
        )
        it.todo(
            "returns an empty array for consistent type+derivedClaimId pairs"
        )
    })

    describe("S-7 claim type immutability", () => {
        // S-7 is a creation-time invariant enforced by ClaimLibrary; the
        // validator is a no-op at the AST level. The test confirms it.
        it.todo(
            "validateS7 returns an empty array for any context (rule is creation-time only)"
        )
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
