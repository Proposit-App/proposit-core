// @ts-expect-error — generated parser has no type declarations
import { parse as pegParse } from "./formula-gen.js"

export type TFormulaAST =
    | { type: "variable"; name: string }
    | { type: "not"; operand: TFormulaAST }
    | { type: "and"; operands: TFormulaAST[] }
    | { type: "or"; operands: TFormulaAST[] }
    | { type: "implies"; left: TFormulaAST; right: TFormulaAST }
    | { type: "iff"; left: TFormulaAST; right: TFormulaAST }

export function parseFormula(input: string): TFormulaAST {
    return pegParse(input) as TFormulaAST
}
