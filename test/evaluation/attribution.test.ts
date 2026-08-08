// Where a value came from is answered by intervention: withhold the reader's
// own assertion, recompute closure from what is left, and ask again.

import { describe, it, expect } from "vitest"
import { buildArgument, implies, v } from "./fixtures.js"

describe("conclusion attribution", () => {
    it("reports a conclusion the reader supplied as not reached by the argument", () => {
        // Both claims true, and the reader granted no step. The conclusion is
        // true only because they said so.
        const built = buildArgument({
            conclusion: v("W"),
            premises: [implies(v("M"), v("W"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("M")]: true,
                [built.variableId("W")]: true,
            },
            operatorAssignments: {},
        })

        expect(result.conclusionTrue).toBe(true)
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.conclusionAttribution).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: false,
        })
        expect(result.struckPremiseIds).toEqual([])
    })

    it("credits the argument once the reader grants the step that carries it", () => {
        const built = buildArgument({
            conclusion: v("W"),
            premises: [implies(v("M"), v("W"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("M")]: true,
                [built.variableId("W")]: true,
            },
            operatorAssignments: { [built.rootIds[0]]: "accepted" },
        })

        expect(result.conclusionAttribution).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: true,
        })
    })

    it("reports the conclusion reached when a granted premise supports it and another is struck", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), implies(v("B"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("B")]: true,
            },
            operatorAssignments: {
                [built.rootIds[0]]: "rejected",
                [built.rootIds[1]]: "accepted",
            },
        })

        expect(result.conclusionTrue).toBe(true)
        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(true)
        expect(result.struckPremiseIds).toEqual([built.premiseIds[0]])
        expect(result.survivingSupportingPremisesTrue).toBe(true)
    })

    it("reports nothing reached when every supporting premise is struck", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), implies(v("B"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("B")]: true,
                [built.variableId("C")]: true,
            },
            operatorAssignments: {
                [built.rootIds[0]]: "rejected",
                [built.rootIds[1]]: "rejected",
            },
        })

        expect([...result.struckPremiseIds!].sort()).toEqual(
            [...built.premiseIds].sort()
        )
        expect(result.survivingSupportingPremiseCount).toBe(0)
        // The empty conjunction is vacuously true; it must not compose into a
        // positive reading, which is why attribution is the gate.
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(
            false
        )
    })

    it("does not treat mutually supporting premises as an independent derivation", () => {
        const built = buildArgument({
            conclusion: v("A"),
            premises: [implies(v("A"), v("B")), implies(v("B"), v("A"))],
        })
        const a = built.variableId("A")

        const result = built.engine.evaluate({
            variables: { [a]: true },
            operatorAssignments: {
                [built.rootIds[0]]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })

        expect(result.conclusionAttribution?.reachedWithoutAssertion).toBe(
            false
        )
        expect(result.claimAttribution![a]).toEqual({
            assertedByReader: true,
            reachedWithoutAssertion: false,
        })
    })

    it("reports an intermediate claim that the argument re-derives on its own", () => {
        const built = buildArgument({
            conclusion: v("R"),
            premises: [implies(v("P"), v("Q")), implies(v("Q"), v("R"))],
        })
        const p = built.variableId("P")
        const q = built.variableId("Q")

        const result = built.engine.evaluate({
            variables: { [p]: true, [q]: true },
            operatorAssignments: {
                [built.rootIds[0]]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })

        expect(result.claimAttribution![q].reachedWithoutAssertion).toBe(true)
        expect(result.claimAttribution![p].reachedWithoutAssertion).toBe(false)
    })

    it("omits per-claim attribution when no step was granted", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: true },
            operatorAssignments: {},
        })

        expect(result.claimAttribution).toBeUndefined()
    })
})
