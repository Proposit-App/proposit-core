import { describe, expect, it } from "vitest"
import {
    createTargetExpander,
    evaluateCombinedNode,
    type TCombinedNode,
} from "../../src/lib/core/response/combined-premise-set"
import {
    decomposeStatement,
    type TStatementDecomposition,
} from "../../src/lib/core/response/carry"
import {
    and,
    at,
    build,
    implies,
    labelled,
    newLib,
    not,
    or,
    paren,
    pv,
    v,
    type TNode,
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
