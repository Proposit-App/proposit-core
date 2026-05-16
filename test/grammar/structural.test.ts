import { describe, it, expect } from "vitest"
import {
    validateS1,
    validateS2,
    validateS3,
    validateS4,
    validateS5,
    validateS6,
    validateS7,
    validateS8,
    validateS9,
    validateS10,
    validateS11,
    validateS12,
    validateS13,
    validateS14,
    validateStructural,
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

        it("returns a violation for a 3-node cycle (e-1 → e-2 → e-3 → e-1)", () => {
            const ctx = buildContext({
                expressions: [
                    makeVariableExpression({
                        id: "e-1",
                        parentId: "e-3",
                    }),
                    makeVariableExpression({
                        id: "e-2",
                        parentId: "e-1",
                    }),
                    makeVariableExpression({
                        id: "e-3",
                        parentId: "e-2",
                    }),
                ],
            })
            const violations = validateS4(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations.every((v) => v.code === "S-4")).toBe(true)
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

    describe("S-8 binary operator arity (implies/iff have exactly 2 children)", () => {
        it("returns a violation when implies has != 2 children", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "e-only-child",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 0,
                    }),
                ],
            })
            const violations = validateS8(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "structural",
                code: "S-8",
                expressionId: "e-impl",
            })
        })

        it("returns a violation when iff has 3 children", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("iff", {
                        id: "e-iff",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "c-0",
                        premiseId: "p-1",
                        parentId: "e-iff",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "c-1",
                        premiseId: "p-1",
                        parentId: "e-iff",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "c-2",
                        premiseId: "p-1",
                        parentId: "e-iff",
                        position: 2,
                    }),
                ],
            })
            const violations = validateS8(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-8")
        })

        // Pre-1.0.2 S-8 also pinned positions to literal [0, 1]. The
        // 1.0.2 relaxation drops the position check — only arity matters.
        // The two non-[0,1] cases below now PASS S-8 (any [a, b] with
        // a < b is equivalent to [0, 1] under S-8's relaxed reading);
        // S-9 still guards sibling-position uniqueness.

        it("returns an empty array for IMPLIES(a@5, b@10) (positions are sibling metadata, not S-8 concern)", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "c-0",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 5,
                    }),
                    makeVariableExpression({
                        id: "c-1",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 10,
                    }),
                ],
            })
            expect(validateS8(ctx)).toEqual([])
        })

        it("returns an empty array for IMPLIES(a@0, b@1073741823) (midpoint-spaced positions are valid)", () => {
            // Regression for the bug that motivated the 1.0.2 relaxation:
            // pre-1.0.1 wrapExpression/insertExpression assigned midpoint
            // positions to all binary children (including implies/iff);
            // S-8 falsely flagged these as violations. Post-1.0.2 they
            // are valid by construction.
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "c-0",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "c-1",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 1073741823,
                    }),
                ],
            })
            expect(validateS8(ctx)).toEqual([])
        })

        it("returns an empty array for IMPLIES(a@0, b@1)", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "c-0",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "c-1",
                        premiseId: "p-1",
                        parentId: "e-impl",
                        position: 1,
                    }),
                ],
            })
            expect(validateS8(ctx)).toEqual([])
        })
    })

    describe("S-9 sibling position uniqueness", () => {
        it("returns a violation when two siblings under the same parent share a position", () => {
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("and", {
                        id: "e-root",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "e-a",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 1000,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 1000,
                    }),
                ],
            })
            const violations = validateS9(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-9")
        })

        it("returns an empty array when every sibling group has unique positions", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-root" }),
                    makeVariableExpression({
                        id: "e-a",
                        parentId: "e-root",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-root",
                        position: 1,
                    }),
                ],
            })
            expect(validateS9(ctx)).toEqual([])
        })

        it("does not flag two different premises whose roots are both at position 0 (root-sibling scope is per premise)", () => {
            // Cross-premise isolation: each premise's roots are their own
            // sibling set, so two premises with roots at position 0 don't
            // collide.
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeFreeformPremise({ id: "p-2" }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-r1",
                        premiseId: "p-1",
                        parentId: null,
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-r2",
                        premiseId: "p-2",
                        parentId: null,
                        position: 0,
                    }),
                ],
            })
            expect(validateS9(ctx)).toEqual([])
        })
    })

    describe("S-10 entity ID uniqueness", () => {
        it("returns a violation when two premises share an ID", () => {
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeFreeformPremise({ id: "p-1" }),
                ],
            })
            const violations = validateS10(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-10")
        })

        it("returns a violation when two expressions share an ID", () => {
            const ctx = buildContext({
                expressions: [
                    makeVariableExpression({ id: "e-1" }),
                    makeVariableExpression({ id: "e-1" }),
                ],
            })
            const violations = validateS10(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-10")
        })

        it("returns a violation when two variables share an ID", () => {
            const ctx = buildContext({
                variables: [
                    makeClaimBoundVariable({ id: "v-1", symbol: "P" }),
                    makeClaimBoundVariable({ id: "v-1", symbol: "Q" }),
                ],
            })
            const violations = validateS10(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-10")
        })

        it("returns an empty array when all entity IDs are unique", () => {
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeFreeformPremise({ id: "p-2" }),
                ],
                expressions: [
                    makeVariableExpression({ id: "e-1", premiseId: "p-1" }),
                    makeVariableExpression({ id: "e-2", premiseId: "p-2" }),
                ],
                variables: [
                    makeClaimBoundVariable({ id: "v-1", symbol: "P" }),
                    makeClaimBoundVariable({ id: "v-2", symbol: "Q" }),
                ],
            })
            expect(validateS10(ctx)).toEqual([])
        })

        it("flags duplicate expression IDs that span different premises within the same argument (argument-wide scope)", () => {
            // S-10 / S-11 scope is the whole argument, not per-premise; two
            // expressions in different premises with the same id is still
            // a duplicate. Matches the originating EXPR_DUPLICATE_ID error
            // code's semantics from src/lib/types/validation.ts.
            const ctx = buildContext({
                premises: [
                    makeFreeformPremise({ id: "p-1" }),
                    makeFreeformPremise({ id: "p-2" }),
                ],
                expressions: [
                    makeVariableExpression({ id: "e-dup", premiseId: "p-1" }),
                    makeVariableExpression({ id: "e-dup", premiseId: "p-2" }),
                ],
            })
            const violations = validateS10(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-10")
        })
    })

    describe("S-11 variable symbol uniqueness", () => {
        it("returns a violation when two variables share a symbol", () => {
            const ctx = buildContext({
                variables: [
                    makeClaimBoundVariable({ id: "v-1", symbol: "P" }),
                    makeClaimBoundVariable({ id: "v-2", symbol: "P" }),
                ],
            })
            const violations = validateS11(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("S-11")
        })

        it("returns an empty array when every variable symbol is unique", () => {
            const ctx = buildContext({
                variables: [
                    makeClaimBoundVariable({ id: "v-1", symbol: "P" }),
                    makeClaimBoundVariable({ id: "v-2", symbol: "Q" }),
                ],
            })
            expect(validateS11(ctx)).toEqual([])
        })
    })

    describe("S-12 NOT unary arity", () => {
        it("returns a violation when not has 0 children", () => {
            const ctx = buildContext({
                expressions: [makeOperatorExpression("not", { id: "e-not" })],
            })
            const violations = validateS12(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("S-12")
        })

        it("returns a violation when not has 2 children", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("not", { id: "e-not" }),
                    makeVariableExpression({
                        id: "c-0",
                        parentId: "e-not",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "c-1",
                        parentId: "e-not",
                        position: 1,
                    }),
                ],
            })
            const violations = validateS12(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("S-12")
        })

        it("returns an empty array when every not has exactly one child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("not", { id: "e-not" }),
                    makeVariableExpression({
                        id: "c-0",
                        parentId: "e-not",
                        position: 0,
                    }),
                ],
            })
            expect(validateS12(ctx)).toEqual([])
        })
    })

    describe("S-13 formula unary arity", () => {
        it("returns a violation when formula has 0 children", () => {
            const ctx = buildContext({
                expressions: [makeFormulaExpression({ id: "e-formula" })],
            })
            const violations = validateS13(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("S-13")
        })

        it("returns a violation when formula has 2+ children", () => {
            const ctx = buildContext({
                expressions: [
                    makeFormulaExpression({ id: "e-formula" }),
                    makeVariableExpression({
                        id: "c-0",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "c-1",
                        parentId: "e-formula",
                        position: 1,
                    }),
                ],
            })
            const violations = validateS13(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("S-13")
        })

        it("returns an empty array when every formula has exactly one child", () => {
            const ctx = buildContext({
                expressions: [
                    makeFormulaExpression({ id: "e-formula" }),
                    makeVariableExpression({
                        id: "c-0",
                        parentId: "e-formula",
                        position: 0,
                    }),
                ],
            })
            expect(validateS13(ctx)).toEqual([])
        })
    })

    describe("S-14 derivation premise root operator", () => {
        it.each(["and", "or", "not", "formula"] as const)(
            "returns a violation when a derivation premise root is %s",
            (op) => {
                const ctx = buildContext({
                    premises: [
                        makeDerivationPremise({
                            id: "p-1",
                            derivedClaimId: "claim-1",
                        }),
                    ],
                    expressions:
                        op === "formula"
                            ? [
                                  makeFormulaExpression({
                                      id: "e-root",
                                      premiseId: "p-1",
                                      parentId: null,
                                  }),
                              ]
                            : [
                                  makeOperatorExpression(op, {
                                      id: "e-root",
                                      premiseId: "p-1",
                                      parentId: null,
                                  }),
                              ],
                })
                const violations = validateS14(ctx)
                expect(violations.length).toBeGreaterThanOrEqual(1)
                expect(violations[0].code).toBe("S-14")
                expect(violations[0].premiseId).toBe("p-1")
            }
        )

        it("returns an empty array when the derivation premise root is variable, implies, or iff", () => {
            // Three separate premises, one of each valid root.
            const ctx = buildContext({
                premises: [
                    makeDerivationPremise({
                        id: "p-naked",
                        derivedClaimId: "claim-1",
                    }),
                    makeDerivationPremise({
                        id: "p-impl",
                        derivedClaimId: "claim-2",
                    }),
                    makeDerivationPremise({
                        id: "p-iff",
                        derivedClaimId: "claim-3",
                    }),
                ],
                expressions: [
                    makeVariableExpression({
                        id: "e-naked",
                        premiseId: "p-naked",
                        parentId: null,
                    }),
                    makeOperatorExpression("implies", {
                        id: "e-impl",
                        premiseId: "p-impl",
                        parentId: null,
                    }),
                    makeOperatorExpression("iff", {
                        id: "e-iff",
                        premiseId: "p-iff",
                        parentId: null,
                    }),
                ],
            })
            expect(validateS14(ctx)).toEqual([])
        })
    })

    describe("aggregator validateStructural", () => {
        it("concatenates every per-rule validator's output", () => {
            // Context that fails S-1 (missing parent), S-9 (duplicate
            // sibling positions), and S-12 (not with 0 children).
            const ctx = buildContext({
                premises: [makeFreeformPremise({ id: "p-1" })],
                expressions: [
                    makeOperatorExpression("and", {
                        id: "e-root",
                        premiseId: "p-1",
                    }),
                    makeVariableExpression({
                        id: "e-bad-parent",
                        premiseId: "p-1",
                        parentId: "missing",
                    }),
                    makeVariableExpression({
                        id: "e-pos-a",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 7,
                    }),
                    makeVariableExpression({
                        id: "e-pos-b",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 7,
                    }),
                    makeOperatorExpression("not", {
                        id: "e-not",
                        premiseId: "p-1",
                        parentId: "e-root",
                        position: 8,
                    }),
                ],
            })
            const codes = validateStructural(ctx).map((v) => v.code)
            expect(codes).toContain("S-1")
            expect(codes).toContain("S-9")
            expect(codes).toContain("S-12")
        })
    })
})
