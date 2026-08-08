// Evaluation emits orthogonal facts. There is no single named outcome, and
// no precedence ladder collapsing unrelated questions into one word.

import { describe, it, expect } from "vitest"
import * as libraryBarrel from "../../src/lib/index.js"
import { buildArgument, implies, or, v } from "./fixtures.js"

describe("the emitted facts", () => {
    it("exposes no grade from the library barrel", () => {
        const exported = Object.keys(libraryBarrel)
        expect(exported).not.toContain("gradeEvaluation")
        expect(exported).not.toContain("TCoreEvaluationGrade")
        expect(exported).not.toContain("TCoreEvaluationGrading")
    })

    it("reports premises holding while the conclusion does not follow", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [or(v("P"), v("R")), implies(v("P"), v("Q"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("P")]: false,
                [built.variableId("R")]: true,
                [built.variableId("Q")]: false,
            },
            operatorAssignments: {},
        })

        expect(result.struckPremiseIds).toEqual([])
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(true)
        expect(result.conclusionTrue).toBe(false)
        expect(result.premisesHoldConclusionFalse).toBe(true)
    })

    it("reports an inadmissible assignment as a fact rather than an outcome", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [v("R"), implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("R")]: false,
                [built.variableId("A")]: true,
                [built.variableId("C")]: true,
            },
            operatorAssignments: {},
        })

        expect(result.ok).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(false)
        // Inadmissibility blocks; it does not label. Every other fact is still
        // reported on its own terms.
        expect(result.conclusionTrue).toBe(true)
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.conclusionAttribution?.assertedByReader).toBe(true)
    })
})
