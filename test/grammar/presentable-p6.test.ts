import { describe, it, expect } from "vitest"
import { validateP6 } from "../../src/lib/grammar/validators/presentable.js"
import { validate } from "../../src/lib/grammar/validate.js"
import {
    buildContext,
    makeVariableExpression,
    makeOperatorExpression,
    makeFreeformPremise,
    makeClaimBoundVariable,
    makePremiseBoundVariable,
    makeNormalClaim,
} from "./fixtures.js"

/**
 * A well-formed single-variable premise whose one variable expression is
 * marked unspoken. `binding` decides which kind of variable it points at.
 */
function markedExpressionContext(binding: "claim" | "premise") {
    return buildContext({
        premises: [makeFreeformPremise({ id: "p-1" })],
        expressions: [
            makeVariableExpression({
                id: "e-1",
                premiseId: "p-1",
                variableId: "v-1",
                enthymeme: true,
            }),
        ],
        variables: [
            binding === "claim"
                ? makeClaimBoundVariable({ id: "v-1" })
                : makePremiseBoundVariable({
                      id: "v-1",
                      boundPremiseId: "p-2",
                  }),
        ],
        claims: [makeNormalClaim()],
        roleState: { conclusionPremiseId: "p-1" },
    })
}

describe("grammar/presentable P-6 enthymeme marks a claim-bound variable", () => {
    it("reports a premise-bound variable expression marked unspoken", () => {
        const violations = validateP6(markedExpressionContext("premise"))
        expect(violations).toHaveLength(1)
        expect(violations[0]).toMatchObject({
            tier: "presentable",
            code: "P-6",
            argumentId: "arg-1",
            premiseId: "p-1",
            expressionId: "e-1",
            variableId: "v-1",
        })
    })

    it("accepts a claim-bound variable expression marked unspoken", () => {
        expect(validateP6(markedExpressionContext("claim"))).toHaveLength(0)
    })

    it("accepts a premise-bound variable expression that is not marked", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [
                makeVariableExpression({
                    id: "e-1",
                    premiseId: "p-1",
                    variableId: "v-1",
                }),
            ],
            variables: [
                makePremiseBoundVariable({ id: "v-1", boundPremiseId: "p-2" }),
            ],
        })
        expect(validateP6(ctx)).toHaveLength(0)
    })

    it("ignores enthymeme: false — only an assertion is checked", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [
                makeVariableExpression({
                    id: "e-1",
                    premiseId: "p-1",
                    variableId: "v-1",
                    enthymeme: false,
                }),
            ],
            variables: [
                makePremiseBoundVariable({ id: "v-1", boundPremiseId: "p-2" }),
            ],
        })
        expect(validateP6(ctx)).toHaveLength(0)
    })

    it("ignores a marked premise — a premise has no variable binding to check", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1", enthymeme: true })],
            expressions: [],
            variables: [],
        })
        expect(validateP6(ctx)).toHaveLength(0)
    })

    it("ignores a marked operator expression — the rule is about variables", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [makeOperatorExpression("and", { id: "e-1" })],
            variables: [
                makePremiseBoundVariable({ id: "v-1", boundPremiseId: "p-2" }),
            ],
        })
        expect(validateP6(ctx)).toHaveLength(0)
    })

    it("does not report an unresolvable variable reference — that is Structural", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [
                makeVariableExpression({
                    id: "e-1",
                    premiseId: "p-1",
                    variableId: "missing",
                    enthymeme: true,
                }),
            ],
            variables: [],
        })
        expect(validateP6(ctx)).toHaveLength(0)
    })

    it("reports one violation per marked premise-bound expression", () => {
        const ctx = buildContext({
            premises: [makeFreeformPremise({ id: "p-1" })],
            expressions: [
                makeOperatorExpression("and", { id: "e-and" }),
                makeVariableExpression({
                    id: "e-1",
                    parentId: "e-and",
                    position: 0,
                    variableId: "v-1",
                    enthymeme: true,
                }),
                makeVariableExpression({
                    id: "e-2",
                    parentId: "e-and",
                    position: 1,
                    variableId: "v-2",
                    enthymeme: true,
                }),
                makeVariableExpression({
                    id: "e-3",
                    parentId: "e-and",
                    position: 2,
                    variableId: "v-3",
                    enthymeme: true,
                }),
            ],
            variables: [
                makePremiseBoundVariable({ id: "v-1", boundPremiseId: "p-2" }),
                makePremiseBoundVariable({ id: "v-2", boundPremiseId: "p-3" }),
                makeClaimBoundVariable({ id: "v-3" }),
            ],
        })
        const violations = validateP6(ctx)
        expect(violations).toHaveLength(2)
        expect(violations.map((v) => v.expressionId)).toEqual(["e-1", "e-2"])
    })
})

describe("P-6 is reported at the Presentable tier and no lower one", () => {
    const ctx = markedExpressionContext("premise")

    it("is reported by validate('presentable')", () => {
        const codes = validate("presentable", ctx).map((v) => v.code)
        expect(codes).toContain("P-6")
    })

    for (const tier of ["structural", "evaluable", "derivable"] as const) {
        it(`is not reported by validate('${tier}')`, () => {
            const codes = validate(tier, ctx).map((v) => v.code)
            expect(codes).not.toContain("P-6")
        })
    }

    it("adds nothing at any tier when the variable is claim-bound", () => {
        const clean = markedExpressionContext("claim")
        for (const tier of [
            "structural",
            "evaluable",
            "derivable",
            "presentable",
        ] as const) {
            expect(validate(tier, clean).map((v) => v.code)).not.toContain(
                "P-6"
            )
        }
    })
})
