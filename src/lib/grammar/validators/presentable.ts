// Presentable-tier validators (P-1..P-5).
//
// P-1 formula buffer between operators
// P-2 no double negation
// P-3 formula has operator descendant
// P-4 no single-child binary operator (largely redundant with E-1, kept
//     for clarity in the rule inventory)
// P-5 no operator-of-same-type adjacency through a formula

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateP1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP2(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateP5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

export function validatePresentable(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateP1(ctx),
        ...validateP2(ctx),
        ...validateP3(ctx),
        ...validateP4(ctx),
        ...validateP5(ctx),
    ]
}
