/**
 * @module @polintpro/proposit-core
 *
 * Core engine for building, evaluating, and diffing propositional logic
 * arguments. Exports {@link ArgumentEngine} and {@link PremiseManager} as
 * the primary API, along with all type schemata and the {@link diffArguments}
 * utility.
 */
export { ArgumentEngine, PremiseManager } from "./lib/index.js"
export * from "./lib/schemata/index.js"
export * from "./lib/types/diff.js"
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./lib/core/diff.js"
export { importArgumentFromYaml } from "./lib/core/import.js"
export { parseFormula } from "./lib/core/parser/formula.js"
export type { FormulaAST } from "./lib/core/parser/formula.js"
