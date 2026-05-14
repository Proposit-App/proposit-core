// Auto-normalization (AN) post-hook for the four-tier grammar model.
//
// Per spec §5.1, the AN rule set consists of four local cleanup rules:
//
//   AN-1  Insert formula buffer when a non-`not` operator becomes a direct
//         child of another operator. Preserves P-1.
//   AN-2  Collapse double negation (NOT(NOT(x)) → x). Preserves P-2.
//   AN-3  Collapse 0-child operator/formula; promote single child where the
//         parent is non-meaningful. Preserves P-3 and P-4 (incidentally E-1).
//   AN-4  Absorb same-operator adjacency through a formula. Preserves P-5.
//
// In v1.0 the engine ships with the legacy per-flag `grammarConfig`
// machinery still in place. C1+C2 bridge `engine.behavior` to that
// config: when behavior is `'permissive'`, mutations see a permissive
// config and do not cleanup; when `'assistive'` (default), mutations
// see the engine's configured (or default-all-on) `grammarConfig`.
//
// This module exports `runAssistiveNormalization(engine)` — the future
// uniform post-hook. In v1.0 it delegates to `engine.normalize()`, which
// runs the existing AN rule set as a global pass over the argument. In
// Phase D (per the plan), the per-flag config is removed and this
// function gains a direct implementation of AN-1..AN-4 over the engine's
// expression tree, no longer routed through `engine.normalize()`.

import type { ArgumentEngine } from "../core/argument-engine.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../schemata/index.js"

/**
 * Run the AN rule set globally on `engine` if it is in `'assistive'`
 * behavior. No-op when the engine is in `'permissive'`.
 *
 * Convergence: typically ≤ 3 iterations because the rules are local and
 * idempotent in combination. Implementation delegates to
 * `engine.normalize()` in v1.0 (Phase C). Phase D rewrites this to run
 * AN-1..AN-4 directly.
 *
 * @since 1.0.0
 */
export function runAssistiveNormalization<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
>(engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>): void {
    if (engine.behavior !== "assistive") return
    // v1.0: delegate to PremiseEngine.normalizeExpressions() per premise.
    // This runs the existing AN logic via the engine's grammarConfig,
    // which C2 has bridged to `behavior` (permissive → PERMISSIVE_GRAMMAR_CONFIG;
    // assistive → configured-or-DEFAULT). Engine.normalize() arrives in
    // C3 as the public entry point; Phase D replaces this delegation
    // with a direct implementation of AN-1..AN-4.
    for (const pe of engine.listPremises()) {
        pe.normalizeExpressions()
    }
}
