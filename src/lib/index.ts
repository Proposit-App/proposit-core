/**
 * Library barrel export. Re-exports core classes, evaluation types, diff
 * types, and the diff function.
 */
export { ArgumentEngine } from "./core/ArgumentEngine.js"
export { PremiseManager } from "./core/PremiseManager.js"
export * from "./types/evaluation.js"
export * from "./types/diff.js"
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./core/diff.js"
export { importArgumentFromYaml } from "./core/import.js"
export { parseFormula } from "./core/parser/formula.js"
export type { FormulaAST } from "./core/parser/formula.js"
