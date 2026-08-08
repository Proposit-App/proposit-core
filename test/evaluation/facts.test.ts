// Evaluation emits orthogonal facts. There is no single named outcome, and
// no precedence ladder collapsing unrelated questions into one word.

import { describe, it, expect } from "vitest"
import * as libraryBarrel from "../../src/lib/index.js"
import { buildArgument, implies, not, or, v } from "./fixtures.js"

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

    it("keeps the axiomatic set when the caller supplies its own forced-true set", () => {
        const built = buildArgument({
            conclusion: v("A"),
            premises: [not(v("A"))],
            claimTypes: { A: "axiomatic" },
        })

        const implicit = built.engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })
        const explicit = built.engine.evaluate(
            { variables: {}, operatorAssignments: {} },
            { forcedTrueVariableIds: new Set() }
        )

        // An axiomatic claim is true by construction, so the premise set that
        // denies it cannot hold, and the axiom is nobody's assertion.
        expect(implicit.premiseSetSatisfiable).toBe(false)
        expect(explicit.premiseSetSatisfiable).toBe(
            implicit.premiseSetSatisfiable
        )
        expect(implicit.conclusionAttribution?.assertedByReader).toBe(false)
        expect(explicit.conclusionAttribution?.assertedByReader).toBe(
            implicit.conclusionAttribution?.assertedByReader
        )
    })

    it("withholds the premises-hold reading when every supporting premise is struck", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("P"), v("Q"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("P")]: true,
                [built.variableId("Q")]: false,
            },
            operatorAssignments: { [built.rootIds[0]]: "rejected" },
        })

        expect(result.struckPremiseIds).toEqual([built.premiseIds[0]])
        expect(result.survivingSupportingPremiseCount).toBe(0)
        // Vacuously true, and documented as such.
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        // The reader withheld the whole case; it was not weighed and found
        // wanting.
        expect(result.premisesHoldConclusionFalse).toBeNull()
    })

    it("still reports a false conclusion when the argument has no supporting premises", () => {
        const built = buildArgument({ conclusion: v("Q") })

        const result = built.engine.evaluate({
            variables: { [built.variableId("Q")]: false },
            operatorAssignments: {},
        })

        expect(result.survivingSupportingPremiseCount).toBe(0)
        expect(result.premisesHoldConclusionFalse).toBe(true)
    })
})
