// The satisfiability walk enumerates the cross product of every free variable
// it is handed, even when the premises split into groups that share no
// variables and even when a variable reaches no premise at all. These suites
// pin the reduction: same answers, fewer rows.
//
// The oracle is a verbatim copy of the flat walk rather than a list of expected
// values, so criterion 1 compares implementations instead of comparing the new
// implementation against what someone believed the old one did.

import { describe, it, expect } from "vitest"
import {
    isPremiseSetSatisfiable,
    SATISFIABILITY_VARIABLE_CEILING,
} from "../../src/lib/core/evaluation/satisfiability.js"
import { createPremiseBoundResolver } from "../../src/lib/core/evaluation/premise-resolver.js"
import type {
    TArgumentEvaluationContext,
    TEvaluablePremise,
} from "../../src/lib/core/evaluation/argument-evaluation.js"
import type {
    TCoreExpressionAssignment,
    TCoreQuadrivalentValue,
    TCoreTrivalentValue,
    TCoreVariableAssignment,
} from "../../src/lib/types/evaluation.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../../src/lib/schemata/index.js"

const ARGUMENT_ID = "arg-decomposition"

/* -------------------------------------------------------------------------- */
/* The oracle: the flat walk, copied verbatim                                  */
/* -------------------------------------------------------------------------- */

function flatWalk(
    ctx: TArgumentEvaluationContext,
    input: {
        premises: TEvaluablePremise[]
        freeVariableIds: string[]
        forcedTrueVariableIds?: ReadonlySet<string>
    }
): TCoreTrivalentValue {
    if (input.premises.length === 0) return true

    const forcedTrueVariableIds = input.forcedTrueVariableIds
    const freeVariableIds = input.freeVariableIds.filter(
        (variableId) => forcedTrueVariableIds?.has(variableId) !== true
    )
    if (freeVariableIds.length > SATISFIABILITY_VARIABLE_CEILING) return null

    const totalAssignments = 2 ** freeVariableIds.length
    let sawIndeterminateRow = false
    for (let mask = 0; mask < totalAssignments; mask++) {
        const variables: TCoreVariableAssignment = {}
        for (let index = 0; index < freeVariableIds.length; index++) {
            variables[freeVariableIds[index]] = Boolean(mask & (1 << index))
        }
        for (const variableId of forcedTrueVariableIds ?? []) {
            variables[variableId] = true
        }
        const assignment: TCoreExpressionAssignment = {
            variables,
            operatorAssignments: {},
        }
        const resolver = createPremiseBoundResolver(ctx, assignment)
        const rootValues = input.premises.map(
            (premise) =>
                premise.evaluate(assignment, { resolver }).rootValue ?? null
        )
        if (rootValues.every((value) => value === true)) return true
        if (
            !rootValues.includes(false) &&
            rootValues.some((value) => value === null)
        ) {
            sawIndeterminateRow = true
        }
    }
    return sawIndeterminateRow ? null : false
}

/* -------------------------------------------------------------------------- */
/* Fixture builders                                                            */
/* -------------------------------------------------------------------------- */

function variableExpression(
    premiseId: string,
    variableId: string,
    position: number
): TCorePropositionalExpression {
    return {
        id: `${premiseId}::${variableId}`,
        argumentId: ARGUMENT_ID,
        argumentVersion: 0,
        premiseId,
        parentId: null,
        position,
        checksum: "",
        descendantChecksum: null,
        combinedChecksum: "",
        type: "variable",
        variableId,
    }
}

function claimVariable(id: string): TCorePropositionalVariable {
    return {
        id,
        argumentId: ARGUMENT_ID,
        argumentVersion: 0,
        symbol: id,
        checksum: "",
        claimId: `claim-${id}`,
        claimVersion: 0,
    }
}

function premiseVariable(
    id: string,
    boundPremiseId: string
): TCorePropositionalVariable {
    return {
        id,
        argumentId: ARGUMENT_ID,
        argumentVersion: 0,
        symbol: id,
        checksum: "",
        boundPremiseId,
        boundArgumentId: ARGUMENT_ID,
        boundArgumentVersion: 0,
    }
}

interface TEvaluationCounter {
    count: number
}

type TRule = (
    values: Record<string, TCoreQuadrivalentValue>
) => TCoreQuadrivalentValue

/**
 * A premise double that honours the dependency contract by construction: it
 * declares `reads` through `getExpressions()` and its rule is handed exactly
 * those values and nothing else. `useResolver: false` still declares the
 * variable but reads the assignment directly — used only where calling the
 * resolver would recurse forever, which is a property of the resolver rather
 * than of the reachability closure under test.
 */
