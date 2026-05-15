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
import { DEFAULT_GRAMMAR_CONFIG } from "../types/grammar.js"
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

    // Temporarily flip each PE to DEFAULT_GRAMMAR_CONFIG so AN runs
    // regardless of the engine's `behavior` (user-initiated bypass).
    // Capture each PE's current config first so we can restore it even
    // if a premise's normalize call throws.
    //
    // **The swap is a no-op in D0a-D0d** because the legacy sweep
    // `ExpressionManager.normalize()` (called via
    // `pe.normalizeExpressions()` from `applyAN1`/`applyAN4`'s delegated
    // body and from the AN-2/AN-3 native passes' downstream `pe.*`
    // primitives) runs all 5 passes unconditionally — it does NOT
    // consult `grammarConfig` flags. The per-flag gating only applies
    // to *inline P-1 enforcement* in PE/EM mutation methods (the 11
    // throw sites slated for removal in D2).
    //
    // The swap is **pre-positioned for D0e** (when native AN-1 will
    // call `pe.addExpression` to insert a formula buffer between two
    // operators — which trips the inline P-1 throw under permissive's
    // strict-mode peer `enforceFormulaBetweenOperators=true`). D0f
    // moves the swap inside `applyANToFixedPoint`; D2 deletes the
    // swap entirely along with the legacy per-flag config.
    const restoreEntries: {
        pe: ReturnType<
            ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>["listPremises"]
        >[number]
        prevConfig: typeof DEFAULT_GRAMMAR_CONFIG
    }[] = []

    try {
        for (const pe of engine.listPremises()) {
            const prev = pe.getGrammarConfig()
            restoreEntries.push({ pe, prevConfig: prev })
            pe.setGrammarConfig(DEFAULT_GRAMMAR_CONFIG)
        }
        applyANToFixedPoint(engine)
    } finally {
        for (const { pe, prevConfig } of restoreEntries) {
            pe.setGrammarConfig(prevConfig)
        }
    }
}
