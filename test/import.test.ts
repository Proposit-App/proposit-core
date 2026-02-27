import { describe, expect, it } from "vitest"
import { parseFormula } from "../src/lib/core/parser/formula"
import type { FormulaAST } from "../src/lib/core/parser/formula"

// ---------------------------------------------------------------------------
// parseFormula
// ---------------------------------------------------------------------------

describe("parseFormula", () => {
    // --- Variables ----------------------------------------------------------

    it("parses a single variable", () => {
        expect(parseFormula("P")).toEqual({
            type: "variable",
            name: "P",
        } satisfies FormulaAST)
    })

    it("parses multi-character variable names", () => {
        expect(parseFormula("Rain")).toEqual({
            type: "variable",
            name: "Rain",
        })
    })

    it("parses variable names with underscores and digits", () => {
        expect(parseFormula("is_wet_1")).toEqual({
            type: "variable",
            name: "is_wet_1",
        })
    })

    // --- Negation -----------------------------------------------------------

    it("parses negation with Unicode \u00AC", () => {
        expect(parseFormula("\u00ACP")).toEqual({
            type: "not",
            operand: { type: "variable", name: "P" },
        })
    })

    it("parses negation with ASCII !", () => {
        expect(parseFormula("!P")).toEqual({
            type: "not",
            operand: { type: "variable", name: "P" },
        })
    })

    it("parses double negation", () => {
        expect(parseFormula("\u00AC\u00ACP")).toEqual({
            type: "not",
            operand: {
                type: "not",
                operand: { type: "variable", name: "P" },
            },
        })
    })

    // --- Binary / n-ary operators -------------------------------------------

    it("parses conjunction with Unicode \u2227", () => {
        expect(parseFormula("P \u2227 Q")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses conjunction with ASCII &&", () => {
        expect(parseFormula("P && Q")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses three-way conjunction as flat operands array", () => {
        const result = parseFormula("P \u2227 Q \u2227 R")
        expect(result).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
                { type: "variable", name: "R" },
            ],
        })
    })

    it("parses disjunction with Unicode \u2228", () => {
        expect(parseFormula("P \u2228 Q")).toEqual({
            type: "or",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses disjunction with ASCII ||", () => {
        expect(parseFormula("P || Q")).toEqual({
            type: "or",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("parses implication with Unicode \u2192", () => {
        expect(parseFormula("P \u2192 Q")).toEqual({
            type: "implies",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("parses implication with ASCII ->", () => {
        expect(parseFormula("P -> Q")).toEqual({
            type: "implies",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("parses biconditional with Unicode \u2194", () => {
        expect(parseFormula("P \u2194 Q")).toEqual({
            type: "iff",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("parses biconditional with ASCII <->", () => {
        expect(parseFormula("P <-> Q")).toEqual({
            type: "iff",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    // --- Precedence ---------------------------------------------------------

    it("conjunction binds tighter than disjunction", () => {
        // P \u2228 Q \u2227 R  =  P \u2228 (Q \u2227 R)
        expect(parseFormula("P \u2228 Q \u2227 R")).toEqual({
            type: "or",
            operands: [
                { type: "variable", name: "P" },
                {
                    type: "and",
                    operands: [
                        { type: "variable", name: "Q" },
                        { type: "variable", name: "R" },
                    ],
                },
            ],
        })
    })

    it("negation binds tighter than conjunction", () => {
        // \u00ACP \u2227 Q  =  (\u00ACP) \u2227 Q
        expect(parseFormula("\u00ACP \u2227 Q")).toEqual({
            type: "and",
            operands: [
                {
                    type: "not",
                    operand: { type: "variable", name: "P" },
                },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("implication is lowest precedence", () => {
        // P \u2227 Q \u2192 R  =  (P \u2227 Q) \u2192 R
        expect(parseFormula("P \u2227 Q \u2192 R")).toEqual({
            type: "implies",
            left: {
                type: "and",
                operands: [
                    { type: "variable", name: "P" },
                    { type: "variable", name: "Q" },
                ],
            },
            right: { type: "variable", name: "R" },
        })
    })

    // --- Parentheses --------------------------------------------------------

    it("parentheses override precedence", () => {
        // (P \u2228 Q) \u2227 R
        expect(parseFormula("(P \u2228 Q) \u2227 R")).toEqual({
            type: "and",
            operands: [
                {
                    type: "or",
                    operands: [
                        { type: "variable", name: "P" },
                        { type: "variable", name: "Q" },
                    ],
                },
                { type: "variable", name: "R" },
            ],
        })
    })

    // --- Complex formulas ---------------------------------------------------

    it("parses (A \u2228 \u00ACB) \u2192 C", () => {
        expect(parseFormula("(A \u2228 \u00ACB) \u2192 C")).toEqual({
            type: "implies",
            left: {
                type: "or",
                operands: [
                    { type: "variable", name: "A" },
                    {
                        type: "not",
                        operand: { type: "variable", name: "B" },
                    },
                ],
            },
            right: { type: "variable", name: "C" },
        })
    })

    it("parses mixed Unicode and ASCII operators", () => {
        // \u00ACP && Q || R -> S
        // Precedence: \u00ACP first, then &&, then ||, then ->
        // = ((\u00ACP \u2227 Q) \u2228 R) \u2192 S
        expect(parseFormula("\u00ACP && Q || R -> S")).toEqual({
            type: "implies",
            left: {
                type: "or",
                operands: [
                    {
                        type: "and",
                        operands: [
                            {
                                type: "not",
                                operand: { type: "variable", name: "P" },
                            },
                            { type: "variable", name: "Q" },
                        ],
                    },
                    { type: "variable", name: "R" },
                ],
            },
            right: { type: "variable", name: "S" },
        })
    })

    // --- Whitespace ---------------------------------------------------------

    it("handles extra whitespace", () => {
        expect(parseFormula("  P   \u2227   Q  ")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    it("handles no whitespace", () => {
        expect(parseFormula("P\u2227Q")).toEqual({
            type: "and",
            operands: [
                { type: "variable", name: "P" },
                { type: "variable", name: "Q" },
            ],
        })
    })

    // --- Parenthesized implications -----------------------------------------

    it("allows implies inside parenthesized atom", () => {
        expect(parseFormula("(P \u2192 Q)")).toEqual({
            type: "implies",
            left: { type: "variable", name: "P" },
            right: { type: "variable", name: "Q" },
        })
    })

    it("allows implies inside parenthesized atom used in conjunction", () => {
        expect(parseFormula("(P \u2192 Q) \u2227 R")).toEqual({
            type: "and",
            operands: [
                {
                    type: "implies",
                    left: { type: "variable", name: "P" },
                    right: { type: "variable", name: "Q" },
                },
                { type: "variable", name: "R" },
            ],
        })
    })

    // --- Error cases --------------------------------------------------------

    it("throws on empty input", () => {
        expect(() => parseFormula("")).toThrow()
    })

    it("throws on invalid token", () => {
        expect(() => parseFormula("P @ Q")).toThrow()
    })

    it("throws on unmatched parenthesis", () => {
        expect(() => parseFormula("(P \u2227 Q")).toThrow()
    })

    it("throws on chained implications", () => {
        expect(() => parseFormula("P \u2192 Q \u2192 R")).toThrow()
    })
})
