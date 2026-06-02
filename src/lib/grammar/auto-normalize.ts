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
// This module exports `runAssistiveNormalization(engine)` — the
// uniform AN post-hook for `assistive` mode. All four AN rules are
// native single-rule passes routed through `applyANToFixedPoint` in
// `src/lib/grammar/an-rules.ts`; there is no legacy per-flag
// `grammarConfig` machinery and no inline P-1 throw sites, so this
// bridge is unconditional delegation gated only on `engine.behavior`.

import type { ArgumentEngine } from "../core/argument-engine.js"
import type {
    TCoreArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TCoreClaim,
} from "../schemata/index.js"
import { applyANToFixedPoint } from "./an-rules.js"

/**
 * Run the AN rule set globally on `engine` if it is in `'assistive'`
 * behavior. No-op when the engine is in `'permissive'`.
 *
 * Convergence: typically ≤ 3 iterations because the rules are local and
 * idempotent in combination. Implementation routes through
 * `applyANToFixedPoint` in `src/lib/grammar/an-rules.ts`.
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
    applyANToFixedPoint(engine)
}
