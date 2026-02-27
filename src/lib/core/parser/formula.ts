// @ts-expect-error — generated parser has no type declarations
import { parse as pegParse } from "./formula-gen.js"

export type FormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: FormulaAST }
    | { type: "and"; operands: FormulaAST[] }
    | { type: "or"; operands: FormulaAST[] }
    | { type: "implies"; left: FormulaAST; right: FormulaAST }
    | { type: "iff"; left: FormulaAST; right: FormulaAST }

export function parseFormula(input: string): FormulaAST {
    return pegParse(input) as FormulaAST
}
