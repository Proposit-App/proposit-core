import { describe, expect, it } from "vitest"
import {
    CONTESTED,
    isContested,
    type TCoreExpressionAssignment,
    type TCoreResolvedAssignment,
} from "../../src/lib/types/evaluation.js"

describe("the contested value", () => {
    it("cannot be supplied as a reader assignment", () => {
        const assignment: TCoreExpressionAssignment = {
            // @ts-expect-error a reader assigns true, false or null only
            variables: { v1: CONTESTED },
            operatorAssignments: {},
        }
        // The runtime object is still inspectable; the restriction is the type.
        expect(assignment.variables.v1).toBe(CONTESTED)
    })

    it("is carried by the assignment evaluation resolves", () => {
        const resolved: TCoreResolvedAssignment = {
            variables: { v1: CONTESTED, v2: true, v3: null },
            operatorAssignments: {},
        }
        expect(isContested(resolved.variables.v1)).toBe(true)
        expect(isContested(resolved.variables.v2)).toBe(false)
        expect(isContested(resolved.variables.v3)).toBe(false)
        expect(isContested(undefined)).toBe(false)
    })

    it("accepts a reader assignment wherever a resolved one is expected", () => {
        const fromReader: TCoreExpressionAssignment = {
            variables: { v1: true },
            operatorAssignments: {},
        }
        const widened: TCoreResolvedAssignment = fromReader
        expect(widened.variables.v1).toBe(true)
    })
})
