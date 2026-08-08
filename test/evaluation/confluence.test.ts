import { describe, expect, it } from "vitest"
import {
    propagateOperatorConstraints,
    type TArgumentEvaluationContext,
    type TEvaluablePremise,
} from "../../src/lib/core/evaluation/argument-evaluation.js"
import {
    CONTESTED,
    type TCoreArgumentEvaluationResult,
} from "../../src/lib/types/evaluation.js"
import { buildArgument, and, implies, not, or, v } from "./fixtures.js"

/**
 * Conclusion `X`, supporting `A → X` and `X → F`; the reader asserts
 * `A = true` and `F = false` and grants both steps. Forward modus ponens
 * drives `X` true and the contrapositive drives it false, so the two granted
 * steps disagree about every variable on the chain.
 *
 * Premise IDs are random UUIDs and the engine visits premises in sorted ID
 * order, so building the same argument repeatedly permutes the order the
 * closure sees the two steps in.
 */
function evaluateConflictingChain(): TCoreArgumentEvaluationResult {
    const built = buildArgument({
        conclusion: v("X"),
        premises: [implies(v("A"), v("X")), implies(v("X"), v("F"))],
    })
    const { engine, rootIds, variableId } = built
    return engine.evaluate({
        variables: {
            [variableId("A")]: true,
            [variableId("F")]: false,
            [variableId("X")]: null,
        },
        operatorAssignments: {
            [rootIds[0]]: "accepted",
            [rootIds[1]]: "accepted",
        },
    })
}

/** Provenance keyed by claim name, so runs with different IDs compare. */
function provenanceByClaim(
    result: TCoreArgumentEvaluationResult,
    variableId: (name: string) => string
): Record<string, unknown> {
    const named: Record<string, unknown> = {}
    for (const name of ["A", "X", "F"]) {
        const entry = result.variableProvenance?.[variableId(name)]
        named[name] = {
            value: entry?.value,
            origin: entry?.origin,
            contestedStepCount: entry?.contestedBy?.length,
        }
    }
    return named
}

