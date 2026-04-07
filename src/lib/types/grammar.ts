/**
 * Individual structural rule toggles for expression tree grammar.
 *
 * Each boolean controls whether a specific structural constraint is enforced.
 * When `true`, violations throw (or auto-normalize if `TGrammarConfig.autoNormalize`
 * is also `true` — but only for operations that support it).
 */
export type TGrammarOptions = {
    /** Require a `formula` node between a parent operator and a non-`not` operator child. */
    enforceFormulaBetweenOperators: boolean
}

/**
 * Grammar enforcement configuration for expression trees.
 *
 * Controls which structural rules are enforced and whether violations are
 * automatically corrected.
 *
 * **`autoNormalize` scope:** Supported in all expression mutation operations
 * including `addExpression`, `insertExpression`, `wrapExpression`, and
 * bulk-loading paths (`loadInitialExpressions`). `removeExpression` always
 * throws on violations regardless of this flag (there is no meaningful
 * auto-normalization for removal).
 */
export type TGrammarConfig = TGrammarOptions & {
    /** When `true`, auto-fix violations where possible instead of throwing. */
    autoNormalize: boolean
}

/** Default config: all rules enforced, auto-normalize on. */
export const DEFAULT_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: true,
    autoNormalize: true,
}

/** Permissive config: no enforcement. Used by default in `fromData`. */
export const PERMISSIVE_GRAMMAR_CONFIG: TGrammarConfig = {
    enforceFormulaBetweenOperators: false,
    autoNormalize: false,
}
