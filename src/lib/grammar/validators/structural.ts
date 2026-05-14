// Structural-tier validators (S-1..S-14). Each rule has an exported
// function with the signature (ctx: TValidatorContext) => readonly
// TViolation[]. The aggregator validateStructural runs every rule and
// concatenates the results.
//
// S-1  FK soundness
// S-2  operator types
// S-3  variable required reference
// S-4  no cycles
// S-5  root-only IMPLIES/IFF
// S-6  premise type discriminator consistency
// S-7  claim type immutability (creation-time invariant; runtime no-op)
// S-8  binary operator arity + positions
// S-9  sibling position uniqueness
// S-10 entity ID uniqueness
// S-11 variable symbol uniqueness
// S-12 NOT unary arity
// S-13 formula unary arity
// S-14 derivation premise root operator

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"

export function validateS1(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS2(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS3(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS4(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS5(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS6(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS7(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS8(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS9(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS10(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS11(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS12(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS13(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}
export function validateS14(_ctx: TValidatorContext): readonly TViolation[] {
    return []
}

export function validateStructural(
    ctx: TValidatorContext
): readonly TViolation[] {
    return [
        ...validateS1(ctx),
        ...validateS2(ctx),
        ...validateS3(ctx),
        ...validateS4(ctx),
        ...validateS5(ctx),
        ...validateS6(ctx),
        ...validateS7(ctx),
        ...validateS8(ctx),
        ...validateS9(ctx),
        ...validateS10(ctx),
        ...validateS11(ctx),
        ...validateS12(ctx),
        ...validateS13(ctx),
        ...validateS14(ctx),
    ]
}
