# Changelog

## Added

- `TAutoNormalizeConfig` type in `src/lib/types/grammar.ts` — granular flags: `wrapInsertFormula`, `negationInsertFormula`, `collapseDoubleNegation`, `collapseEmptyFormula`
- `resolveAutoNormalize(grammarConfig, flag)` function in `src/lib/types/grammar.ts` — resolves a single flag from `boolean | TAutoNormalizeConfig`
- Double-negation collapse pass (Pass 4) in `ExpressionManager.normalize()` — collapses NOT(NOT(x)) → x for both direct and formula-buffered patterns
- `grammarConfig` field on `PremiseEngine` — stored from constructor config, overridden during `fromSnapshot` restoration
- `collapseDoubleNegation` check in `PremiseEngine.toggleNegation` — when target is already NOT, removes it instead of double-wrapping
- `negationInsertFormula` check in `PremiseEngine.toggleNegation` — gates formula buffer insertion when wrapping a non-not operator in NOT; throws when disabled and `enforceFormulaBetweenOperators` is `true`
- 14 new tests in `test/core.test.ts` (`describe("granular autoNormalize config")`) covering backward compat, per-flag behavior, and edge cases
- `premiseWithVarsGranular()` test helper for creating engines with granular config

## Changed

- `TGrammarConfig.autoNormalize` type widened from `boolean` to `boolean | TAutoNormalizeConfig`
- `DEFAULT_GRAMMAR_CONFIG.autoNormalize` default documented as `true` in api-reference (was previously `false` in docs but `true` in code)
- 10 `autoNormalize` check sites in `ExpressionManager` replaced with `resolveAutoNormalize()` calls using specific flags: `wrapInsertFormula` (7 sites in `addExpression`/`insertExpression`/`wrapExpression`) and `collapseEmptyFormula` (3 sites in `collapseIfNeeded`/`assertRemovalSafe`/`simulateCollapseChain`)
- `ArgumentEngine.fromSnapshot` and `fromData` post-load normalization now only runs when `autoNormalize === true` (strict boolean); granular config objects skip post-load normalization
- `toggleNegation` formula buffer insertion now gated by `enforceFormulaBetweenOperators` check (previously unconditional)
- Updated JSDoc for `toggleNegation` in `premise-engine.interfaces.ts`
- Updated `TGrammarConfig` and `TAutoNormalizeConfig` docs in `docs/api-reference.md`
- Updated CLAUDE.md design rules for granular auto-normalize

## Removed

- `docs/change-requests/2026-04-09-granular-auto-normalize-config.md` (implemented)
