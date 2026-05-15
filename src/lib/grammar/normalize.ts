// Global normalize() pass per spec §6.
//
// `normalizeArgument(engine, tier)` is the engine-facing implementation
// behind `ArgumentEngine.normalize(tier?)`. It runs the AN rule set
// (AN-1..AN-4) globally across every owned premise, converging the
// argument toward the requested tier (default `'presentable'`).
//
// Forward-compat: in v1.0 every AN rule targets a Presentable invariant,
// so calls with `tier` ∈ {`structural`, `evaluable`, `derivable`} are
// effectively no-ops. The parameter exists so a future submit/finalize
// gate can introduce lower-tier AN rules without an API break.
//
// `normalizeArgument` is **non-destructive in the logical-meaning sense**:
// it only inserts buffers, collapses redundant nodes, and absorbs same-
// operator children. It never deletes a variable, changes a claim
// reference, or modifies an operator's semantics — even for Evaluable
// or Derivable violations. Recovery from those requires user intent and
// is exposed via the repair primitives (Phase C4).
//
// Bypasses `engine.behavior`. `normalize()` is user-initiated (the UI
// calls it after the user confirms a Tidy / Normalize action), so it
// must do its job even when `behavior === 'permissive'`. In v1.0 this is
// implemented by temporarily swapping each owned `PremiseEngine`'s
// grammar config to `DEFAULT_GRAMMAR_CONFIG` for the duration of the
// pass, then restoring the prior config before returning.
//
// **D0a (this commit).** The bridge now routes through
// `applyANToFixedPoint` in `src/lib/grammar/an-rules.ts` instead of
// calling `pe.normalizeExpressions()` directly. The config-swap
// try/finally remains here for D0a because the underlying
// `applyANToFixedPoint` still delegates to `pe.normalizeExpressions()`
// internally; D0f moves the swap inside `applyANToFixedPoint` (and D2
// removes it entirely along with the legacy per-flag config).

import type { ArgumentEngine } from "../core/argument-engine.js"
import { PERMISSIVE_GRAMMAR_CONFIG } from "../types/grammar.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../schemata/index.js"
import { applyANToFixedPoint } from "./an-rules.js"
import type { TGrammarTier } from "./types.js"

/**
 * Run the AN rule set globally on `engine`, converging the argument
 * toward `tier` (default `'presentable'`). See module header for the
 * semantics + non-destructiveness contract.
 *
 * @since 1.0.0
 */
export function normalizeArgument<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>,
    tier: TGrammarTier = "presentable"
): void {
    // v1.0 forward-compat: every AN rule targets Presentable. Lower-tier
    // requests are no-ops.
    if (tier !== "presentable") return

    // Temporarily flip each PE to PERMISSIVE_GRAMMAR_CONFIG for the
    // duration of the AN pass. Two purposes:
    //
    // 1. **Run AN regardless of `engine.behavior`** — `normalize()` is
    //    a user-initiated bypass that runs even in permissive mode.
    //    Capture each PE's current config first so we can restore it
    //    even if a premise's normalize call throws.
    //
    // 2. **Disarm the legacy inline P-1 enforcement throws** at PE/EM
    //    mutation sites (briefing §10, audit list of 11 sites — slated
    //    for removal in D2). With AN-2/AN-3 native from D0b/D0c and now
    //    AN-1 + AN-4 native from D0e, the AN pass issues
    //    `pe.removeExpression(_, false)` calls that route through
    //    `ExpressionManager.removeAndPromote` (em.ts:830-887). On the
    //    1-child branch, that helper enforces P-1 ("would promote a
    //    non-not operator as a direct child of another operator") under
    //    `enforceFormulaBetweenOperators: true`. AN-4's final
    //    `removeExpression(formula, false)` is reachable on the
    //    leaf-removal branch (formula has 0 children at that point) so
    //    it does NOT trip P-1; however, native AN-2/AN-3 sequences on
    //    pathological inputs CAN trip it. The PERMISSIVE swap turns the
    //    throw off so AN can do its job. D0a-D0d previously used
    //    `DEFAULT_GRAMMAR_CONFIG` here, which has
    //    `enforceFormulaBetweenOperators: true` — that did NOT disarm
    //    the throw; it was a no-op because the legacy sweep
    //    `ExpressionManager.normalize()` runs all 5 passes
    //    unconditionally. D0e (this swap) actually disarms it.
    //
    // D0f moves the swap inside `applyANToFixedPoint`; D2 deletes the
    // swap entirely along with the legacy per-flag config.
    const restoreEntries: {
        pe: ReturnType<
            ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>["listPremises"]
        >[number]
        prevConfig: typeof PERMISSIVE_GRAMMAR_CONFIG
    }[] = []

    try {
        for (const pe of engine.listPremises()) {
            const prev = pe.getGrammarConfig()
            restoreEntries.push({ pe, prevConfig: prev })
            pe.setGrammarConfig(PERMISSIVE_GRAMMAR_CONFIG)
        }
        applyANToFixedPoint(engine)
    } finally {
        for (const { pe, prevConfig } of restoreEntries) {
            pe.setGrammarConfig(prevConfig)
        }
    }
}
