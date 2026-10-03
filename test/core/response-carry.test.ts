import { describe, expect, it } from "vitest"
import {
    createTargetExpander,
    evaluateCombinedNode,
    type TCombinedNode,
} from "../../src/lib/core/response/combined-premise-set"
import {
    decomposeStatement,
    mergeCarriedInput,
    type TStatementDecomposition,
} from "../../src/lib/core/response/carry"
import type { TLinkAnswer } from "../../src/lib/types/response"
import type { TCoreVariableAssignment } from "../../src/lib/types/evaluation"
import type { TCoreClaimType } from "../../src/lib/schemata"
import {
    and,
    at,
    build,
    iff,
    implies,
    labelled,
    newLib,
    not,
    or,
    paren,
    pv,
    s,
    v,
    x,
    xor,
    type TNode,
    type TPremiseSpec,
} from "./response-fixtures"

const claim = (name: string): string => `claim:claim-${name}`

/** Every column key a formula reads, once each. */
function columnsOf(node: TCombinedNode): string[] {
    const keys = new Set<string>()
    const visit = (current: TCombinedNode): void => {
        if (current.kind === "column") keys.add(current.key)
        else current.kids.forEach(visit)
    }
    visit(node)
    return [...keys].sort()
}

/** Every row over `keys`, as column values. */
function rowsOver(keys: readonly string[]): Record<string, boolean>[] {
    const rows: Record<string, boolean>[] = []
    for (let mask = 0; mask < 2 ** keys.length; mask++) {
        const row: Record<string, boolean> = {}
        keys.forEach((key, index) => {
            row[key] = (mask & (1 << index)) !== 0
        })
        rows.push(row)
    }
    return rows
}

/**
 * Checks that a cube means exactly what the link says: with its fixed values
 * in place, the formula has the link's value on every row of the remaining
 * columns. For a `notExpressible` answer, checks that two rows giving the
 * formula the link's value differ in a column, so no fixed value could stand
 * for it.
 */
function expectOneMeaning(
    node: TCombinedNode,
    value: boolean,
    answer: TStatementDecomposition
): void {
    const keys = columnsOf(node)
    if (answer.kind === "cube") {
        const free = keys.filter((key) => !answer.fixed.has(key))
        for (const row of rowsOver(free)) {
            const full = { ...row, ...Object.fromEntries(answer.fixed) }
            expect(evaluateCombinedNode(node, (key) => full[key])).toBe(value)
        }
        return
    }
    if (answer.kind === "notExpressible") {
        const kept = rowsOver(keys).filter(
            (row) => evaluateCombinedNode(node, (key) => row[key]) === value
        )
        const varying = keys.filter(
            (key) => new Set(kept.map((row) => row[key])).size > 1
        )
        expect(kept.length).toBeGreaterThan(1)
        expect(varying.length).toBeGreaterThan(0)
        // No column that every kept row agrees on can carry the link alone.
        const agreed = keys.filter((key) => !varying.includes(key))
        expect(kept.length).toBeLessThan(2 ** (keys.length - agreed.length))
    }
}

function setUp(premises: TNode[]) {
    const lib = newLib()
    const t = build({
        id: "x",
        version: 3,
        lib,
        premises: premises.map((tree, index) =>
            labelled(`p${index}`, at(`e${index}`, tree))
        ),
    })
    const expander = createTargetExpander(t.engine.snapshot())
    return {
        decompose: (index: number, value: boolean) => {
            const answer = decomposeStatement(
                expander,
                t.expr(`e${index}`),
                value
            )
            expectOneMeaning(
                expander.expand(t.expr(`e${index}`)),
                value,
                answer
            )
            return answer
        },
    }
}

const fixedOf = (answer: TStatementDecomposition): Record<string, boolean> => {
    expect(answer.kind).toBe("cube")
    return answer.kind === "cube" ? Object.fromEntries(answer.fixed) : {}
}

describe("decomposing a statement into fixed column values", () => {
    it("affirming a conjunction fixes both conjuncts true", () => {
        const { decompose } = setUp([and(v("Q"), v("R"))])
        expect(fixedOf(decompose(0, true))).toEqual({
            [claim("Q")]: true,
            [claim("R")]: true,
        })
    })

    it("contradicting a disjunction fixes both disjuncts false", () => {
        const { decompose } = setUp([or(v("Q"), v("R"))])
        expect(fixedOf(decompose(0, false))).toEqual({
            [claim("Q")]: false,
            [claim("R")]: false,
        })
    })

    it("contradicting a conditional fixes the antecedent true and the consequent false", () => {
        const { decompose } = setUp([implies(v("P"), v("Q"))])
        expect(fixedOf(decompose(0, false))).toEqual({
            [claim("P")]: true,
            [claim("Q")]: false,
        })
    })

    it("a single claim is fixed to the link's value", () => {
        const { decompose } = setUp([v("C")])
        expect(fixedOf(decompose(0, false))).toEqual({ [claim("C")]: false })
    })

    it("contradicting a conjunction is not expressible", () => {
        const { decompose } = setUp([and(v("Q"), v("R"))])
        expect(decompose(0, false)).toEqual({ kind: "notExpressible" })
    })

    it("affirming a conditional is not expressible", () => {
        const { decompose } = setUp([implies(v("P"), v("Q"))])
        expect(decompose(0, true)).toEqual({ kind: "notExpressible" })
    })

    it("a formula-wrapped expression decomposes as the unwrapped one", () => {
        const { decompose } = setUp([paren(and(v("Q"), v("R")))])
        expect(fixedOf(decompose(0, true))).toEqual({
            [claim("Q")]: true,
            [claim("R")]: true,
        })
    })

    it("a variable bound to another premise expands into that premise", () => {
        const { decompose } = setUp([and(v("Q"), v("R")), not(pv("p0"))])
        expect(fixedOf(decompose(1, false))).toEqual({
            [claim("Q")]: true,
            [claim("R")]: true,
        })
    })

    it("a statement that can never have the value is impossible", () => {
        const { decompose } = setUp([and(v("Q"), not(v("Q")))])
        expect(decompose(0, true)).toEqual({ kind: "impossible" })
    })

    it("a statement that always has the value is vacuous", () => {
        const { decompose } = setUp([or(v("Q"), not(v("Q")))])
        expect(decompose(0, true)).toEqual({ kind: "vacuous" })
    })

    it("an expansion over more columns than the ceiling is too large", () => {
        const names = Array.from({ length: 17 }, (_, index) => `K${index}`)
        const { decompose } = setUp([and(...names.map((name) => v(name)))])
        expect(decompose(0, true)).toEqual({ kind: "tooLarge" })
    })

    it("counts only the expression's own columns against the ceiling", () => {
        const names = Array.from({ length: 16 }, (_, index) => `K${index}`)
        const { decompose } = setUp([
            and(...names.map((name) => v(name))),
            and(v("Q"), v("R")),
        ])
        // Expanding the large premise first fills the shared column map.
        decompose(0, true)
        expect(fixedOf(decompose(1, true))).toEqual({
            [claim("Q")]: true,
            [claim("R")]: true,
        })
    })
})