describe("closure confluence", () => {
    it("reports a conflicting chain as contested on every run", () => {
        const outcomes = new Set<unknown>()
        for (let run = 0; run < 300; run++) {
            outcomes.add(evaluateConflictingChain().conclusionTrue)
        }
        expect([...outcomes]).toEqual([CONTESTED])
    })

    it("reaches the same provenance whatever order the premises sort in", () => {
        const shapes = new Set<string>()
        for (let run = 0; run < 300; run++) {
            const built = buildArgument({
                conclusion: v("X"),
                premises: [implies(v("A"), v("X")), implies(v("X"), v("F"))],
            })
            const result = built.engine.evaluate({
                variables: {
                    [built.variableId("A")]: true,
                    [built.variableId("F")]: false,
                    [built.variableId("X")]: null,
                },
                operatorAssignments: {
                    [built.rootIds[0]]: "accepted",
                    [built.rootIds[1]]: "accepted",
                },
            })
            shapes.add(
                JSON.stringify(provenanceByClaim(result, built.variableId))
            )
        }
        expect(shapes.size).toBe(1)
        expect(JSON.parse([...shapes][0])).toEqual({
            // A and F each carry one granted step disagreeing with the
            // reader's own assertion; X is pulled both ways by two steps.
            A: {
                value: CONTESTED,
                origin: "contested",
                contestedStepCount: 1,
            },
            X: {
                value: CONTESTED,
                origin: "contested",
                contestedStepCount: 2,
            },
            F: {
                value: CONTESTED,
                origin: "contested",
                contestedStepCount: 1,
            },
        })
    })

    it("gives the same answer when the premises are added in reverse", () => {
        const forward = buildArgument({
            conclusion: v("X"),
            premises: [implies(v("A"), v("X")), implies(v("X"), v("F"))],
        })
        const reverse = buildArgument({
            conclusion: v("X"),
            premises: [implies(v("X"), v("F")), implies(v("A"), v("X"))],
        })
        const evaluate = (
            built: typeof forward
        ): TCoreArgumentEvaluationResult =>
            built.engine.evaluate({
                variables: {
                    [built.variableId("A")]: true,
                    [built.variableId("F")]: false,
                    [built.variableId("X")]: null,
                },
                operatorAssignments: Object.fromEntries(
                    built.rootIds.map((id) => [id, "accepted" as const])
                ),
            })

        const forwardResult = evaluate(forward)
        const reverseResult = evaluate(reverse)
        expect(forwardResult.conclusionTrue).toBe(CONTESTED)
        expect(provenanceByClaim(reverseResult, reverse.variableId)).toEqual(
            provenanceByClaim(forwardResult, forward.variableId)
        )
    })

    it("names both disagreeing steps on a contested variable", () => {
        const built = buildArgument({
            conclusion: v("X"),
            premises: [implies(v("A"), v("X")), implies(v("X"), v("F"))],
        })
        const result = built.engine.evaluate({
            variables: {
                [built.variableId("A")]: true,
                [built.variableId("F")]: false,
                [built.variableId("X")]: null,
            },
            operatorAssignments: {
                [built.rootIds[0]]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })
        const provenance = result.variableProvenance![built.variableId("X")]
        expect(provenance.origin).toBe("contested")
        expect(provenance.derivedBy).toBeUndefined()
        expect(
            provenance.contestedBy?.map((step) => step.expressionId).sort()
        ).toEqual([...built.rootIds].sort())
    })

    it("contests a reader assertion a granted step contradicts", () => {
        const negation = buildArgument({
            conclusion: not(v("A")),
        })
        const result = negation.engine.evaluate({
            variables: { [negation.variableId("A")]: true },
            operatorAssignments: {
                [negation.conclusionRootId]: "accepted",
            },
        })
        const provenance = result.variableProvenance![negation.variableId("A")]
        expect(provenance.value).toBe(CONTESTED)
        expect(provenance.origin).toBe("contested")
        expect(provenance.contestedBy?.[0].expressionId).toBe(
            negation.conclusionRootId
        )
    })

    it("reports contested variables even when every aggregate reads clean", () => {
        // The forward rule carries only the told-true component, so a
        // contested antecedent yields an uncontested `true` downstream. Here
        // the disjunction's other arm is true, so nothing the reader can read
        // off the aggregates records that P is pulled both ways.
        const built = buildArgument({
            conclusion: v("Y"),
            premises: [
                or(and(v("P"), v("Q")), v("R")),
                implies(v("P"), v("Y")),
            ],
        })
        const innerAnd = built.engine
            .getPremise(built.premiseIds[0])!
            .getExpressions()
            .find(
                (expr) => expr.type === "operator" && expr.operator === "and"
            )!

        const result = built.engine.evaluate({
            variables: {
                [built.variableId("P")]: false,
                [built.variableId("R")]: true,
            },
            operatorAssignments: {
                [innerAnd.id]: "accepted",
                [built.rootIds[1]]: "accepted",
            },
        })

        // Every aggregate reads clean...
        expect(result.conclusionTrue).toBe(true)
        expect(result.isAdmissibleAssignment).toBe(true)
        expect(result.survivingSupportingPremisesTrue).toBe(true)
        expect(result.premisesHoldConclusionFalse).toBe(false)
        expect(result.premiseSetSatisfiable).toBe(true)
        expect(result.struckPremiseIds).toEqual([])
        // ...and the conflict is still reported.
        expect(result.contestedVariableIds).toEqual([built.variableId("P")])
        expect(result.variableProvenance![built.variableId("P")].origin).toBe(
            "contested"
        )
    })

    it("reports no contested variables when nothing conflicts", () => {
        const built = buildArgument({
            conclusion: v("Y"),
            premises: [implies(v("P"), v("Y"))],
        })
        const result = built.engine.evaluate({
            variables: { [built.variableId("P")]: true },
            operatorAssignments: { [built.rootIds[0]]: "accepted" },
        })
        expect(result.contestedVariableIds).toEqual([])
    })

    it("closes over an operator with too few children without throwing", () => {
        // The exported closure can be handed a tree that never passed
        // `validateEvaluability()`.
        const built = buildArgument({
            conclusion: v("Z"),
            premises: [or(v("A"), not(v("B")))],
        })
        const premise = built.engine.getPremise(built.premiseIds[0])!
        const negation = premise
            .getExpressions()
            .find(
                (expr) => expr.type === "operator" && expr.operator === "not"
            )!
        const orphan = premise.getChildExpressions(negation.id)[0]
        premise.removeExpression(orphan.id, true)

        const ctx: TArgumentEvaluationContext = {
            argumentId: built.engine.getArgument().id,
            conclusionPremiseId:
                built.engine.getRoleState().conclusionPremiseId,
            getConclusionPremise: () =>
                built.engine.getConclusionPremise() as
                    | TEvaluablePremise
                    | undefined,
            listSupportingPremises: () =>
                built.engine.listSupportingPremises() as TEvaluablePremise[],
            listPremises: () =>
                built.engine.listPremises() as TEvaluablePremise[],
            getVariable: (id) => built.engine.getVariable(id),
            getPremise: (id) =>
                built.engine.getPremise(id) as TEvaluablePremise | undefined,
            validateEvaluability: () => built.engine.validateEvaluability(),
        }

        expect(() =>
            propagateOperatorConstraints(ctx, {
                variables: { [built.variableId("A")]: false },
                operatorAssignments: { [built.rootIds[0]]: "accepted" },
            })
        ).not.toThrow()
    })
})
