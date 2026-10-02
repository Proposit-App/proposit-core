// A reader may reject the conclusion premise's root step. That is reported in
// its own field and moves nothing else: an operator decision is never a truth
// value, and the conclusion premise is never struck.

import { describe, it, expect } from "vitest"
import { buildArgument, and, implies, v } from "./fixtures.js"
import {
    and as andNode,
    at,
    build as buildLabelled,
    newLib,
    paren,
    v as claim,
} from "../core/response-fixtures.js"

const withoutFlag = (result: object): object => {
    const { conclusionInferenceRejected: _flag, ...rest } = result as {
        conclusionInferenceRejected?: true
    }
    return rest
}

// Conclusion `(A ∧ B) → C`, supported by `A → C`. A strike of the conclusion
// premise would show up in `struckPremiseIds` and in what propagation reaches,
// so comparing whole results catches it.
const build = () => {
    const built = buildArgument({
        conclusion: implies(and(v("A"), v("B")), v("C")),
        premises: [implies(v("A"), v("C"))],
    })
    const conclusion = built.engine.getConclusionPremise()!
    const nestedId = conclusion
        .getChildExpressions(built.conclusionRootId)
        .find((expr) => expr.type === "operator")!.id
    const variables = {
        [built.variableId("A")]: true,
        [built.variableId("B")]: true,
    }
    return { built, nestedId, variables }
}

describe("rejecting the conclusion's step", () => {
    it("sets conclusionInferenceRejected and changes no other result field", () => {
        const { built, nestedId, variables } = build()
        const accepted = {
            [built.rootIds[0]]: "accepted" as const,
            [nestedId]: "accepted" as const,
        }

        const plain = built.engine.evaluate({
            variables,
            operatorAssignments: accepted,
        })
        const rejected = built.engine.evaluate({
            variables,
            operatorAssignments: {
                ...accepted,
                [built.conclusionRootId]: "rejected",
            },
        })

        expect(rejected.ok).toBe(true)
        expect(rejected.conclusionInferenceRejected).toBe(true)
        expect(plain.conclusionInferenceRejected).toBeUndefined()
        const { assignment: plainAssignment, ...plainRest } = withoutFlag(
            plain
        ) as { assignment: { operatorAssignments: object } }
        const { assignment: rejectedAssignment, ...rejectedRest } = withoutFlag(
            rejected
        ) as { assignment: { operatorAssignments: object } }
        expect(rejectedRest).toEqual(plainRest)
        expect({
            ...rejectedAssignment,
            operatorAssignments: {},
        }).toEqual({ ...plainAssignment, operatorAssignments: {} })
    })

    it("ignores a rejection of a nested operator in the conclusion premise", () => {
        const { built, nestedId, variables } = build()

        const plain = built.engine.evaluate({
            variables,
            operatorAssignments: {},
        })
        const nestedRejected = built.engine.evaluate({
            variables,
            operatorAssignments: { [nestedId]: "rejected" },
        })

        expect(nestedRejected.conclusionInferenceRejected).toBeUndefined()
        expect(nestedRejected.struckPremiseIds).toEqual(plain.struckPremiseIds)
        expect(nestedRejected.conclusionTrue).toEqual(plain.conclusionTrue)
    })

    it("reads the operator just inside a formula at the conclusion's root as its step", () => {
        const built = buildLabelled({
            id: "a",
            version: 0,
            lib: newLib(),
            conclusion: paren(at("top", andNode(claim("A"), claim("B")))),
        })

        const result = built.engine.evaluate({
            variables: {},
            operatorAssignments: { [built.expr("top")]: "rejected" },
        })

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.conclusionInferenceRejected).toBe(true)
        expect(result.struckPremiseIds).toEqual([])
    })
})