// ---------------------------------------------------------------------------
// carryAnswers into a standard argument
// ---------------------------------------------------------------------------

interface TCarrySetUp {
    conclusion?: TNode
    premises?: (TNode | TPremiseSpec)[]
    response: TPremiseSpec[]
    answers: Record<string, TLinkAnswer>
    claimTypes?: Record<string, TCoreClaimType>
    /** Gives claim C a second variable, used in its own premise of X. */
    secondVariableFor?: string
}

function carryOne(input: TCarrySetUp) {
    const lib = newLib()
    const t = build({
        id: "x",
        version: 3,
        lib,
        conclusion: input.conclusion,
        premises: input.premises,
        claimTypes: input.claimTypes,
    })
    let secondVariableId: string | undefined
    if (input.secondVariableFor !== undefined) {
        const claimId = `claim-${input.secondVariableFor}`
        secondVariableId = "x.second"
        t.engine.addVariable({
            id: secondVariableId,
            argumentId: "x",
            argumentVersion: 3,
            symbol: "Second",
            claimId,
            claimVersion: lib.getCurrent(claimId)!.version,
        })
        const { result: pm } = t.engine.createPremiseWithId("x.extra")
        pm.addExpression({
            id: "x.extra.e",
            argumentId: "x",
            argumentVersion: 3,
            premiseId: "x.extra",
            parentId: null,
            position: 0,
            type: "variable",
            variableId: secondVariableId,
        })
    }
    const y = build({
        id: "y",
        version: 0,
        lib,
        respondsTo: t,
        premises: input.response,
        claimTypes: input.claimTypes,
    })
    const answers: Record<string, TLinkAnswer> = {}
    for (const [label, answer] of Object.entries(input.answers))
        answers[y.premise(label)] = answer
    const result = y.engine.carryAnswers(t.engine.snapshot(), answers, lib)
    const carried = () => {
        expect(result.status).toBe("carried")
        if (result.status !== "carried" || result.intoResponse)
            throw new Error("expected values carried into a standard argument")
        return result
    }
    const notCarried = (label: string) =>
        carried().notCarried.find(
            (entry) => entry.premiseId === y.premise(label)
        )
    const evaluateWith = (own: TCoreVariableAssignment = {}) => {
        const merged = mergeCarriedInput({ variables: own }, carried())
        return t.engine.evaluate({
            variables: merged.variables,
            operatorAssignments: merged.operatorAssignments,
        })
    }
    return {
        t,
        y,
        lib,
        result,
        carried,
        notCarried,
        evaluateWith,
        secondVariableId,
    }
}

const agree = (...labels: string[]): Record<string, TLinkAnswer> =>
    Object.fromEntries(labels.map((label) => [label, "agree" as const]))

