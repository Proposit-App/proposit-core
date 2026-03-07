/**
 * Library barrel export. Re-exports core classes, evaluation types, diff
 * types, schemata, and the diff function.
 */
export * from "./schemata/index.js"
export { ArgumentEngine } from "./core/argumentEngine.js"
export type {
    TLogicEngineOptions,
    TArgumentEngineSnapshot,
} from "./core/argumentEngine.js"
export { PremiseEngine } from "./core/premiseEngine.js"
export type { TPremiseEngineSnapshot } from "./core/premiseEngine.js"
export type { TExpressionManagerSnapshot } from "./core/expressionManager.js"
export type { TVariableManagerSnapshot } from "./core/variableManager.js"
export * from "./types/evaluation.js"
export * from "./types/diff.js"
export * from "./types/mutation.js"
export * from "./types/checksum.js"
export {
    computeHash,
    canonicalSerialize,
    entityChecksum,
} from "./core/checksum.js"
export {
    diffArguments,
    defaultCompareArgument,
    defaultCompareVariable,
    defaultComparePremise,
    defaultCompareExpression,
} from "./core/diff.js"
export * from "./types/relationships.js"
export {
    analyzePremiseRelationships,
    buildPremiseProfile,
} from "./core/relationships.js"
export { DEFAULT_CHECKSUM_CONFIG, createChecksumConfig } from "./consts.js"
export { parseFormula } from "./core/parser/formula.js"
export type { FormulaAST } from "./core/parser/formula.js"
export type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./core/expressionManager.js"
export {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    DEFAULT_POSITION_CONFIG,
    midpoint,
} from "./utils/position.js"
export type { TCorePositionConfig } from "./utils/position.js"
