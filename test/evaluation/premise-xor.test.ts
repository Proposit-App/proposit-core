// Premise-level evaluation and rendering of the variadic `xor` operator.
//
// `belnapXor`'s own table is pinned by `operator-tables.test.ts`; what this
// file pins is the premise engine's fold over 2+ operands — the seed, which
// silently inverts parity if it is wrong — and the display glyph.

import { describe, expect, it } from "vitest"
import { ArgumentEngine, ClaimLibrary } from "../../src/lib/index.js"
import type { TCoreArgument } from "../../src/lib/schemata/index.js"
import type { TOptionalChecksum } from "../../src/lib/schemata/shared.js"
import {
    CONTESTED,
    type TCorePremiseEvaluationResult,
    type TCoreQuadrivalentValue,
} from "../../src/lib/types/evaluation.js"

const T = true
const F = false
const N = null
const B = CONTESTED

interface TXorFixture {
    displayString: string
    /** The expression IDs of the operands, in order. */
    operandIds: string[]
    evaluateResult: (
        ...values: TCoreQuadrivalentValue[]
    ) => TCorePremiseEvaluationResult
    /** `rootValue` is optional on the result, hence the `undefined` here. */
    evaluate: (
        ...values: TCoreQuadrivalentValue[]
    ) => TCoreQuadrivalentValue | undefined
}

/**
 * Build a single-premise argument whose root is one `xor` node over
 * `operandCount` claim-bound variables, and hand back the two things the
 * assertions need: its rendered form and a way to evaluate it.
 */
function buildXorPremise(operandCount: number): TXorFixture {
    const argument: TOptionalChecksum<TCoreArgument> = {
        id: "arg-xor",
        version: 1,
    }
    const claimLibrary = new ClaimLibrary()
    const engine = new ArgumentEngine(argument, claimLibrary, {
        behavior: "permissive",
    })

    const variableIds: string[] = []
    for (let index = 0; index < operandCount; index++) {
        const claim = claimLibrary.create({
            id: `claim-${index}`,
            type: "normal",
        })
        variableIds.push(engine.ensureClaimBoundVariable(claim.id).id)
    }

    const { result: premise } = engine.createPremise()
    const common = {
        argumentId: argument.id,
        argumentVersion: argument.version,
        premiseId: premise.getId(),
    }
    premise.addExpression({
        ...common,
        id: "expr-xor",
        type: "operator",
        operator: "xor",
        parentId: null,
        position: 0,
    })
    variableIds.forEach((variableId, index) => {
        premise.addExpression({
            ...common,
            id: `expr-operand-${index}`,
            type: "variable",
            variableId,
            parentId: "expr-xor",
            position: index,
        })
    })

    const evaluateResult = (
        ...values: TCoreQuadrivalentValue[]
    ): TCorePremiseEvaluationResult => {
        expect(values).toHaveLength(operandCount)
        const variables: Record<string, TCoreQuadrivalentValue> = {}
        variableIds.forEach((variableId, index) => {
            variables[variableId] = values[index]
        })
        return premise.evaluate({ variables, operatorAssignments: {} })
    }

    return {
        displayString: premise.toDisplayString(),
        operandIds: variableIds.map((_, index) => `expr-operand-${index}`),
        evaluateResult,
        evaluate: (...values) => evaluateResult(...values).rootValue,
    }
}

const evaluateXor = (
    ...values: TCoreQuadrivalentValue[]
): TCoreQuadrivalentValue | undefined =>
    buildXorPremise(values.length).evaluate(...values)

describe("premise evaluation of the variadic xor operator", () => {
    it("folds two operands as parity", () => {
        expect(evaluateXor(T, T)).toBe(F)
        expect(evaluateXor(T, F)).toBe(T)
        expect(evaluateXor(F, T)).toBe(T)
        expect(evaluateXor(F, F)).toBe(F)
    })

    // The seed is the operator's identity element, so an odd count of true
    // operands is true no matter how many operands there are. Seeding `true`
    // (as `and` does) would invert every row of this test and of the one
    // above.
    it("folds three operands as parity", () => {
        expect(evaluateXor(T, T, T)).toBe(T)
        expect(evaluateXor(T, T, F)).toBe(F)
        expect(evaluateXor(T, F, T)).toBe(F)
        expect(evaluateXor(T, F, F)).toBe(T)
        expect(evaluateXor(F, F, F)).toBe(F)
    })

    it("folds four operands as parity", () => {
        expect(evaluateXor(T, T, T, T)).toBe(F)
        expect(evaluateXor(T, T, T, F)).toBe(T)
        expect(evaluateXor(T, T, F, F)).toBe(F)
        expect(evaluateXor(T, F, F, F)).toBe(T)
        expect(evaluateXor(F, F, F, F)).toBe(F)
    })

    it("lets a null operand absorb, whatever the other operands say", () => {
        expect(evaluateXor(N, T)).toBe(N)
        expect(evaluateXor(F, N)).toBe(N)
        expect(evaluateXor(T, N, T)).toBe(N)
        expect(evaluateXor(T, T, T, N)).toBe(N)
        expect(evaluateXor(N, B)).toBe(N)
    })

    it("carries a contested operand through the fold", () => {
        expect(evaluateXor(B, T)).toBe(B)
        expect(evaluateXor(B, F)).toBe(B)
        expect(evaluateXor(B, B)).toBe(B)
        expect(evaluateXor(B, T, F)).toBe(B)
        expect(evaluateXor(T, B, T, F)).toBe(B)
    })

    it("records the fold's answer on the xor expression itself", () => {
        const fixture = buildXorPremise(3)
        const result = fixture.evaluateResult(T, F, F)
        expect(result.rootValue).toBe(T)
        expect(result.expressionValues["expr-xor"]).toBe(T)
        expect(
            fixture.operandIds.map((id) => result.expressionValues[id])
        ).toEqual([T, F, F])
    })
})

describe("xor arity", () => {
    it("is not evaluable with fewer than two operands", () => {
        expect(() => buildXorPremise(1).evaluate(T)).toThrow(
            /EXPR_CHILD_COUNT_INVALID/u
        )
    })
})

describe("xor rendering", () => {
    it("renders with the ⊻ glyph between every operand", () => {
        expect(buildXorPremise(2).displayString).toMatch(/^\(\S+ ⊻ \S+\)$/u)
        expect(buildXorPremise(3).displayString).toMatch(
            /^\(\S+ ⊻ \S+ ⊻ \S+\)$/u
        )
    })
})