describe("carrying a statement link into a standard argument", () => {
    it("contradicting a claim sets every variable of that claim false", () => {
        const { t, carried, secondVariableId } = carryOne({
            conclusion: at("c", v("C")),
            premises: [implies(v("P"), v("C"))],
            response: [labelled("L", not(x("c")))],
            answers: agree("L"),
            secondVariableFor: "C",
        })
        expect(carried().variables).toEqual({
            [t.variable("C")]: false,
            [secondVariableId!]: false,
        })
    })

    it("affirming a conjunction sets both conjuncts true", () => {
        const { t, carried } = carryOne({
            conclusion: v("C"),
            premises: [at("qr", and(v("Q"), v("R")))],
            response: [labelled("L", x("qr"))],
            answers: agree("L"),
        })
        expect(carried().variables).toEqual({
            [t.variable("Q")]: true,
            [t.variable("R")]: true,
        })
    })

    it("contradicting a disjunction sets both disjuncts false", () => {
        const { t, carried } = carryOne({
            conclusion: v("C"),
            premises: [at("qr", or(v("Q"), v("R")))],
            response: [labelled("L", not(x("qr")))],
            answers: agree("L"),
        })
        expect(carried().variables).toEqual({
            [t.variable("Q")]: false,
            [t.variable("R")]: false,
        })
    })

    it("contradicting a conditional premise sets its antecedent true and consequent false", () => {
        const { t, carried } = carryOne({
            conclusion: v("C"),
            premises: [at("pq", implies(v("P"), v("Q")))],
            response: [labelled("L", not(x("pq")))],
            answers: agree("L"),
        })
        expect(carried().variables).toEqual({
            [t.variable("P")]: true,
            [t.variable("Q")]: false,
        })
    })

    it("contradicting a conjunction is not carried", () => {
        const { carried, notCarried } = carryOne({
            conclusion: v("C"),
            premises: [at("qr", and(v("Q"), v("R")))],
            response: [labelled("L", not(x("qr")))],
            answers: agree("L"),
        })
        expect(carried().variables).toEqual({})
        expect(notCarried("L")?.reason).toBe("notExpressible")
    })

    it("a link on a formula-wrapped expression decomposes as the unwrapped one", () => {
        const { t, carried } = carryOne({
            conclusion: v("C"),
            premises: [at("qr", paren(and(v("Q"), v("R"))))],
            response: [labelled("L", x("qr"))],
            answers: agree("L"),
        })
        expect(carried().variables).toEqual({
            [t.variable("Q")]: true,
            [t.variable("R")]: true,
        })
    })

    it("contradicting an axiom is not carried, and evaluating with the result does not throw", () => {
        const { carried, notCarried, evaluateWith } = carryOne({
            conclusion: v("C"),
            premises: [implies(at("a", v("A")), v("C"))],
            response: [labelled("L", not(x("a")))],
            answers: agree("L"),
            claimTypes: { A: "axiomatic" },
        })
        expect(notCarried("L")?.reason).toBe("axiom")
        expect(carried().variables).toEqual({})
        expect(() => evaluateWith()).not.toThrow()
        expect(evaluateWith().ok).toBe(true)
    })

    it("affirming an axiom carries nothing, reported as axiom", () => {
        const { carried, notCarried } = carryOne({
            conclusion: v("C"),
            premises: [implies(at("a", v("A")), v("C"))],
            response: [labelled("L", x("a"))],
            answers: agree("L"),
            claimTypes: { A: "axiomatic" },
        })
        expect(notCarried("L")?.reason).toBe("axiom")
        expect(carried().variables).toEqual({})
    })

    it("contradicting a cited claim is carried", () => {
        const { t, carried } = carryOne({
            conclusion: v("C"),
            premises: [implies(at("s", v("S")), v("C"))],
            response: [labelled("L", not(x("s")))],
            answers: agree("L"),
            claimTypes: { S: "citation" },
        })
        expect(carried().variables).toEqual({ [t.variable("S")]: false })
    })

    it("reads a claim the response grounds as free, so contradicting S ∧ Q is not carried", () => {
        const { carried, notCarried } = carryOne({
            conclusion: v("C"),
            premises: [implies(at("sq", and(v("S"), v("Q"))), v("C"))],
            response: [
                labelled("derived", implies(v("S"), v("D")), "D"),
                labelled("L", not(x("sq"))),
            ],
            answers: agree("L"),
            claimTypes: { S: "citation" },
        })
        expect(notCarried("L")?.reason).toBe("notExpressible")
        expect(carried().variables).toEqual({})
    })
})

describe("a claim the lookup cannot resolve", () => {
    it("is not carried, so an axiom it could not see never reaches evaluation", () => {
        const lib = newLib()
        const t = build({
            id: "x",
            version: 3,
            lib,
            conclusion: v("C"),
            premises: [implies(at("a", v("A")), v("C"))],
            claimTypes: { A: "axiomatic" },
        })
        const y = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [labelled("L", not(x("a")))],
        })
        // The response's own library, standing in for one that does not hold
        // the answered argument's claims.
        const result = y.engine.carryAnswers(
            t.engine.snapshot(),
            { [y.premise("L")]: "agree" },
            newLib()
        )
        expect(result).toMatchObject({
            status: "carried",
            variables: {},
            notCarried: [{ premiseId: y.premise("L"), reason: "unknownClaim" }],
        })
        if (result.status !== "carried" || result.intoResponse) return
        const merged = mergeCarriedInput({}, result)
        expect(() =>
            t.engine.evaluate({
                variables: merged.variables,
                operatorAssignments: merged.operatorAssignments,
            })
        ).not.toThrow()
    })
})