function makePremise(
    id: string,
    reads: string[],
    rule: TRule,
    options: { counter?: TEvaluationCounter; useResolver?: boolean } = {}
): TEvaluablePremise {
    const useResolver = options.useResolver !== false
    return {
        getId: () => id,
        getPremiseType: () => "constraint",
        getExpressions: () =>
            reads.map((variableId, index) =>
                variableExpression(id, variableId, index)
            ),
        getChildExpressions: () => [],
        getVariables: () => [],
        getDecidableOperatorExpressions: () => [],
        evaluate: (assignment, evaluateOptions) => {
            if (options.counter) options.counter.count++
            const values: Record<string, TCoreQuadrivalentValue> = {}
            for (const variableId of reads) {
                values[variableId] =
                    useResolver && evaluateOptions?.resolver
                        ? evaluateOptions.resolver(variableId)
                        : (assignment.variables[variableId] ?? null)
            }
            return {
                premiseId: id,
                premiseType: "constraint",
                rootValue: rule(values),
                expressionValues: {},
                variableValues: {},
            }
        },
    }
}

function makeContext(
    premises: TEvaluablePremise[],
    variables: TCorePropositionalVariable[] = []
): TArgumentEvaluationContext {
    const premiseById = new Map(premises.map((pm) => [pm.getId(), pm]))
    const variableById = new Map(variables.map((vr) => [vr.id, vr]))
    return {
        argumentId: ARGUMENT_ID,
        getConclusionPremise: () => undefined,
        listSupportingPremises: () => [],
        listPremises: () => premises,
        conclusionPremiseId: undefined,
        getVariable: (variableId) => variableById.get(variableId),
        getPremise: (premiseId) => premiseById.get(premiseId),
        validateEvaluability: () => ({ ok: true, issues: [] }),
    }
}

/** Every value true. Used where a rule needs to be plainly determinate. */
const allTrue: TRule = (values) =>
    Object.values(values).every((value) => value === true)

/* -------------------------------------------------------------------------- */

describe("the decomposed walk agrees with the flat walk", () => {
    // Criterion 1. These pass before the change as well as after — they guard
    // the reduction rather than reproduce a defect, which is the distinction
    // the plan asks this file to keep visible.

    const cases: {
        name: string
        build: () => {
            ctx: TArgumentEvaluationContext
            premises: TEvaluablePremise[]
            freeVariableIds: string[]
            forcedTrueVariableIds?: ReadonlySet<string>
        }
    }[] = [
        {
            name: "two independent satisfiable groups",
            build: () => {
                const premises = [
                    makePremise("p1", ["a", "b"], allTrue),
                    makePremise("p2", ["c", "d"], allTrue),
                ]
                return {
                    ctx: makeContext(
                        premises,
                        ["a", "b", "c", "d"].map(claimVariable)
                    ),
                    premises,
                    freeVariableIds: ["a", "b", "c", "d"],
                }
            },
        },
        {
            name: "one group contradicts itself",
            build: () => {
                const premises = [
                    makePremise("p1", ["a"], (vals) => vals.a === true),
                    makePremise("p2", ["a"], (vals) => vals.a === false),
                    makePremise("p3", ["b"], allTrue),
                ]
                return {
                    ctx: makeContext(premises, ["a", "b"].map(claimVariable)),
                    premises,
                    freeVariableIds: ["a", "b"],
                }
            },
        },
        {
            name: "one group never settles",
            build: () => {
                const premises = [
                    makePremise("p1", ["a"], allTrue),
                    makePremise("p2", ["b"], () => null),
                ]
                return {
                    ctx: makeContext(premises, ["a", "b"].map(claimVariable)),
                    premises,
                    freeVariableIds: ["a", "b"],
                }
            },
        },
        {
            name: "an unsatisfiable group beside one that never settles",
            build: () => {
                const premises = [
                    makePremise("p1", ["a"], () => false),
                    makePremise("p2", ["b"], () => null),
                ]
                return {
                    ctx: makeContext(premises, ["a", "b"].map(claimVariable)),
                    premises,
                    freeVariableIds: ["a", "b"],
                }
            },
        },
        {
            name: "a variable no premise reads",
            build: () => {
                const premises = [makePremise("p1", ["a"], allTrue)]
                return {
                    ctx: makeContext(
                        premises,
                        ["a", "spare"].map(claimVariable)
                    ),
                    premises,
                    freeVariableIds: ["a", "spare"],
                }
            },
        },
        {
            name: "a forced-true variable and one free group",
            build: () => {
                const premises = [
                    makePremise("p1", ["a"], allTrue),
                    makePremise("p2", ["forced"], allTrue),
                ]
                return {
                    ctx: makeContext(
                        premises,
                        ["a", "forced"].map(claimVariable)
                    ),
                    premises,
                    freeVariableIds: ["a", "forced"],
                    forcedTrueVariableIds: new Set(["forced"]),
                }
            },
        },
        {
            name: "no premises at all",
            build: () => ({
                ctx: makeContext([]),
                premises: [],
                freeVariableIds: ["a"],
            }),
        },
    ]

    for (const testCase of cases) {
        it(`matches the oracle: ${testCase.name}`, () => {
            const { ctx, ...input } = testCase.build()
            expect(isPremiseSetSatisfiable(ctx, input)).toBe(
                flatWalk(ctx, input)
            )
        })
    }
})

