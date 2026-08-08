// Rejection strikes the premise it lives in. It is a decision about a step,
// never a truth value: it forces nothing true and nothing false, and the
// struck premise is reported rather than deleted.

import { describe, it, expect } from "vitest"
import { buildArgument, and, implies, or, v } from "./fixtures.js"

describe("striking a premise", () => {
    it("rejecting an implication assigns nothing to its antecedent or consequent", () => {
        const built = buildArgument({
            conclusion: v("Q"),
            premises: [implies(v("P"), v("Q"))],
        })
        const p = built.variableId("P")
        const q = built.variableId("Q")

        const result = built.engine.evaluate({
            variables: { [p]: true, [q]: null },
            operatorAssignments: { [built.rootIds[0]]: "rejected" },
        })

        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues![q]).toBeNull()
        expect(result.propagatedVariableValues![p]).toBe(true)
        expect(
            Object.values(result.propagatedVariableValues!).filter(
                (value) => value !== null
            )
        ).toEqual([true])
    })

    it("accepting a conditional whose antecedent is a conjunction assigns nothing to the conjuncts", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(and(v("A"), v("B")), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {},
            operatorAssignments: { [built.rootIds[0]]: "accepted" },
        })

        expect(result.ok).toBe(true)
        expect(
            result.propagatedVariableValues![built.variableId("A")]
        ).toBeNull()
        expect(
            result.propagatedVariableValues![built.variableId("B")]
        ).toBeNull()
    })

    it("leaves an explicitly unknown claim unknown when a premise is rejected", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C")), implies(v("B"), v("C"))],
        })
        const c = built.variableId("C")

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("B")]: true,
                [c]: null,
            },
            operatorAssignments: {
                [built.rootIds[0]]: "rejected",
                [built.rootIds[1]]: "rejected",
            },
        })

        expect(result.ok).toBe(true)
        expect(result.propagatedVariableValues![c]).toBeNull()
        expect(result.conclusionTrue).toBeNull()
    })

    it("never strikes the conclusion premise or a derivation premise", () => {
        const built = buildArgument({
            conclusion: v("C"),
            derivations: [{ derivedClaim: "C", tree: implies(v("A"), v("C")) }],
        })

        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: true },
            operatorAssignments: {
                [built.conclusionRootId]: "rejected",
                [built.rootIds[0]]: "rejected",
            },
        })

        expect(result.ok).toBe(true)
        expect(result.struckPremiseIds).toEqual([])
    })

    it("keeps a struck premise in the reported results", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [implies(v("A"), v("C"))],
        })

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("C")]: true,
            },
            operatorAssignments: { [built.rootIds[0]]: "rejected" },
        })

        expect(result.struckPremiseIds).toEqual([built.premiseIds[0]])
        expect(result.survivingSupportingPremiseCount).toBe(0)
        expect(result.supportingPremises).toHaveLength(1)
        expect(result.supportingPremises![0].premiseId).toBe(
            built.premiseIds[0]
        )
        expect(result.supportingPremises![0].rootValue).toBe(true)
    })

    it("stops a struck constraint premise from constraining the assignment", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [v("R")],
        })

        const constrained = built.engine.evaluate({
            variables: { [built.variableId("R")]: false },
            operatorAssignments: {},
        })
        expect(constrained.isAdmissibleAssignment).toBe(false)

        const struck = built.engine.evaluate({
            variables: { [built.variableId("R")]: false },
            operatorAssignments: { [built.rootIds[0]]: "rejected" },
        })
        expect(struck.struckPremiseIds).toEqual([built.premiseIds[0]])
        expect(struck.isAdmissibleAssignment).toBe(true)
    })

    it("does not propagate through an accepted operator inside a struck premise", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [and(or(v("A"), v("C")), v("R"))],
        })
        const nestedOrId = built.engine
            .getPremise(built.premiseIds[0])!
            .getExpressions()
            .find(
                (expr) => expr.type === "operator" && expr.operator === "or"
            )!.id

        // Accepting the nested `or` with A false would derive C true — but
        // the premise's root `and` is rejected, so the whole premise is
        // struck and the acceptance inside it contributes nothing.
        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: false },
            operatorAssignments: {
                [built.rootIds[0]]: "rejected",
                [nestedOrId]: "accepted",
            },
        })

        expect(result.struckPremiseIds).toEqual([built.premiseIds[0]])
        expect(
            result.propagatedVariableValues![built.variableId("C")]
        ).toBeNull()
    })
})