describe("carrying an inference link into a standard argument", () => {
    const step = (
        premises: (TNode | TPremiseSpec)[],
        link: TNode,
        conclusion: TNode = v("C"),
        claimTypes?: Record<string, TCoreClaimType>
    ) =>
        carryOne({
            conclusion,
            premises,
            response: [labelled("L", link)],
            answers: agree("L"),
            claimTypes,
        })

    it.each([
        ["a not root", at("op", not(v("Q")))],
        ["an and root", at("op", and(v("Q"), v("R")))],
        [
            "a root under a formula wrapper",
            paren(at("op", and(v("Q"), v("R")))),
        ],
    ])(
        "undercutting a freeform premise at %s rejects the step and strikes the premise",
        (_, tree) => {
            const premise = labelled("pm", tree)
            const { t, carried, evaluateWith } = step([premise], not(s("op")))
            expect(carried().operatorAssignments).toEqual({
                [t.expr("op")]: "rejected",
            })
            expect(evaluateWith().struckPremiseIds).toContain(t.premise("pm"))
        }
    )

    it("undercutting a nested operator of a freeform premise rejects it and strikes the premise", () => {
        const { t, carried, evaluateWith } = step(
            [labelled("pm", implies(at("qr", and(v("Q"), v("R"))), v("S")))],
            not(s("qr"))
        )
        expect(carried().operatorAssignments).toEqual({
            [t.expr("qr")]: "rejected",
        })
        expect(evaluateWith().struckPremiseIds).toContain(t.premise("pm"))
    })

    it.each([
        ["a freeform implies root", [at("op", implies(v("M"), v("Q")))]],
        ["a freeform iff root", [at("op", iff(v("M"), v("Q")))]],
        [
            "a derivation premise's root",
            [labelled("d", at("op", implies(v("S"), v("D"))), "D")],
        ],
    ] as [string, (TNode | TPremiseSpec)[]][])(
        "reinforcing %s accepts the step",
        (_, premises) => {
            const { t, carried } = step(premises, s("op"), v("C"), {
                S: "citation",
            })
            expect(carried().operatorAssignments).toEqual({
                [t.expr("op")]: "accepted",
            })
        }
    )

    it("reinforcing a conditional conclusion root accepts it", () => {
        const { t, carried } = step(
            [v("M")],
            s("op"),
            at("op", implies(v("M"), v("C")))
        )
        expect(carried().operatorAssignments).toEqual({
            [t.expr("op")]: "accepted",
        })
    })

    it("a carried acceptance of M → Q propagates Q true when the reader asserts M", () => {
        const { t, evaluateWith } = step(
            [at("op", implies(v("M"), v("Q")))],
            s("op")
        )
        const result = evaluateWith({ [t.variable("M")]: true })
        expect(result.assignment?.variables[t.variable("Q")]).toBe(true)
    })

    it.each([
        ["a freeform and root", [at("op", and(v("Q"), v("R")))], v("C")],
        ["a freeform not root", [at("op", not(v("Q")))], v("C")],
        ["a freeform or root", [at("op", or(v("Q"), v("R")))], v("C")],
        ["a freeform xor root", [at("op", xor(v("Q"), v("R")))], v("C")],
        ["an and conclusion root", [v("M")], at("op", and(v("Q"), v("R")))],
        ["a not conclusion root", [v("M")], at("op", not(v("Q")))],
        ["an or conclusion root", [v("M")], at("op", or(v("Q"), v("R")))],
        [
            "an and conclusion root under a formula wrapper",
            [v("M")],
            paren(at("op", and(v("Q"), v("R")))),
        ],
    ] as [string, TNode[], TNode][])(
        "reinforcing %s is not carried",
        (_, premises, conclusion) => {
            const { carried, notCarried } = step(premises, s("op"), conclusion)
            expect(notCarried("L")?.reason).toBe("nonConditionalRoot")
            expect(carried().operatorAssignments).toEqual({})
        }
    )

    it("a freeform and root's conjuncts keep the values they have without the link", () => {
        const { t, evaluateWith } = step(
            [at("op", and(v("Q"), v("R")))],
            s("op")
        )
        const values = evaluateWith().assignment?.variables
        expect(values?.[t.variable("Q")] ?? null).toBeNull()
        expect(values?.[t.variable("R")] ?? null).toBeNull()
    })

    it.each([
        [
            "a freeform premise",
            [implies(at("op", and(v("Q"), v("R"))), v("S"))],
            v("C"),
        ],
        [
            "the conclusion",
            [v("M")],
            implies(at("op", and(v("Q"), v("R"))), v("C")),
        ],
        [
            "a derivation premise",
            [
                labelled(
                    "d",
                    implies(at("op", and(v("S"), v("T"))), v("D")),
                    "D"
                ),
            ],
            v("C"),
        ],
    ] as [string, (TNode | TPremiseSpec)[], TNode][])(
        "reinforcing a nested operator of %s is not carried, and leaves its children alone",
        (_, premises, conclusion) => {
            const { t, carried, notCarried, evaluateWith } = step(
                premises,
                s("op"),
                conclusion,
                { S: "citation" }
            )
            expect(notCarried("L")?.reason).toBe("nestedReinforce")
            expect(carried().operatorAssignments).toEqual({})
            const without = t.engine.evaluate({
                variables: {},
                operatorAssignments: {},
            })
            expect(evaluateWith().assignment?.variables).toEqual(
                without.assignment?.variables
            )
        }
    )

    it("undercutting the conclusion's root rejects the conclusion step", () => {
        const { t, carried, evaluateWith } = step(
            [v("M")],
            not(s("op")),
            at("op", implies(v("M"), v("C")))
        )
        expect(carried().operatorAssignments).toEqual({
            [t.expr("op")]: "rejected",
        })
        expect(evaluateWith().conclusionInferenceRejected).toBe(true)
    })

    it("undercutting a nested operator of the conclusion is not carried", () => {
        const { notCarried } = step(
            [v("M")],
            not(s("op")),
            implies(at("op", and(v("Q"), v("R"))), v("C"))
        )
        expect(notCarried("L")?.reason).toBe("ignoredInConclusion")
    })

    it("undercutting a derivation premise's operator is not carried", () => {
        const { notCarried } = step(
            [labelled("d", at("op", implies(v("S"), v("D"))), "D")],
            not(s("op")),
            v("C"),
            { S: "citation" }
        )
        expect(notCarried("L")?.reason).toBe("derivationOperator")
    })
})

