// When a premise set is satisfiable the search can hand back one assignment
// that satisfies it. These suites check the witness against the premises
// themselves: applied as an assignment, it must make every premise true.

import { describe, it, expect } from "vitest"
import {
    findSatisfyingAssignment,
    SATISFIABILITY_VARIABLE_CEILING,
} from "../../src/lib/core/evaluation/satisfiability.js"
import type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "../../src/lib/core/evaluation/argument-evaluation.js"
import {
    buildArgument,
    and,
    not,
    or,
    v,
    type TBuiltArgument,
    type TNode,
} from "./fixtures.js"

interface TSearchFixture {
    built: TBuiltArgument
    ctx: TArgumentEvaluationContext
    premises: TEvaluablePremise[]
    freeVariableIds: string[]
}

/**
 * Build an argument whose non-conclusion premises are the set under test, and
 * an evaluation context over it. The conclusion is a variable no premise
 * reads, so it never joins a group.
 */
function buildSearch(
    premiseTrees: TNode[],
    freeNames: string[]
): TSearchFixture {
    const built = buildArgument({ conclusion: v("Z"), premises: premiseTrees })
    const engine = built.engine
    const premises = built.premiseIds.map(
        (id) => engine.getPremise(id) as unknown as TEvaluablePremise
    )
    const ctx: TArgumentEvaluationContext = {
        argumentId: engine.getArgument().id,
        conclusionPremiseId: built.conclusionPremiseId,
        getConclusionPremise: () => undefined,
        listSupportingPremises: () => [],
        listPremises: () => premises,
        getVariable: (id) => engine.getVariable(id),
        getPremise: (id) =>
            engine.getPremise(id) as unknown as TEvaluablePremise | undefined,
        validateEvaluability: () => ({ ok: true, issues: [] }),
    }
    return {
        built,
        ctx,
        premises,
        freeVariableIds: freeNames.map((name) => built.variableId(name)),
    }
}

function expectEveryPremiseTrue(
    premises: TEvaluablePremise[],
    witness: Record<string, boolean>
): void {
    for (const premise of premises) {
        const result = premise.evaluate({
            variables: witness,
            operatorAssignments: {},
        })
        expect(result.rootValue).toBe(true)
    }
}

describe("findSatisfyingAssignment", () => {
    it("returns a witness that satisfies a set forming one group", () => {
        const search = buildSearch(
            [or(v("A"), v("B")), not(v("A"))],
            ["A", "B"]
        )

        const result = findSatisfyingAssignment(search.ctx, {
            premises: search.premises,
            freeVariableIds: search.freeVariableIds,
        })

        expect(result.satisfiable).toBe(true)
        if (result.satisfiable !== true) return
        expect(result.assignment).toEqual({
            [search.built.variableId("A")]: false,
            [search.built.variableId("B")]: true,
        })
        expectEveryPremiseTrue(search.premises, result.assignment)
    })

    it("merges a satisfying row from each of two independent groups", () => {
        const search = buildSearch(
            [or(v("A"), v("B")), not(v("A")), and(v("C"), not(v("D")))],
            ["A", "B", "C", "D"]
        )

        const result = findSatisfyingAssignment(search.ctx, {
            premises: search.premises,
            freeVariableIds: search.freeVariableIds,
        })

        expect(result.satisfiable).toBe(true)
        if (result.satisfiable !== true) return
        for (const name of ["A", "B", "C", "D"]) {
            expect(result.assignment).toHaveProperty(
                search.built.variableId(name)
            )
        }
        expectEveryPremiseTrue(search.premises, result.assignment)
    })

    it("sets forced-true variables true in the witness", () => {
        const search = buildSearch(
            [or(not(v("A")), v("B")), v("F")],
            ["A", "B", "F"]
        )
        const forced = search.built.variableId("A")

        const result = findSatisfyingAssignment(search.ctx, {
            premises: search.premises,
            freeVariableIds: search.freeVariableIds,
            forcedTrueVariableIds: new Set([forced]),
        })

        expect(result.satisfiable).toBe(true)
        if (result.satisfiable !== true) return
        expect(result.assignment[forced]).toBe(true)
        expect(result.assignment[search.built.variableId("B")]).toBe(true)
        expectEveryPremiseTrue(search.premises, result.assignment)
    })

    it("reports an unsatisfiable set as unsatisfiable, with no witness", () => {
        const search = buildSearch([v("A"), not(v("A"))], ["A"])

        const result = findSatisfyingAssignment(search.ctx, {
            premises: search.premises,
            freeVariableIds: search.freeVariableIds,
        })

        expect(result).toEqual({ satisfiable: false })
    })

    it("reports a group over the ceiling as undetermined", () => {
        const names = Array.from(
            { length: SATISFIABILITY_VARIABLE_CEILING + 1 },
            (_, index) => `X${index}`
        )
        const search = buildSearch(
            [and(...names.map((name) => v(name)))],
            names
        )

        const result = findSatisfyingAssignment(search.ctx, {
            premises: search.premises,
            freeVariableIds: search.freeVariableIds,
        })

        expect(result).toEqual({ satisfiable: null })
    })
})
