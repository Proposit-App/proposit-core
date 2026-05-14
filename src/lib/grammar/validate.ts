// Dispatcher per spec §7.1. Returns the union of violations across all
// tiers up to and including the requested tier (Structural is the most
// permissive tier; Presentable the strictest):
//
//   validate('structural')  → Structural violations only.
//   validate('evaluable')   → Structural + Evaluable.
//   validate('derivable')   → Structural + Evaluable + Derivable.
//   validate('presentable') → Structural + Evaluable + Derivable + Presentable.
//
// Never throws on grammar issues; only throws on invalid arguments that
// prevent dispatch.

import type { TGrammarTier, TViolation } from "./types.js"
import type { TValidatorContext } from "./validators/context.js"
import { validateStructural } from "./validators/structural.js"
import { validateEvaluable } from "./validators/evaluable.js"
import { validateDerivable } from "./validators/derivable.js"
import { validatePresentable } from "./validators/presentable.js"

export function validate(
    tier: TGrammarTier,
    ctx: TValidatorContext
): readonly TViolation[] {
    const structural = validateStructural(ctx)
    if (tier === "structural") return structural
    const evaluable = [...structural, ...validateEvaluable(ctx)]
    if (tier === "evaluable") return evaluable
    const derivable = [...evaluable, ...validateDerivable(ctx)]
    if (tier === "derivable") return derivable
    return [...derivable, ...validatePresentable(ctx)]
}