describe("what carries, and from where", () => {
    it("a response reasoning from the target's claims carries only its link", () => {
        const { t, y, carried } = carryOne({
            conclusion: at("r", v("R")),
            premises: [
                labelled("d", implies(v("S"), v("P")), "P"),
                implies(v("P"), v("Q")),
                implies(v("Q"), v("R")),
            ],
            response: [
                labelled("d", implies(v("S"), v("P")), "P"),
                labelled("reason", implies(v("P"), not(x("r")))),
                labelled("L", not(x("r"))),
            ],
            answers: agree("L"),
            claimTypes: { S: "citation" },
        })
        expect(carried().variables).toEqual({ [t.variable("R")]: false })
        expect(carried().sources).toEqual([
            {
                kind: "variable",
                id: t.variable("R"),
                value: false,
                linkPremiseIds: [y.premise("L")],
            },
        ])
    })

    it("unanswered and disagreed links carry nothing, even one that would come out true", () => {
        const { t, carried } = carryOne({
            conclusion: at("c", v("C")),
            premises: [at("pc", implies(v("P"), v("C"))), v("P")],
            response: [
                labelled("affirmed", x("c")),
                labelled("denied", not(x("pc"))),
            ],
            answers: { denied: "disagree" },
        })
        // With P asserted and the step granted, C comes out true by
        // propagation: what the unanswered affirm says holds, yet it carries
        // nothing.
        const withStep = t.engine.evaluate({
            variables: { [t.variable("P")]: true },
            operatorAssignments: { [t.expr("pc")]: "accepted" },
        })
        expect(withStep.assignment?.variables[t.variable("C")]).toBe(true)
        expect(carried().variables).toEqual({})
        expect(carried().operatorAssignments).toEqual({})
        expect(carried().sources).toEqual([])
        expect(carried().notCarried).toEqual([])
    })

    it("two links fixing a claim the same way give one source naming both", () => {
        const { t, y, carried } = carryOne({
            conclusion: at("c", v("C")),
            premises: [at("cq", and(at("c2", v("C")), v("Q")))],
            response: [labelled("one", x("c")), labelled("two", x("cq"))],
            answers: agree("one", "two"),
        })
        expect(carried().sources).toEqual(
            [
                {
                    kind: "variable",
                    id: t.variable("C"),
                    value: true,
                    linkPremiseIds: [y.premise("one"), y.premise("two")].sort(),
                },
                {
                    kind: "variable",
                    id: t.variable("Q"),
                    value: true,
                    linkPremiseIds: [y.premise("two")],
                },
            ].sort((a, b) => a.id.localeCompare(b.id))
        )
    })

    it("an agree on a premise that is not a link is reported, and a disagree there is not", () => {
        const { y, carried, notCarried } = carryOne({
            conclusion: at("c", v("C")),
            response: [
                labelled("reason", implies(v("M"), not(x("c")))),
                labelled("other", v("N")),
            ],
            answers: { reason: "agree", other: "disagree" },
        })
        expect(notCarried("reason")?.reason).toBe("notALink")
        expect(
            carried().notCarried.map((entry) => entry.premiseId)
        ).not.toContain(y.premise("other"))
    })

    it("every agree answer is either a source or reported", () => {
        const { y, carried } = carryOne({
            conclusion: at("c", v("C")),
            premises: [at("qr", and(v("Q"), v("R")))],
            response: [
                labelled("a", x("c")),
                labelled("b", not(x("qr"))),
                labelled("c", v("N")),
            ],
            answers: agree("a", "b", "c"),
        })
        const accounted = new Set([
            ...carried().sources.flatMap((source) => source.linkPremiseIds),
            ...carried().notCarried.map((entry) => entry.premiseId),
        ])
        for (const label of ["a", "b", "c"])
            expect(accounted).toContain(y.premise(label))
    })
})

describe("conflicting links in one response", () => {
    it("drops every link involved, and carries nothing either fixes", () => {
        const { y, carried, notCarried } = carryOne({
            conclusion: v("C"),
            premises: [at("qr", and(at("q", v("Q")), v("R")))],
            response: [
                labelled("both", x("qr")),
                labelled("notQ", not(x("q"))),
            ],
            answers: agree("both", "notQ"),
        })
        expect(carried().variables).toEqual({})
        expect(notCarried("both")).toEqual({
            premiseId: y.premise("both"),
            reason: "conflict",
            conflictsWith: [y.premise("notQ")],
        })
        expect(notCarried("notQ")).toEqual({
            premiseId: y.premise("notQ"),
            reason: "conflict",
            conflictsWith: [y.premise("both")],
        })
    })
})

describe("refusing to carry", () => {
    it("refuses a standard argument", () => {
        const lib = newLib()
        const t = build({ id: "x", version: 3, lib, conclusion: v("C") })
        const other = build({ id: "z", version: 0, lib, conclusion: v("C") })
        const result = other.engine.carryAnswers(t.engine.snapshot(), {}, lib)
        expect(result.status).toBe("invalid")
    })

    it.each([
        ["another version", "x", 4],
        ["another argument", "w", 3],
    ] as [string, string, number][])(
        "refuses a snapshot of %s",
        (_, id, version) => {
            const { y, lib } = carryOne({
                conclusion: at("c", v("C")),
                response: [labelled("L", x("c"))],
                answers: {},
            })
            const elsewhere = build({ id, version, lib, conclusion: v("C") })
            const result = y.engine.carryAnswers(
                elsewhere.engine.snapshot(),
                {},
                lib
            )
            expect(result).toMatchObject({
                status: "invalid",
                problems: [{ code: "LINK_TARGET_MISMATCH" }],
            })
        }
    )

    it("refuses a response whose links do not fit the snapshot", () => {
        const { t, y, lib } = carryOne({
            conclusion: at("c", v("C")),
            premises: [at("m", v("M"))],
            response: [labelled("L", not(s("m")))],
            answers: {},
        })
        const result = y.engine.carryAnswers(t.engine.snapshot(), {}, lib)
        expect(result).toMatchObject({
            status: "invalid",
            problems: [{ code: "LINK_INFERENCE_ON_NON_OPERATOR" }],
        })
    })
})

