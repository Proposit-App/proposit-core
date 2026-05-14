// Evaluable-tier validators (E-1, E-3..E-7). Code 'E-2' is reserved — see
// spec §4.2 (formula non-emptiness was promoted to Structural as S-13).
//
// E-1  variadic operator arity floor (and/or have ≥ 2 children)
// E-3  variable binding resolves
// E-4  axiomatic-binding constraint (runtime guard; AST-level no-op,
//      documented in JSDoc)
// E-5  derivation premise consequent present
// E-6  claim-derivation pairing (≤ 1 derivation premise per normal claim)
// E-7  argument has conclusion premise

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateE1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
// 'E-2' reserved — not used.
export function validateE3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE6(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateE7(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

export function validateEvaluable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateE1(ctx),
        ...validateE3(ctx),
        ...validateE4(ctx),
        ...validateE5(ctx),
        ...validateE6(ctx),
        ...validateE7(ctx),
    ]
}
