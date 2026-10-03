// `strictUnknownAssignmentKeys` rejects a key no evaluated premise references.
// A key is known when any premise of the argument names it, not only the
// premise being evaluated.

import { describe, it, expect } from "vitest"
import { buildArgument, implies, v } from "./fixtures.js"

describe("strict unknown assignment keys", () => {
    it("accepts values for variables named in different premises", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("P"), v("Q")), v("P")],
        })

        const result = built.engine.evaluate(
            {
                variables: {
                    [built.variableId("P")]: true,
                    [built.variableId("Q")]: true,
                },
                operatorAssignments: {},
            },
            { strictUnknownAssignmentKeys: true }
        )

        expect(result.ok).toBe(true)
    })

    it("rejects a key no premise names, and names it", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("P"), v("Q"))],
        })

        const result = built.engine.evaluate(
            {
                variables: { [built.variableId("P")]: true, ghost: true },
                operatorAssignments: {},
            },
            { strictUnknownAssignmentKeys: true }
        )

        expect(result.ok).toBe(false)
        if (result.ok) return
        expect(result.validation?.issues).toEqual([
            expect.objectContaining({
                code: "ASSIGNMENT_UNKNOWN_VARIABLE",
                message: expect.stringContaining("ghost") as string,
            }),
        ])
    })

    it("still accepts the unknown key when strict mode is off", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("P"), v("Q"))],
        })

        const result = built.engine.evaluate({
            variables: { [built.variableId("P")]: true, ghost: true },
            operatorAssignments: {},
        })

        expect(result.ok).toBe(true)
    })
})