describe("a carried statement means exactly what its link says", () => {
    it.each([
        ["affirming Q ∧ R", and(v("Q"), v("R")), true, []],
        ["contradicting Q ∨ R", or(v("Q"), v("R")), false, []],
        ["contradicting P → Q", implies(v("P"), v("Q")), false, []],
        ["contradicting a lone claim", v("Q"), false, []],
        ["affirming a wrapped Q ∧ R", paren(and(v("Q"), v("R"))), true, []],
        ["contradicting a cited claim", v("S"), false, []],
        [
            "contradicting S ∧ Q, with S grounded by the response",
            and(v("S"), v("Q")),
            false,
            [labelled("derived", implies(v("S"), v("D")), "D")],
        ],
    ] as [string, TNode, boolean, TPremiseSpec[]][])(
        "%s",
        (_, tree, value, reasons) => {
            const { t, carried, notCarried } = carryOne({
                conclusion: v("C"),
                premises: [at("e", tree)],
                response: [
                    ...reasons,
                    labelled("L", value ? x("e") : not(x("e"))),
                ],
                answers: agree("L"),
                claimTypes: { S: "citation" },
            })
            const expander = createTargetExpander(t.engine.snapshot())
            const node = expander.expand(t.expr("e"))
            const reason = notCarried("L")?.reason
            if (reason === "notExpressible") {
                expectOneMeaning(node, value, { kind: "notExpressible" })
                return
            }
            // Read the carried variable values back as column values.
            const fixed = new Map<string, boolean>()
            for (const [variableId, carriedValue] of Object.entries(
                carried().variables
            )) {
                const variable = t.engine.getVariable(
                    variableId
                ) as unknown as {
                    claimId: string
                }
                fixed.set(`claim:${variable.claimId}`, carriedValue)
            }
            expect(fixed.size).toBeGreaterThan(0)
            expectOneMeaning(node, value, { kind: "cube", fixed })
        }
    )
})

// ---------------------------------------------------------------------------
// carryAnswers into another response
// ---------------------------------------------------------------------------

/**
 * X concludes C; Y answers X with the contradict link `L = NOT(x)` on C, the
 * reinforce link `R = s` on X's step, and two premises that are not links;
 * Z answers Y.
 */
function chain(
    zPremises: TPremiseSpec[],
    answers: Record<string, TLinkAnswer>
) {
    const lib = newLib()
    const t = build({
        id: "x",
        version: 3,
        lib,
        conclusion: at("c", v("C")),
        premises: [at("step", implies(v("P"), v("C")))],
    })
    const y = build({
        id: "y",
        version: 0,
        lib,
        respondsTo: t,
        premises: [
            labelled("L", at("Lroot", not(at("Lx", x("c"))))),
            labelled("R", at("Rs", s("step"))),
            labelled("reason", at("reasonOp", implies(v("M"), v("N")))),
            labelled("mixed", at("mixedOp", implies(v("M"), not(x("c"))))),
        ],
    })
    const z = build({
        id: "z",
        version: 0,
        lib,
        respondsTo: y,
        premises: zPremises,
    })
    const zAnswers: Record<string, TLinkAnswer> = {}
    for (const [label, answer] of Object.entries(answers))
        zAnswers[z.premise(label)] = answer
    const result = z.engine.carryAnswers(y.engine.snapshot(), zAnswers, lib)
    const carried = () => {
        expect(result.status).toBe("carried")
        if (result.status !== "carried" || !result.intoResponse)
            throw new Error("expected link answers carried into a response")
        return result
    }
    const notCarried = (label: string) =>
        carried().notCarried.find(
            (entry) => entry.premiseId === z.premise(label)
        )
    return { lib, t, y, z, result, carried, notCarried }
}

describe("carrying into a response", () => {
    it("affirming a contradict link at its root agrees with it", () => {
        const { y, carried } = chain([labelled("A", x("Lroot"))], agree("A"))
        expect(carried().linkAnswers).toEqual({ [y.premise("L")]: "agree" })
    })

    it("contradicting a contradict link at its root disagrees with it", () => {
        const { y, carried } = chain(
            [labelled("A", not(x("Lroot")))],
            agree("A")
        )
        expect(carried().linkAnswers).toEqual({ [y.premise("L")]: "disagree" })
    })

    it("affirming the statement inside a contradict link disagrees with it", () => {
        const { y, carried } = chain([labelled("A", x("Lx"))], agree("A"))
        expect(carried().linkAnswers).toEqual({ [y.premise("L")]: "disagree" })
    })

    it("affirming a reinforce link agrees with it", () => {
        const { y, carried } = chain([labelled("A", x("Rs"))], agree("A"))
        expect(carried().linkAnswers).toEqual({ [y.premise("R")]: "agree" })
    })

    it("fixing a statement both ways through two links carries neither", () => {
        const { y, carried, notCarried } = chain(
            [labelled("A", x("Lx")), labelled("B", x("Lroot"))],
            agree("A", "B")
        )
        expect(carried().linkAnswers).toEqual({})
        expect(notCarried("A")?.reason).toBe("conflict")
        expect(notCarried("B")?.reason).toBe("conflict")
        expect(carried().linkAnswers[y.premise("L")]).toBeUndefined()
    })

    it("a statement link on a premise that is not a link, fixing no statement a link is about, reaches no link", () => {
        const { notCarried } = chain(
            [labelled("A", not(x("reasonOp")))],
            agree("A")
        )
        expect(notCarried("A")?.reason).toBe("noLinkReached")
    })

    it("an inference link on a premise that is not a link reaches no link", () => {
        const { notCarried } = chain([labelled("A", s("reasonOp"))], agree("A"))
        expect(notCarried("A")?.reason).toBe("noLinkReached")
    })

    it("an inference link on a link's NOT disputes no step", () => {
        const { notCarried } = chain(
            [labelled("A", not(s("Lroot")))],
            agree("A")
        )
        expect(notCarried("A")?.reason).toBe("linkStep")
    })

    it("a link fixing a link's statement and claims as well carries only the link answer", () => {
        const { y, carried } = chain(
            [labelled("A", not(x("mixedOp")))],
            agree("A")
        )
        expect(carried().linkAnswers).toEqual({ [y.premise("L")]: "disagree" })
        expect(carried().sources.map((source) => source.kind)).toEqual([
            "linkAnswer",
        ])
    })

    it("returns no variables or operator decisions", () => {
        const { carried } = chain([labelled("A", x("Lroot"))], agree("A"))
        expect(carried()).not.toHaveProperty("variables")
        expect(carried()).not.toHaveProperty("operatorAssignments")
    })
})