describe("premises coupled through a premise-bound variable", () => {
    // Criterion 2. `p1` and `p2` name no variable in common, so a graph built
    // from named occurrence alone puts them in separate components — and then
    // walks `p1` without `b` in the assignment, where its bound variable
    // resolves to null and it comes out satisfiable. The set is not.

    function build() {
        const premises = [
            // True exactly when its bound variable is not true. Under the flat
            // walk that means "b is not true"; in isolation, with b unset, the
            // bound variable resolves null and this reads true.
            makePremise("p1", ["a", "vp2"], (vals) => vals.vp2 !== true),
            makePremise("p2", ["b"], (vals) => vals.b === true),
        ]
        const ctx = makeContext(premises, [
            claimVariable("a"),
            claimVariable("b"),
            premiseVariable("vp2", "p2"),
        ])
        return { ctx, premises, freeVariableIds: ["a", "b"] }
    }

    it("is unsatisfiable, and the flat walk agrees", () => {
        const { ctx, ...input } = build()
        expect(flatWalk(ctx, input)).toBe(false)
        expect(isPremiseSetSatisfiable(ctx, input)).toBe(false)
    })

    it("does not report the coupled set as satisfiable", () => {
        // The specific wrong answer a closure without the boundPremiseId
        // recursion produces.
        const { ctx, ...input } = build()
        expect(isPremiseSetSatisfiable(ctx, input)).not.toBe(true)
    })

    it("terminates on a premise-binding cycle", () => {
        // p1 declares a variable bound to p2 and vice versa. The closure walks
        // declared structure, so it meets the cycle; evaluation here reads the
        // assignment directly because the resolver itself recurses forever on
        // one.
        const premises = [
            makePremise("p1", ["a", "vp2"], (vals) => vals.a === true, {
                useResolver: false,
            }),
            makePremise("p2", ["b", "vp1"], (vals) => vals.b === true, {
                useResolver: false,
            }),
        ]
        const ctx = makeContext(premises, [
            claimVariable("a"),
            claimVariable("b"),
            premiseVariable("vp1", "p1"),
            premiseVariable("vp2", "p2"),
        ])

        expect(
            isPremiseSetSatisfiable(ctx, {
                premises,
                freeVariableIds: ["a", "b"],
            })
        ).toBe(true)
    })
})

