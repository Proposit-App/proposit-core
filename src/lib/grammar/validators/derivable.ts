// Derivable-tier validators (D-1..D-6). Code 'D-7' is reserved — see spec
// §4.3 (derivation premise cardinality was moved to Evaluable as E-6).
//
// D-1 derivation premise canonical shape (naked-Q or populated)
// D-2 single-citation derivation form (IMPLIES(c, Q), no surrounding OR)
// D-3 no mixing axioms and citations in one derivation
// D-4 axiomatic claim placement (only in derivation antecedent)
// D-5 citation claim placement (only in derivation antecedent)
// D-6 derivation premise role (supporting, not conclusion)

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateD1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD2(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateD6(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
// 'D-7' reserved — not used.

export function validateDerivable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateD1(ctx),
        ...validateD2(ctx),
        ...validateD3(ctx),
        ...validateD4(ctx),
        ...validateD5(ctx),
        ...validateD6(ctx),
    ]
}