describe("the reader's own answers outrank answers carried into a response", () => {
    // X: Q ∧ R. Y answers X: L1 affirms Q ∧ R, L2 contradicts Q. Z answers Y
    // and affirms L1, so agreeing with Z carries "agree L1" into Y; the reader
    // also agrees with L2 on Y themselves.
    function threeStep() {
        const lib = newLib()
        const t = build({
            id: "x",
            version: 3,
            lib,
            conclusion: at("c", v("C")),
            premises: [at("qr", and(at("q", v("Q")), v("R")))],
        })
        const y = build({
            id: "y",
            version: 0,
            lib,
            respondsTo: t,
            premises: [
                labelled("L1", at("L1x", x("qr"))),
                labelled("L2", at("L2r", not(x("q")))),
            ],
        })
        const z = build({
            id: "z",
            version: 0,
            lib,
            respondsTo: y,
            premises: [labelled("A", x("L1x"))],
        })
        const intoY = z.engine.carryAnswers(
            y.engine.snapshot(),
            { [z.premise("A")]: "agree" },
            lib
        )
        if (intoY.status !== "carried") throw new Error("expected a carry")
        const ownOnY = { [y.premise("L2")]: "agree" as const }
        const onY = mergeCarriedInput({ linkAnswers: ownOnY }, intoY)
        return { lib, t, y, z, ownOnY, onY }
    }

    it("drops only the carried link and reports the collision", () => {
        const { lib, t, y, ownOnY, onY } = threeStep()
        const intoX = y.engine.carryAnswers(
            t.engine.snapshot(),
            onY.linkAnswers,
            lib,
            { ownLinkPremiseIds: Object.keys(ownOnY) }
        )
        if (intoX.status !== "carried" || intoX.intoResponse)
            throw new Error("expected values carried into a standard argument")
        expect(intoX.variables).toEqual({ [t.variable("Q")]: false })
        expect(intoX.notCarried).toEqual([
            {
                premiseId: y.premise("L1"),
                reason: "overriddenByOwn",
                conflictsWith: [y.premise("L2")],
            },
        ])
        expect(intoX.collisions).toEqual([
            {
                kind: "variable",
                id: t.variable("Q"),
                own: false,
                carried: true,
                linkPremiseIds: [y.premise("L1")],
            },
        ])
    })

    it("passes the collision on through mergeCarriedInput", () => {
        const { lib, t, y, ownOnY, onY } = threeStep()
        const intoX = y.engine.carryAnswers(
            t.engine.snapshot(),
            onY.linkAnswers,
            lib,
            { ownLinkPremiseIds: Object.keys(ownOnY) }
        )
        if (intoX.status !== "carried") throw new Error("expected a carry")
        const onX = mergeCarriedInput({}, intoX)
        expect(onX.variables).toEqual({ [t.variable("Q")]: false })
        expect(onX.collisions).toEqual(intoX.collisions)
    })

    it("without the reader's own links named, the two links conflict as before", () => {
        const { lib, t, y, onY } = threeStep()
        const intoX = y.engine.carryAnswers(
            t.engine.snapshot(),
            onY.linkAnswers,
            lib
        )
        if (intoX.status !== "carried") throw new Error("expected a carry")
        expect(intoX.notCarried.map((entry) => entry.reason)).toEqual([
            "conflict",
            "conflict",
        ])
        expect(intoX.collisions).toEqual([])
    })

    it("two of the reader's own links that disagree still conflict with each other", () => {
        const { lib, t, y } = threeStep()
        const intoX = y.engine.carryAnswers(
            t.engine.snapshot(),
            { [y.premise("L1")]: "agree", [y.premise("L2")]: "agree" },
            lib,
            { ownLinkPremiseIds: [y.premise("L1"), y.premise("L2")] }
        )
        if (intoX.status !== "carried") throw new Error("expected a carry")
        expect(intoX.notCarried.map((entry) => entry.reason)).toEqual([
            "conflict",
            "conflict",
        ])
        expect(intoX.collisions).toEqual([])
    })

    it("a carried link that agrees with the reader's own carries beside it", () => {
        const { lib, t, y } = threeStep()
        const intoX = y.engine.carryAnswers(
            t.engine.snapshot(),
            { [y.premise("L1")]: "agree" },
            lib,
            { ownLinkPremiseIds: [] }
        )
        if (intoX.status !== "carried" || intoX.intoResponse)
            throw new Error("expected values carried into a standard argument")
        expect(intoX.variables).toEqual({
            [t.variable("Q")]: true,
            [t.variable("R")]: true,
        })
    })

    it("into a response, the reader's own link answer wins and the collision names the link answer", () => {
        const { y, z, lib } = chain(
            [labelled("A", x("Lx")), labelled("B", x("Lroot"))],
            {}
        )
        const result = z.engine.carryAnswers(
            y.engine.snapshot(),
            { [z.premise("A")]: "agree", [z.premise("B")]: "agree" },
            lib,
            { ownLinkPremiseIds: [z.premise("B")] }
        )
        if (result.status !== "carried" || !result.intoResponse)
            throw new Error("expected link answers carried into a response")
        expect(result.linkAnswers).toEqual({ [y.premise("L")]: "agree" })
        expect(result.collisions).toEqual([
            {
                kind: "linkAnswer",
                id: y.premise("L"),
                own: "agree",
                carried: "disagree",
                linkPremiseIds: [z.premise("A")],
            },
        ])
    })
})