describe("the size of the walk", () => {
    // Criteria 3 and 4. One premise per component: a row evaluates every
    // premise in its component, so with several premises per component an
    // evaluation count is not a row count.

    function twoGroupsOfThree(counter: TEvaluationCounter) {
        const left = ["a1", "a2", "a3"]
        const right = ["b1", "b2", "b3"]
        const premises = [
            makePremise("pLeft", left, allTrue, { counter }),
            makePremise("pRight", right, allTrue, { counter }),
        ]
        return {
            ctx: makeContext(premises, [...left, ...right].map(claimVariable)),
            premises,
            freeVariableIds: [...left, ...right],
        }
    }

    it("walks each group separately rather than their cross product", () => {
        const flatCounter: TEvaluationCounter = { count: 0 }
        const flatInput = twoGroupsOfThree(flatCounter)
        const { ctx: flatCtx, ...flatRest } = flatInput
        expect(flatWalk(flatCtx, flatRest)).toBe(true)
        // 2^6 rows, both premises on each: the satisfying row is the last.
        expect(flatCounter.count).toBe(128)

        const counter: TEvaluationCounter = { count: 0 }
        const { ctx, ...input } = twoGroupsOfThree(counter)
        expect(isPremiseSetSatisfiable(ctx, input)).toBe(true)
        expect(counter.count).toBeLessThanOrEqual(2 * 2 ** 3)
    })

    it("gives no column to a variable no premise reads", () => {
        // The premise set has to be unsatisfiable for this to measure
        // anything. With a satisfiable one the walk returns on its first
        // satisfying row, which arrives at the same mask either way — so the
        // spare column costs nothing observable and the test passes without
        // the reduction, proving only that the early return works.
        function contradiction(counter: TEvaluationCounter) {
            return [
                makePremise("pYes", ["a"], (vals) => vals.a === true, {
                    counter,
                }),
                makePremise("pNo", ["a"], (vals) => vals.a === false, {
                    counter,
                }),
            ]
        }

        const withoutSpare: TEvaluationCounter = { count: 0 }
        const bare = contradiction(withoutSpare)
        expect(
            isPremiseSetSatisfiable(makeContext(bare, [claimVariable("a")]), {
                premises: bare,
                freeVariableIds: ["a"],
            })
        ).toBe(false)

        const withSpare: TEvaluationCounter = { count: 0 }
        const same = contradiction(withSpare)
        expect(
            isPremiseSetSatisfiable(
                makeContext(same, ["a", "spare"].map(claimVariable)),
                { premises: same, freeVariableIds: ["a", "spare"] }
            )
        ).toBe(false)

        expect(withSpare.count).toBe(withoutSpare.count)
    })
})

describe("the ceiling applies to the largest group", () => {
    // Criteria 5 and 6.

    function group(prefix: string, size: number): string[] {
        return Array.from({ length: size }, (_, index) => `${prefix}${index}`)
    }

    it("answers an argument whose total exceeds the ceiling but whose groups do not", () => {
        const left = group("l", 9)
        const right = group("r", 9)
        expect(left.length + right.length).toBeGreaterThan(
            SATISFIABILITY_VARIABLE_CEILING
        )
        const premises = [
            makePremise("pLeft", left, allTrue),
            makePremise("pRight", right, allTrue),
        ]
        const ctx = makeContext(
            premises,
            [...left, ...right].map(claimVariable)
        )
        const input = { premises, freeVariableIds: [...left, ...right] }

        // Every premise here settles to true or false under every assignment,
        // so "not null" is not the claim — the answer is outright true.
        expect(flatWalk(ctx, input)).toBeNull()
        expect(isPremiseSetSatisfiable(ctx, input)).toBe(true)
    })

    it("still declines when one group alone exceeds the ceiling", () => {
        const big = group("x", SATISFIABILITY_VARIABLE_CEILING + 1)
        const premises = [
            makePremise("pBig", big, allTrue),
            makePremise("pSmall", ["s"], allTrue),
        ]
        const ctx = makeContext(premises, [...big, "s"].map(claimVariable))

        expect(
            isPremiseSetSatisfiable(ctx, {
                premises,
                freeVariableIds: [...big, "s"],
            })
        ).toBeNull()
    })

    it("reports unsatisfiable when another group settles it, ceiling or not", () => {
        const big = group("x", SATISFIABILITY_VARIABLE_CEILING + 1)
        const premises = [
            makePremise("pBig", big, allTrue),
            makePremise("pContradiction", ["s"], (vals) => vals.s === true),
            makePremise("pOpposite", ["s"], (vals) => vals.s === false),
        ]
        const ctx = makeContext(premises, [...big, "s"].map(claimVariable))

        expect(
            isPremiseSetSatisfiable(ctx, {
                premises,
                freeVariableIds: [...big, "s"],
            })
        ).toBe(false)
    })
})

describe("forced-true variables reach every group", () => {
    // Criterion 7. `pForced` reaches no free variable at all, so it forms its
    // own group with no columns — and that group's single row still has to
    // carry the forced assignment or the premise reads null and the group
    // comes back false.

    it("keeps a group that reads only a forced variable satisfiable", () => {
        const premises = [
            makePremise("pFree", ["a"], allTrue),
            makePremise("pForced", ["forced"], allTrue),
        ]
        const ctx = makeContext(premises, ["a", "forced"].map(claimVariable))
        const input = {
            premises,
            freeVariableIds: ["a", "forced"],
            forcedTrueVariableIds: new Set(["forced"]),
        }

        expect(flatWalk(ctx, input)).toBe(true)
        expect(isPremiseSetSatisfiable(ctx, input)).toBe(true)
    })
})
