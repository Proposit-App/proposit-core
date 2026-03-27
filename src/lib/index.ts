/**
 * Library barrel export. Re-exports core classes, evaluation types, diff
 * types, schemata, and the diff function.
 */
export * from "./schemata/index.js"
export { ArgumentEngine } from "./core/argument-engine.js"
export type {
    TLogicEngineOptions,
    TArgumentEngineSnapshot,
} from "./core/argument-engine.js"
export { PremiseEngine } from "./core/premise-engine.js"
export type { TPremiseEngineSnapshot } from "./core/premise-engine.js"
export type * from "./core/interfaces/index.js"
export type { TExpressionManagerSnapshot } from "./core/expression-manager.js"
export type { TVariableManagerSnapshot } from "./core/variable-manager.js"
export { ClaimLibrary } from "./core/claim-library.js"
export { SourceLibrary } from "./core/source-library.js"
export { ClaimSourceLibrary } from "./core/claim-source-library.js"
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
    createForkedFromMatcher,
} from "./core/diff.js"
export * from "./types/relationships.js"
export {
    analyzePremiseRelationships,
    buildPremiseProfile,
} from "./core/relationships.js"
export {
    DEFAULT_CHECKSUM_CONFIG,
    createChecksumConfig,
    normalizeChecksumConfig,
    serializeChecksumConfig,
} from "./consts.js"
export { parseFormula } from "./core/parser/formula.js"
export type { TFormulaAST } from "./core/parser/formula.js"
export type {
    TExpressionInput,
    TExpressionWithoutPosition,
    TExpressionUpdate,
} from "./core/expression-manager.js"
export {
    POSITION_MIN,
    POSITION_MAX,
    POSITION_INITIAL,
    DEFAULT_POSITION_CONFIG,
    midpoint,
} from "./utils/position.js"
export type { TCorePositionConfig } from "./utils/position.js"
export * from "./types/reactive.js"
export * from "./types/grammar.js"
export * from "./types/fork.js"
export * from "./parsing/index.js"
