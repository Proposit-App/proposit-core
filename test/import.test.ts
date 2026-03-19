import { describe, expect, it } from "vitest"
import { parseFormula } from "../src/lib/core/parser/formula"
import type { TFormulaAST } from "../src/lib/core/parser/formula"
import { importArgumentFromYaml } from "../src/cli/import"

// ---------------------------------------------------------------------------
// parseFormula
// ---------------------------------------------------------------------------

describe("parseFormula", () => {
    // --- Variables ----------------------------------------------------------

    it("parses a single variable", () => {
        expect(parseFormula("P")).toEqual({
            type: "variable",
            name: "P",
        } satisfies TFormulaAST)
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

// ---------------------------------------------------------------------------
// importArgumentFromYaml
// ---------------------------------------------------------------------------

describe("importArgumentFromYaml", () => {
    // --- Basic import -------------------------------------------------------

    it("imports a simple argument with one variable", () => {
        const yaml = `
metadata:
  title: Simple Argument
  description: A basic test
premises:
  - formula: "P \u2192 P"
    role: conclusion
  - formula: "P \u2192 P"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("Simple Argument")
        expect(arg.description).toBe("A basic test")
        expect(engine.listPremises().length).toBe(2)
    })

    it("extracts variables implicitly from formulas", () => {
        const yaml = `
metadata:
  title: Multi-variable
premises:
  - formula: "A \u2192 B"
    role: conclusion
  - formula: "A \u2227 C"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const vars = engine.collectReferencedVariables()
        expect(vars.bySymbol.A).toBeDefined()
        expect(vars.bySymbol.B).toBeDefined()
        expect(vars.bySymbol.C).toBeDefined()
    })

    it("defaults description to empty string", () => {
        const yaml = `
metadata:
  title: No Description
premises:
  - formula: "P \u2192 P"
    role: conclusion
  - formula: "P \u2192 P"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        expect(
            (engine.getArgument() as Record<string, unknown>).description
        ).toBeUndefined()
    })

    it("defaults premises without role to supporting", () => {
        const yaml = `
metadata:
  title: Default Roles
premises:
  - formula: "P \u2192 Q"
    role: conclusion
  - formula: "P \u2192 Q"
  - formula: "P \u2192 Q"
`
        const { engine } = importArgumentFromYaml(yaml)
        expect(engine.listSupportingPremises().length).toBe(2)
        expect(engine.getConclusionPremise()).toBeDefined()
    })

    it("sets conclusion and supporting roles correctly", () => {
        const yaml = `
metadata:
  title: Modus Ponens
premises:
  - metadata:
      title: If P then Q
    formula: "P \u2192 Q"
    role: supporting
  - metadata:
      title: P is true
    formula: "P \u2192 P"
    role: supporting
  - metadata:
      title: Therefore Q
    formula: "P \u2192 Q"
    role: conclusion
`
        const { engine } = importArgumentFromYaml(yaml)
        const conclusion = engine.getConclusionPremise()
        expect(conclusion).toBeDefined()
        expect(conclusion!.getExtras().title).toBe("Therefore Q")
        expect(engine.listSupportingPremises().length).toBe(2)
    })

    // --- Expression tree building -------------------------------------------

    it("builds correct expression tree for conjunction", () => {
        const yaml = `
metadata:
  title: Conjunction
premises:
  - formula: "P \u2227 Q"
    role: conclusion
  - formula: "P \u2227 Q"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const pm = engine.listPremises()[0]
        expect(pm.toDisplayString()).toBe("(P \u2227 Q)")
    })

    it("builds correct expression tree for complex formula", () => {
        const yaml = `
metadata:
  title: Complex
premises:
  - formula: "(A \u2228 \u00ACB) \u2192 C"
    role: conclusion
  - formula: "(A \u2228 \u00ACB) \u2192 C"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const pm = engine.listPremises()[0]
        // Formula buffer wraps the or under implies: implies(formula(or(A, not(B))), C)
        expect(pm.toDisplayString()).toBe("(((A \u2228 \u00AC(B))) \u2192 C)")
    })

    it("builds correct expression tree for three-way conjunction", () => {
        const yaml = `
metadata:
  title: Three-way
premises:
  - formula: "P \u2227 Q \u2227 R"
    role: conclusion
  - formula: "P \u2227 Q \u2227 R"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const pm = engine.listPremises()[0]
        expect(pm.toDisplayString()).toBe("(P \u2227 Q \u2227 R)")
    })

    it("builds correct expression tree for biconditional", () => {
        const yaml = `
metadata:
  title: Biconditional
premises:
  - formula: "P \u2194 Q"
    role: conclusion
  - formula: "P \u2194 Q"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const pm = engine.listPremises()[0]
        expect(pm.toDisplayString()).toBe("(P \u2194 Q)")
    })

    // --- Evaluation ---------------------------------------------------------

    it("produces a valid evaluable argument", () => {
        const yaml = `
metadata:
  title: Evaluable
premises:
  - formula: "P \u2192 Q"
    role: conclusion
  - formula: "P \u2192 Q"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const validation = engine.validateEvaluability()
        expect(validation.ok).toBe(true)
    })

    it("produces an argument that can check validity", () => {
        const yaml = `
metadata:
  title: Modus Ponens
premises:
  - formula: "P \u2192 Q"
    role: supporting
  - formula: "Q \u2192 Q"
    role: conclusion
`
        const { engine } = importArgumentFromYaml(yaml)
        const result = engine.checkValidity()
        expect(result.ok).toBe(true)
    })

    // --- Cross-premise variables --------------------------------------------

    it("shares variables across premises", () => {
        const yaml = `
metadata:
  title: Shared Vars
premises:
  - formula: "P \u2192 Q"
    role: supporting
  - formula: "P \u2192 Q"
    role: conclusion
`
        const { engine } = importArgumentFromYaml(yaml)
        const vars = engine.collectReferencedVariables()
        expect(vars.bySymbol.P.premiseIds.length).toBe(2)
    })

    // --- Error cases --------------------------------------------------------

    it("throws on invalid YAML", () => {
        expect(() => importArgumentFromYaml(":::invalid")).toThrow()
    })

    it("throws on missing title", () => {
        const yaml = `
premises:
  - formula: "P"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on missing premises", () => {
        const yaml = `
metadata:
  title: No premises
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on empty premises array", () => {
        const yaml = `
metadata:
  title: Empty
premises: []
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on missing formula", () => {
        const yaml = `
metadata:
  title: No Formula
premises:
  - metadata:
      title: Missing formula
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on multiple conclusions", () => {
        const yaml = `
metadata:
  title: Two Conclusions
premises:
  - formula: "P \u2192 Q"
    role: conclusion
  - formula: "Q \u2192 R"
    role: conclusion
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on invalid formula syntax", () => {
        const yaml = `
metadata:
  title: Bad Formula
premises:
  - formula: "P @@ Q"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow()
    })

    it("throws on nested implication", () => {
        const yaml = `
metadata:
  title: Nested Implication
premises:
  - formula: "(P \u2192 Q) \u2227 R"
`
        expect(() => importArgumentFromYaml(yaml)).toThrow(/root/i)
    })

    // --- ASCII variants -----------------------------------------------------

    it("uses ASCII formula variants correctly", () => {
        const yaml = `
metadata:
  title: ASCII
premises:
  - formula: "!P && Q || R -> S"
    role: conclusion
  - formula: "!P && Q || R -> S"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const pm = engine.listPremises()[0]
        // !P && Q || R -> S  parses as  ((\u00ACP \u2227 Q) \u2228 R) \u2192 S
        // Formula buffers between operator children: implies(formula(or(formula(and(not(P),Q)),R)),S)
        expect(pm.toDisplayString()).toBe(
            "(((((\u00AC(P) \u2227 Q)) \u2228 R)) \u2192 S)"
        )
    })

    // --- Version metadata ---------------------------------------------------

    it("sets argument version to 0 and published to false", () => {
        const yaml = `
metadata:
  title: Version Check
premises:
  - formula: "P \u2192 P"
    role: conclusion
  - formula: "P \u2192 P"
    role: supporting
`
        const { engine } = importArgumentFromYaml(yaml)
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.version).toBe(0)
        expect(arg.published).toBe(false)
    })
})
