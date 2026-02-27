/**
 * @module @polintpro/proposit-core
 *
 * Core engine for building, evaluating, and diffing propositional logic
 * arguments. Exports {@link ArgumentEngine} and {@link PremiseManager} as
 * the primary API, along with all type schemata and the {@link diffArguments}
 * utility.
 */
export { ArgumentEngine, PremiseManager } from "./lib/index"
export * from "./lib/schemata"
export * from "./lib/types/diff"
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./lib/core/diff"
export { importArgumentFromYaml } from "./lib/core/import"
export { parseFormula } from "./lib/core/parser/formula"
export type { FormulaAST } from "./lib/core/parser/formula"
