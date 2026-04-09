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
 * Granular auto-normalization flags.
 *
 * Each flag controls a specific automatic structural correction during
 * expression mutation operations. Using this object instead of a plain
 * `boolean` for `autoNormalize` allows fine-grained control over which
 * normalizations are applied.
 */
export type TAutoNormalizeConfig = {
    /** Insert a formula node when wrapping/inserting creates operator-under-operator. */
    wrapInsertFormula: boolean
    /** Insert a formula buffer when toggleNegation wraps a non-not operator in NOT. */
    negationInsertFormula: boolean
    /** Collapse double negation (NOT(NOT(x)) → x) during toggleNegation and normalize. */
    collapseDoubleNegation: boolean
    /** Collapse empty formulas/operators and promote single children after removal. */
    collapseEmptyFormula: boolean
}

/**
 * Grammar enforcement configuration for expression trees.
 *
 * Controls which structural rules are enforced and whether violations are
 * automatically corrected.
 *
 * **`autoNormalize` scope:** Accepts `boolean | TAutoNormalizeConfig`.
 *
 * - `true` — enables all automatic normalizations (backward compatible).
 * - `false` — disables all automatic normalizations (backward compatible).
 * - `TAutoNormalizeConfig` — granular control over individual behaviors:
 *   - `wrapInsertFormula`: auto-insert formula buffers in `addExpression`,
 *     `insertExpression`, and `wrapExpression`.
 *   - `negationInsertFormula`: auto-insert a formula buffer when
 *     `toggleNegation` wraps a non-not operator in NOT.
 *   - `collapseDoubleNegation`: collapse NOT(NOT(x)) → x during
 *     `toggleNegation` and `normalize`.
 *   - `collapseEmptyFormula`: auto-collapse operators with 0/1 children
 *     and formulas whose bounded subtree has no binary operator after
 *     `removeExpression`.
 *
 * **Formula collapse rule:** A formula node is only justified if its bounded
 * subtree (stopping at the next nested formula) contains a binary operator
 * (`and` or `or`). Formulas wrapping only variables, `not` chains, or other
 * non-binary subtrees are automatically collapsed when `collapseEmptyFormula`
 * (or `autoNormalize: true`) is enabled.
 */
export type TGrammarConfig = TGrammarOptions & {
    /** When `true`, auto-fix all violations. When an object, granular control. */
    autoNormalize: boolean | TAutoNormalizeConfig
}

/**
 * Resolves a granular auto-normalize flag from the grammar config.
 *
 * - `true` → all flags enabled.
 * - `false` → all flags disabled.
 * - `TAutoNormalizeConfig` → returns the specific flag value.
 */
export function resolveAutoNormalize(
    grammarConfig: TGrammarConfig,
    flag: keyof TAutoNormalizeConfig
): boolean {
    const { autoNormalize } = grammarConfig
    if (typeof autoNormalize === "boolean") return autoNormalize
    return autoNormalize[flag]
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
