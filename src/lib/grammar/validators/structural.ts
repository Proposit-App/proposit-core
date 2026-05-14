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
import { isClaimBound, isPremiseBound } from "../../schemata/propositional.js"

/**
 * S-1 — FK soundness.
 *
 * For every entity in the context, check that its foreign-key fields
 * resolve to an existing target:
 * - `expression.parentId` (when non-null) resolves to another expression
 *   in the context.
 * - Claim-bound variable's `claimId` resolves to a claim in the context.
 * - Premise-bound variable's `boundPremiseId` resolves to a premise in the
 *   context **only when** the binding is internal
 *   (`boundArgumentId === argument.id`); externally-bound variables
 *   resolve in a different argument and are not S-1's concern.
 *
 * Premise `argumentId`/`argumentVersion` matching its container argument
 * is checked here too (same-FK-soundness umbrella).
 */
export function validateS1(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const expressionIds = new Set(ctx.expressions.map((e) => e.id))
    const premiseIds = new Set(ctx.premises.map((p) => p.id))
    const claimIds = new Set(ctx.claims.map((c) => c.id))

    // Expression parent refs.
    for (const e of ctx.expressions) {
        if (e.parentId !== null && !expressionIds.has(e.parentId)) {
            violations.push({
                tier: "structural",
                code: "S-1",
                message: `expression ${e.id} has parentId ${e.parentId} which does not resolve`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }

    // Variable refs.
    for (const v of ctx.variables) {
        if (isClaimBound(v)) {
            if (!claimIds.has(v.claimId)) {
                violations.push({
                    tier: "structural",
                    code: "S-1",
                    message: `variable ${v.id} has claimId ${v.claimId} which does not resolve`,
                    argumentId: ctx.argument.id,
                    variableId: v.id,
                    claimId: v.claimId,
                })
            }
        } else if (isPremiseBound(v)) {
            // Internal binding: same argument; FK must resolve here. External
            // binding: different argument; resolves elsewhere — not S-1.
            if (
                v.boundArgumentId === ctx.argument.id &&
                !premiseIds.has(v.boundPremiseId)
            ) {
                violations.push({
                    tier: "structural",
                    code: "S-1",
                    message: `variable ${v.id} has boundPremiseId ${v.boundPremiseId} which does not resolve in argument ${ctx.argument.id}`,
                    argumentId: ctx.argument.id,
                    variableId: v.id,
                    premiseId: v.boundPremiseId,
                })
            }
        }
    }

    // Premise → argument refs.
    for (const p of ctx.premises) {
        if (
            p.argumentId !== ctx.argument.id ||
            p.argumentVersion !== ctx.argument.version
        ) {
            violations.push({
                tier: "structural",
                code: "S-1",
                message: `premise ${p.id} has argumentId/argumentVersion ${p.argumentId}/${p.argumentVersion} which does not match container ${ctx.argument.id}/${ctx.argument.version}`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
            })
        }
    }

    return violations
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
