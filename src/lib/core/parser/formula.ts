// @ts-expect-error — generated parser has no type declarations
import { parse as pegParse } from "./formula-gen.js"

export type TFormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: TFormulaAST }
    | { type: "and"; operands: TFormulaAST[] }
    | { type: "or"; operands: TFormulaAST[] }
    | { type: "implies"; left: TFormulaAST; right: TFormulaAST }
    | { type: "iff"; left: TFormulaAST; right: TFormulaAST }

const typedParse = pegParse as (input: string) => TFormulaAST

/** Parses a propositional logic formula string into an AST. Uses the PEG grammar defined in `formula.peggy`. */
export function parseFormula(input: string): TFormulaAST {
    return typedParse(input)
}