// ---------------------------------------------------------------------------
// Merging carried values with the reader's own input
// ---------------------------------------------------------------------------

describe("merging carried values with the reader's own input", () => {
    const contradictC = () =>
        carryOne({
            conclusion: at("c", v("C")),
            premises: [at("mc", implies(v("M"), v("C"))), v("M")],
            response: [labelled("L", not(x("c")))],
            answers: agree("L"),
        })

    it("keeps the reader's value on a collision and reports the carried one", () => {
        const { t, y, carried } = contradictC()
        const merged = mergeCarriedInput(
            { variables: { [t.variable("C")]: true } },
            carried()
        )
        expect(merged.variables[t.variable("C")]).toBe(true)
        expect(merged.collisions).toEqual([
            {
                kind: "variable",
                id: t.variable("C"),
                own: true,
                carried: false,
                linkPremiseIds: [y.premise("L")],
            },
        ])
    })

    it("lets a carried value replace the reader's explicit null, without a collision", () => {
        const { t, carried } = contradictC()
        const merged = mergeCarriedInput(
            { variables: { [t.variable("C")]: null } },
            carried()
        )
        expect(merged.variables[t.variable("C")]).toBe(false)
        expect(merged.collisions).toEqual([])
    })

    it("a carried value the argument's accepted steps contradict comes out contested", () => {
        const { t, carried } = contradictC()
        const merged = mergeCarriedInput(
            {
                variables: { [t.variable("M")]: true },
                operatorAssignments: { [t.expr("mc")]: "accepted" },
            },
            carried()
        )
        const result = t.engine.evaluate({
            variables: merged.variables,
            operatorAssignments: merged.operatorAssignments,
        })
        expect(result.contestedVariableIds).toContain(t.variable("C"))
    })

    it("keeps the reader's operator decision on a collision", () => {
        const { t, y, carried } = carryOne({
            conclusion: v("C"),
            premises: [at("op", implies(v("M"), v("Q")))],
            response: [labelled("L", not(s("op")))],
            answers: agree("L"),
        })
        const merged = mergeCarriedInput(
            { operatorAssignments: { [t.expr("op")]: "accepted" } },
            carried()
        )
        expect(merged.operatorAssignments[t.expr("op")]).toBe("accepted")
        expect(merged.collisions).toEqual([
            {
                kind: "operator",
                id: t.expr("op"),
                own: "accepted",
                carried: "rejected",
                linkPremiseIds: [y.premise("L")],
            },
        ])
    })

    it("a carried false on a cited claim survives the default true of evaluateWithDefaults", () => {
        const { t, carried } = carryOne({
            conclusion: v("C"),
            premises: [implies(at("s", v("S")), v("C"))],
            response: [labelled("L", not(x("s")))],
            answers: agree("L"),
            claimTypes: { S: "citation" },
        })
        const merged = mergeCarriedInput({}, carried())
        const result = t.engine.evaluateWithDefaults(merged.variables)
        expect(result.assignment?.variables[t.variable("S")]).toBe(false)
    })

    it("carries Z's answer through Y into X, and the reader's own answer on Y wins", () => {
        const { lib, t, y, carried } = chain(
            [labelled("A", x("Lroot"))],
            agree("A")
        )
        // The reader agrees with Z, and says nothing of their own about Y.
        const intoY = mergeCarriedInput({}, carried())
        const intoX = y.engine.carryAnswers(
            t.engine.snapshot(),
            intoY.linkAnswers,
            lib
        )
        expect(intoX).toMatchObject({
            status: "carried",
            variables: { [t.variable("C")]: false },
            sources: [
                {
                    kind: "variable",
                    id: t.variable("C"),
                    value: false,
                    linkPremiseIds: [y.premise("L")],
                },
            ],
        })

        // The reader's own disagreement with L outranks what Z carried.
        const ownDisagree = mergeCarriedInput(
            { linkAnswers: { [y.premise("L")]: "disagree" } },
            carried()
        )
        expect(ownDisagree.linkAnswers[y.premise("L")]).toBe("disagree")
        expect(ownDisagree.collisions).toMatchObject([
            {
                kind: "linkAnswer",
                id: y.premise("L"),
                own: "disagree",
                carried: "agree",
            },
        ])
    })
})

describe("evaluateWithDefaults with operator decisions", () => {
    it("applies the decisions it is given", () => {
        const t = build({
            id: "x",
            version: 3,
            lib: newLib(),
            conclusion: at("c", v("C")),
            premises: [at("mc", implies(v("M"), v("C")))],
        })
        const without = t.engine.evaluateWithDefaults({
            [t.variable("M")]: true,
        })
        expect(
            without.assignment?.variables[t.variable("C")] ?? null
        ).toBeNull()
        const withStep = t.engine.evaluateWithDefaults(
            { [t.variable("M")]: true },
            undefined,
            { [t.expr("mc")]: "accepted" }
        )
        expect(withStep.assignment?.variables[t.variable("C")]).toBe(true)
    })
})
