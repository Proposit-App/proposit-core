// Satisfiability is asked of the surviving premise set alone, ignoring the
// reader's own assignment. While the premises contradict each other, nothing
// is derived through them.

import { describe, it, expect, vi } from "vitest"
import * as satisfiabilityModule from "../../src/lib/core/evaluation/satisfiability.js"
import { isPremiseSetSatisfiable } from "../../src/lib/core/evaluation/satisfiability.js"
import type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "../../src/lib/core/evaluation/argument-evaluation.js"
import { buildArgument, and, implies, not, v } from "./fixtures.js"

describe("premise-set satisfiability", () => {
    it("derives nothing while the surviving premise set is unsatisfiable", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [v("A"), v("B"), not(and(v("A"), v("B")))],
        })

        const result = built.engine.evaluate({
            variables: { [built.variableId("A")]: true },
            operatorAssignments: {},
        })

        expect(result.premiseSetSatisfiable).toBe(false)
        expect(
            Object.values(result.variableProvenance!).every(
                (entry) => entry.origin !== "derived"
            )
        ).toBe(true)
    })

    it("restores derivation when the contradicting restriction is struck", () => {
        const built = buildArgument({
            conclusion: v("C"),
            premises: [
                v("A"),
                v("B"),
                not(and(v("A"), v("B"))),
                implies(v("A"), v("C")),
            ],
        })
        const c = built.variableId("C")

        const contradicted = built.engine.evaluate({
            variables: { [built.variableId("A")]: true },
            operatorAssignments: { [built.rootIds[3]]: "accepted" },
        })
        expect(contradicted.premiseSetSatisfiable).toBe(false)
        expect(contradicted.propagatedVariableValues![c]).toBeNull()

        const struck = built.engine.evaluate({
            variables: { [built.variableId("A")]: true },
            operatorAssignments: {
                [built.rootIds[2]]: "rejected",
                [built.rootIds[3]]: "accepted",
            },
        })
        expect(struck.struckPremiseIds).toEqual([built.premiseIds[2]])
        expect(struck.premiseSetSatisfiable).toBe(true)
        expect(struck.propagatedVariableValues![c]).toBe(true)
        expect(struck.variableProvenance![c].origin).toBe("derived")
    })

    it("reports satisfiability as undetermined beyond the variable ceiling", () => {
        const names = "ABCDEFGHIJKLMNOPQ".split("")
        expect(names).toHaveLength(17)
        const built = buildArgument({
            conclusion: v("Z"),
            premises: [and(...names.map((name) => v(name)))],
        })

        const result = built.engine.evaluate({
            variables: {},
            operatorAssignments: {},
        })

        expect(result.premiseSetSatisfiable).toBeNull()
    })

    it("checks validity of a ten-variable argument without recomputing satisfiability per row", () => {
        const names = "ABCDEFGHIJ".split("")
        const built = buildArgument({
            conclusion: v("A"),
            premises: [and(...names.map((name) => v(name)))],
        })

        const spy = vi.spyOn(satisfiabilityModule, "isPremiseSetSatisfiable")
        try {
            const validity = built.engine.checkValidity({ mode: "exhaustive" })
            expect(validity.ok).toBe(true)
            expect(validity.checkedVariableIds).toHaveLength(10)
            expect(validity.numAssignmentsChecked).toBe(1024)
            expect(spy).toHaveBeenCalledTimes(1)
        } finally {
            spy.mockRestore()
        }
    })

    it("reports not-determined rather than unsatisfiable when no row could be evaluated", () => {
        // A premise that never resolves to anything: no assignment settles it,
        // so the search establishes nothing — including its unsatisfiability.
        const indeterminate: TEvaluablePremise = {
            getId: () => "p-indeterminate",
            getExpressions: () => [],
            getChildExpressions: () => [],
            getVariables: () => [],
            getDecidableOperatorExpressions: () => [],
            evaluate: () => ({
                premiseId: "p-indeterminate",
                premiseType: "constraint",
                rootValue: null,
                expressionValues: {},
                variableValues: {},
            }),
        }
        const ctx = {
            argumentId: "arg-1",
            getConclusionPremise: () => undefined,
            listSupportingPremises: () => [],
            listPremises: () => [indeterminate],
            conclusionPremiseId: undefined,
            getVariable: () => undefined,
            getPremise: () => undefined,
            validateEvaluability: () => ({ ok: true, issues: [] }),
        } satisfies TArgumentEvaluationContext

        expect(
            isPremiseSetSatisfiable(ctx, {
                premises: [indeterminate],
                freeVariableIds: ["v1"],
            })
        ).toBeNull()
    })
})
