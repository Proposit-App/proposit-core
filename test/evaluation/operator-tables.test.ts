import { describe, expect, it } from "vitest"
import {
    belnapAnd,
    belnapIff,
    belnapImplies,
    belnapNot,
    belnapOr,
    belnapXor,
    hasFalseComponent,
    hasTrueComponent,
    joinKnowledge,
} from "../../src/lib/core/evaluation/belnap"
import {
    CONTESTED,
    type TCoreQuadrivalentValue,
} from "../../src/lib/types/evaluation"

/**
 * The four values, in the column order the tables below are written in.
 * `B` is `CONTESTED` — told both true and false.
 */
const T: TCoreQuadrivalentValue = true
const F: TCoreQuadrivalentValue = false
const N: TCoreQuadrivalentValue = null
const B: TCoreQuadrivalentValue = CONTESTED

const VALUES: TCoreQuadrivalentValue[] = [T, F, N, B]

const NAME = new Map<TCoreQuadrivalentValue, string>([
    [T, "true"],
    [F, "false"],
    [N, "null"],
    [B, "contested"],
])

const label = (value: TCoreQuadrivalentValue): string => NAME.get(value)!

/** Reads a table written row-major over `VALUES` x `VALUES`. */
function checkBinary(
    operator: (
        a: TCoreQuadrivalentValue,
        b: TCoreQuadrivalentValue
    ) => TCoreQuadrivalentValue,
    table: TCoreQuadrivalentValue[][]
): void {
    for (const [rowIndex, left] of VALUES.entries()) {
        for (const [columnIndex, right] of VALUES.entries()) {
            const actual = operator(left, right)
            const expected = table[rowIndex][columnIndex]
            expect(
                `${label(left)} ? ${label(right)} = ${label(actual)}`
            ).toEqual(`${label(left)} ? ${label(right)} = ${label(expected)}`)
        }
    }
}

describe("four-valued operator tables", () => {
    it("negation swaps the components and fixes null and contested", () => {
        expect(belnapNot(T)).toBe(F)
        expect(belnapNot(F)).toBe(T)
        expect(belnapNot(N)).toBe(N)
        expect(belnapNot(B)).toBe(B)
    })

    it("conjunction is the meet of the truth order", () => {
        checkBinary(belnapAnd, [
            //      T  F  N  B
            /* T */ [T, F, N, B],
            /* F */ [F, F, F, F],
            /* N */ [N, F, N, F],
            /* B */ [B, F, F, B],
        ])
    })

    it("disjunction is the join of the truth order", () => {
        checkBinary(belnapOr, [
            //      T  F  N  B
            /* T */ [T, T, T, T],
            /* F */ [T, F, N, B],
            /* N */ [T, N, N, T],
            /* B */ [T, B, T, B],
        ])
    })

    it("material implication is not-a or b", () => {
        checkBinary(belnapImplies, [
            //      T  F  N  B
            /* T */ [T, F, N, B],
            /* F */ [T, T, T, T],
            /* N */ [T, N, N, T],
            /* B */ [T, B, T, B],
        ])
    })

    it("the biconditional is implication both ways", () => {
        checkBinary(belnapIff, [
            //      T  F  N  B
            /* T */ [T, F, N, B],
            /* F */ [F, T, N, B],
            /* N */ [N, N, N, T],
            /* B */ [B, B, T, B],
        ])
    })

    it("restricted to three values every table is strong Kleene", () => {
        const threeValued: TCoreQuadrivalentValue[] = [T, F, N]
        for (const left of threeValued) {
            for (const right of threeValued) {
                expect(belnapAnd(left, right)).not.toBe(CONTESTED)
                expect(belnapOr(left, right)).not.toBe(CONTESTED)
                expect(belnapImplies(left, right)).not.toBe(CONTESTED)
                expect(belnapIff(left, right)).not.toBe(CONTESTED)
            }
        }
        expect(belnapAnd(T, N)).toBe(N)
        expect(belnapAnd(F, N)).toBe(F)
        expect(belnapOr(T, N)).toBe(T)
        expect(belnapOr(F, N)).toBe(N)
    })
})

describe("four-valued XOR", () => {
    /**
     * Parity: told true iff some way of reading the operands has an odd number
     * of them true, told false iff some way has an even number. On
     * `{null, true, false}` this is exactly strong Kleene XOR, and `null`
     * absorbs — a parity depends on every operand, so knowing nothing about one
     * means knowing nothing about the result.
     */
    it("matches the parity table on every pair", () => {
        checkBinary(belnapXor, [
            //        T  F  N  B
            /* T */ [F, T, N, B],
            /* F */ [T, F, N, B],
            /* N */ [N, N, N, N],
            /* B */ [B, B, N, B],
        ])
    })

    it("is associative, so flattening a nested xor preserves its value", () => {
        for (const a of VALUES) {
            for (const b of VALUES) {
                for (const c of VALUES) {
                    expect(
                        `(${label(a)}^${label(b)})^${label(c)} = ${label(belnapXor(belnapXor(a, b), c))}`
                    ).toBe(
                        `(${label(a)}^${label(b)})^${label(c)} = ${label(belnapXor(a, belnapXor(b, c)))}`
                    )
                }
            }
        }
    })

    it("is commutative", () => {
        for (const a of VALUES) {
            for (const b of VALUES) {
                expect(belnapXor(a, b)).toBe(belnapXor(b, a))
            }
        }
    })

    it("folds to classical parity on two-valued operands", () => {
        expect(belnapXor(belnapXor(T, T), T)).toBe(T)
        expect(belnapXor(belnapXor(T, T), F)).toBe(F)
        expect(belnapXor(belnapXor(T, F), F)).toBe(T)
        expect(belnapXor(belnapXor(F, F), F)).toBe(F)
    })

    it("absorbs null even against contested, which is where it leaves not-iff", () => {
        expect(belnapXor(N, B)).toBe(N)
        expect(belnapXor(B, N)).toBe(N)
        expect(belnapNot(belnapIff(N, B))).toBe(F)
    })
})

describe("components and the knowledge join", () => {
    it("reports which components a value carries", () => {
        expect([T, F, N, B].map(hasTrueComponent)).toEqual([
            true,
            false,
            false,
            true,
        ])
        expect([T, F, N, B].map(hasFalseComponent)).toEqual([
            false,
            true,
            false,
            true,
        ])
    })

    it("merges opposite reports into contested", () => {
        checkBinary(joinKnowledge, [
            //      T  F  N  B
            /* T */ [T, B, T, B],
            /* F */ [B, F, F, B],
            /* N */ [T, F, N, B],
            /* B */ [B, B, B, B],
        ])
    })

    it("is idempotent, commutative and associative", () => {
        for (const a of VALUES) {
            expect(joinKnowledge(a, a)).toBe(a)
            for (const b of VALUES) {
                expect(joinKnowledge(a, b)).toBe(joinKnowledge(b, a))
                for (const c of VALUES) {
                    expect(joinKnowledge(joinKnowledge(a, b), c)).toBe(
                        joinKnowledge(a, joinKnowledge(b, c))
                    )
                }
            }
        }
    })
})
