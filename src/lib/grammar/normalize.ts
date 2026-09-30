// Global normalize() pass (docs/Proposit_Grammar.md §5).
//
// `normalizeArgument(engine, tier)` is the engine-facing implementation
// behind `ArgumentEngine.normalize(tier?)`. It runs the AN rule set
// (AN-1..AN-4) globally across every owned premise, converging the
// argument toward the requested tier (default `'presentable'`).
//
// Every AN rule currently targets a Presentable invariant, so calls with `tier` ∈ {`structural`, `evaluable`, `derivable`} are
// effectively no-ops. The parameter exists so a future submit/finalize
// gate can introduce lower-tier AN rules without an API break.
//
// `normalizeArgument` is **non-destructive in the logical-meaning sense**:
// it only inserts buffers, collapses redundant nodes, and absorbs same-
// operator children. It never deletes a variable, changes a claim
// reference, or modifies an operator's semantics — even for Evaluable
// or Derivable violations. Recovery from those requires user intent and
// is exposed via the repair primitives.
//
// Bypasses `engine.behavior`. `normalize()` is user-initiated (the UI
// calls it after the user confirms a Tidy / Normalize action), so it
// must do its job even when `behavior === 'permissive'`. This bridge is
// therefore just a tier gate followed by unconditional delegation.

import type { ArgumentEngine } from "../core/argument-engine.js"
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
    // Every AN rule currently targets Presentable, so lower-tier
    // requests are no-ops.
    if (tier !== "presentable") return

    // `normalize()` is user-initiated and runs regardless of
    // `engine.behavior`; `applyANToFixedPoint` does not consult
    // `behavior`, so this delegation is a clean bypass of the
    // permissive-mode gate.
    applyANToFixedPoint(engine)
}
