// Every propagated value carries where it came from: the reader, a granted
// step, or nothing at all.

import { describe, it, expect } from "vitest"
import { buildArgument, implies, v } from "./fixtures.js"

describe("variable provenance", () => {
    it("names the step that derived a value in a two-link chain", () => {
        const built = buildArgument({
            conclusion: v("R"),
            premises: [implies(v("P"), v("Q")), implies(v("Q"), v("R"))],
        })
        const p = built.variableId("P")
        const q = built.variableId("Q")
        const r = built.variableId("R")

        const result = built.engine.evaluate({
            variables: { [p]: true },
            operatorAssignments: {
                [built.rootIds[0]]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })

        const provenance = result.variableProvenance!
        expect(provenance[q].origin).toBe("derived")
        expect(provenance[q].value).toBe(true)
        expect(provenance[r].origin).toBe("derived")
        expect(provenance[r].value).toBe(true)
        expect(provenance[r].derivedBy).toEqual({
            expressionId: built.rootIds[1],
            premiseId: built.premiseIds[1],
            fromVariableIds: [q],
        })
        expect(provenance[q].derivedBy?.fromVariableIds).toEqual([p])
    })

    it("marks a reader-supplied value as asserted and an untouched one as unassigned", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: false },
            operatorAssignments: {},
        })

        const provenance = result.variableProvenance!
        expect(provenance[built.variableId("A")]).toEqual({
            value: false,
            origin: "asserted",
        })
        expect(provenance[built.variableId("C")]).toEqual({
            value: null,
            origin: "unassigned",
        })
    })

    it("treats an explicit unknown as unassigned rather than asserted", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("C")]: null,
            },
            operatorAssignments: {},
        })

        expect(result.variableProvenance![built.variableId("C")].origin).toBe(
            "unassigned"
        )
    })

    it("derives a claim over a reader's explicit unknown when the reader granted the step", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })
        const c = built.variableId("C")

        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: true, [c]: null },
            operatorAssignments: { [built.rootIds[0]]: "accepted" },
        })

        expect(result.propagatedVariableValues![c]).toBe(true)
        expect(result.variableProvenance![c].origin).toBe("derived")
    })

    it("omits provenance when diagnostics are switched off", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate(
            {
                variables: { [built.variableId("A")]: true },
                operatorAssignments: {},
            },
            { includeDiagnostics: false }
        )

        expect(result.variableProvenance).toBeUndefined()
    })
})
