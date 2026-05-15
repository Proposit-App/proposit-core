import { describe, it, expect } from "vitest"
import {
    validateP1,
    validateP2,
    validateP3,
    validateP4,
    validateP5,
    validatePresentable,
} from "../../src/lib/grammar/validators/presentable.js"
import {
    buildContext,
    makeVariableExpression,
    makeOperatorExpression,
    makeFormulaExpression,
} from "./fixtures.js"

describe("grammar/presentable", () => {
    describe("P-1 formula buffer between operators", () => {
        it("rejects AND(OR(...), ...) — OR is a direct child of AND", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c1",
                        parentId: "e-or",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        parentId: "e-or",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-c3",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            const violations = validateP1(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "presentable",
                code: "P-1",
            })
        })

        it("accepts AND(formula(OR(...)), ...) — formula buffer between operators", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeFormulaExpression({
                        id: "e-formula",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c1",
                        parentId: "e-or",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        parentId: "e-or",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-c3",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            expect(validateP1(ctx)).toEqual([])
        })

        it("accepts NOT(AND(...)) — not is exempt as a child of an operator", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeOperatorExpression("not", {
                        id: "e-not",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c",
                        parentId: "e-not",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            expect(validateP1(ctx)).toEqual([])
        })

        it("accepts AND(NOT(...), ...) — NOT directly inside an operator is allowed", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeOperatorExpression("not", {
                        id: "e-not",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c",
                        parentId: "e-not",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c2",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            expect(validateP1(ctx)).toEqual([])
        })
    })

    describe("P-2 no double negation", () => {
        it("rejects NOT(NOT(x))", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("not", { id: "e-not-outer" }),
                    makeOperatorExpression("not", {
                        id: "e-not-inner",
                        parentId: "e-not-outer",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-not-inner",
                        position: 0,
                    }),
                ],
            })
            const violations = validateP2(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "presentable",
                code: "P-2",
                expressionId: "e-not-outer",
            })
        })

        it("accepts NOT(x) for a variable child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("not", { id: "e-not" }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-not",
                        position: 0,
                    }),
                ],
            })
            expect(validateP2(ctx)).toEqual([])
        })

        it("accepts NOT(AND(...)) — NOT of any non-NOT operator is fine", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("not", { id: "e-not" }),
                    makeOperatorExpression("and", {
                        id: "e-and",
                        parentId: "e-not",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-a",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            expect(validateP2(ctx)).toEqual([])
        })
    })

    describe("P-3 formula has operator descendant", () => {
        it("rejects formula(variable) — leaf wrapper", () => {
            const ctx = buildContext({
                expressions: [
                    makeFormulaExpression({ id: "e-formula" }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-formula",
                        position: 0,
                    }),
                ],
            })
            const violations = validateP3(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "presentable",
                code: "P-3",
                expressionId: "e-formula",
            })
        })

        it("rejects formula(NOT(variable)) — single not, no binary operator descendant", () => {
            const ctx = buildContext({
                expressions: [
                    makeFormulaExpression({ id: "e-formula" }),
                    makeOperatorExpression("not", {
                        id: "e-not",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-not",
                        position: 0,
                    }),
                ],
            })
            const violations = validateP3(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("P-3")
        })

        it("accepts formula(AND(...)) — has a binary operator descendant", () => {
            const ctx = buildContext({
                expressions: [
                    makeFormulaExpression({ id: "e-formula" }),
                    makeOperatorExpression("and", {
                        id: "e-and",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-a",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            expect(validateP3(ctx)).toEqual([])
        })

        it("accepts formula(OR(...)) — has a binary operator descendant", () => {
            const ctx = buildContext({
                expressions: [
                    makeFormulaExpression({ id: "e-formula" }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-a",
                        parentId: "e-or",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-or",
                        position: 1,
                    }),
                ],
            })
            expect(validateP3(ctx)).toEqual([])
        })
    })

    describe("P-4 no single-child binary operator", () => {
        it("rejects AND with 1 child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-and",
                        position: 0,
                    }),
                ],
            })
            const violations = validateP4(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0]).toMatchObject({
                tier: "presentable",
                code: "P-4",
                expressionId: "e-and",
            })
        })

        it("rejects OR with 1 child", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("or", { id: "e-or" }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-or",
                        position: 0,
                    }),
                ],
            })
            const violations = validateP4(ctx)
            expect(violations).toHaveLength(1)
            expect(violations[0].code).toBe("P-4")
        })

        it("accepts AND/OR with 2+ children", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeVariableExpression({
                        id: "e-a",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-and",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-c",
                        parentId: "e-and",
                        position: 2,
                    }),
                ],
            })
            expect(validateP4(ctx)).toEqual([])
        })
    })

    describe("P-5 no operator-of-same-type adjacency through a formula", () => {
        it("rejects AND(formula(AND(B, C)), D) — same-operator absorbable through formula", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and-outer" }),
                    makeFormulaExpression({
                        id: "e-formula",
                        parentId: "e-and-outer",
                        position: 0,
                    }),
                    makeOperatorExpression("and", {
                        id: "e-and-inner",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-and-inner",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c",
                        parentId: "e-and-inner",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-d",
                        parentId: "e-and-outer",
                        position: 1,
                    }),
                ],
            })
            const violations = validateP5(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0]).toMatchObject({
                tier: "presentable",
                code: "P-5",
            })
        })

        it("rejects OR(formula(OR(B, C)), D) — same-operator absorbable through formula", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("or", { id: "e-or-outer" }),
                    makeFormulaExpression({
                        id: "e-formula",
                        parentId: "e-or-outer",
                        position: 0,
                    }),
                    makeOperatorExpression("or", {
                        id: "e-or-inner",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-or-inner",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c",
                        parentId: "e-or-inner",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-d",
                        parentId: "e-or-outer",
                        position: 1,
                    }),
                ],
            })
            const violations = validateP5(ctx)
            expect(violations.length).toBeGreaterThanOrEqual(1)
            expect(violations[0].code).toBe("P-5")
        })

        it("accepts AND(formula(OR(B, C)), D) — different operator types, no absorption", () => {
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeFormulaExpression({
                        id: "e-formula",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        parentId: "e-formula",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-b",
                        parentId: "e-or",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-c",
                        parentId: "e-or",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-d",
                        parentId: "e-and",
                        position: 1,
                    }),
                ],
            })
            expect(validateP5(ctx)).toEqual([])
        })
    })

    describe("aggregator validatePresentable", () => {
        it("concatenates every per-rule validator's output", () => {
            // Context that fails P-1 (operator-under-operator), P-2 (double
            // negation), and P-4 (single-child AND).
            const ctx = buildContext({
                expressions: [
                    makeOperatorExpression("and", { id: "e-and" }),
                    makeOperatorExpression("or", {
                        id: "e-or",
                        parentId: "e-and",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-o-1",
                        parentId: "e-or",
                        position: 0,
                    }),
                    makeOperatorExpression("not", {
                        id: "e-not-outer",
                        parentId: "e-or",
                        position: 1,
                    }),
                    makeOperatorExpression("not", {
                        id: "e-not-inner",
                        parentId: "e-not-outer",
                        position: 0,
                    }),
                    makeVariableExpression({
                        id: "e-x",
                        parentId: "e-not-inner",
                        position: 0,
                    }),
                    makeOperatorExpression("and", {
                        id: "e-and-single",
                        parentId: "e-and",
                        position: 1,
                    }),
                    makeVariableExpression({
                        id: "e-single-c",
                        parentId: "e-and-single",
                        position: 0,
                    }),
                ],
            })
            const codes = validatePresentable(ctx).map((v) => v.code)
            expect(codes).toContain("P-1")
            expect(codes).toContain("P-2")
            expect(codes).toContain("P-4")
        })
    })
})
