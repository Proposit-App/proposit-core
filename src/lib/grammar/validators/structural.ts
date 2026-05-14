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
const VALID_EXPRESSION_TYPES = new Set([
    "variable",
    "operator",
    "formula",
] as const)

const VALID_OPERATOR_TYPES = new Set([
    "not",
    "and",
    "or",
    "implies",
    "iff",
] as const)

/**
 * S-2 — Operator types. Every expression's `type` is one of `variable`,
 * `operator`, `formula`. For operator-typed expressions, the `operator`
 * field is one of `not`, `and`, `or`, `implies`, `iff`.
 */
export function validateS2(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const e of ctx.expressions) {
        const eType = (e as { type: string }).type
        if (!VALID_EXPRESSION_TYPES.has(eType as never)) {
            violations.push({
                tier: "structural",
                code: "S-2",
                message: `expression ${e.id} has unknown type '${eType}'`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
            continue
        }
        if (eType === "operator") {
            const op = (e as { operator: string }).operator
            if (!VALID_OPERATOR_TYPES.has(op as never)) {
                violations.push({
                    tier: "structural",
                    code: "S-2",
                    message: `operator expression ${e.id} has unknown operator '${op}'`,
                    argumentId: ctx.argument.id,
                    premiseId: e.premiseId,
                    expressionId: e.id,
                })
            }
        }
    }
    return violations
}

/**
 * S-3 — Variable required reference. Every variable has either a claim ref
 * or a premise ref, not both, not neither.
 */
export function validateS3(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const v of ctx.variables) {
        // Capture id before type-guard narrowing: the "neither" branch
        // below corresponds to malformed data that TypeScript narrows to
        // `never` (the static union is exhaustive). Preserving the id via
        // a separate read works around the narrowing.
        const variableId = v.id
        const hasClaimRef = isClaimBound(v)
        const hasPremiseRef = isPremiseBound(v)
        if (hasClaimRef && hasPremiseRef) {
            violations.push({
                tier: "structural",
                code: "S-3",
                message: `variable ${variableId} has both claim and premise references`,
                argumentId: ctx.argument.id,
                variableId,
            })
        } else if (!hasClaimRef && !hasPremiseRef) {
            violations.push({
                tier: "structural",
                code: "S-3",
                message: `variable ${variableId} has neither claim nor premise reference`,
                argumentId: ctx.argument.id,
                variableId,
            })
        }
    }
    return violations
}

/**
 * S-4 — No cycles. The expression tree of every premise (parent-pointer
 * graph) is acyclic.
 */
export function validateS4(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const byId = new Map<string, (typeof ctx.expressions)[number]>()
    for (const e of ctx.expressions) byId.set(e.id, e)

    for (const start of ctx.expressions) {
        const seen = new Set<string>()
        let cursor: string | null = start.id
        let cycleDetected = false
        while (cursor !== null) {
            if (seen.has(cursor)) {
                cycleDetected = true
                break
            }
            seen.add(cursor)
            const node = byId.get(cursor)
            if (node === undefined) break
            cursor = node.parentId
        }
        if (cycleDetected) {
            violations.push({
                tier: "structural",
                code: "S-4",
                message: `expression ${start.id} is in a parent-pointer cycle`,
                argumentId: ctx.argument.id,
                premiseId: start.premiseId,
                expressionId: start.id,
            })
        }
    }
    return violations
}

/**
 * S-5 — Root-only IMPLIES/IFF. Within a single premise's AST, `implies`
 * and `iff` may appear at most once and only at the root (parentId === null).
 */
export function validateS5(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const rootImplIffByPremise = new Map<string, string[]>()

    for (const e of ctx.expressions) {
        if (e.type !== "operator") continue
        if (e.operator !== "implies" && e.operator !== "iff") continue

        if (e.parentId !== null) {
            // Non-root implies/iff — violation regardless of count.
            violations.push({
                tier: "structural",
                code: "S-5",
                message: `${e.operator} expression ${e.id} appears as a non-root child`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        } else {
            // Root-level — track for >1-per-premise check.
            const list = rootImplIffByPremise.get(e.premiseId) ?? []
            list.push(e.id)
            rootImplIffByPremise.set(e.premiseId, list)
        }
    }

    for (const [premiseId, ids] of rootImplIffByPremise) {
        if (ids.length > 1) {
            // Flag all but the first as duplicates.
            for (const dupId of ids.slice(1)) {
                violations.push({
                    tier: "structural",
                    code: "S-5",
                    message: `premise ${premiseId} has more than one root-level implies/iff (duplicate: ${dupId})`,
                    argumentId: ctx.argument.id,
                    premiseId,
                    expressionId: dupId,
                })
            }
        }
    }

    return violations
}

/**
 * S-6 — Premise type discriminator consistency. `type='derivation'`
 * premises have a non-null `derivedClaimId`; `type='freeform'` premises
 * have no `derivedClaimId` (or it is null/undefined).
 */
export function validateS6(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const p of ctx.premises) {
        const derivedClaimId = (
            p as unknown as { derivedClaimId?: string | null }
        ).derivedClaimId
        if (p.type === "derivation") {
            if (
                derivedClaimId === null ||
                derivedClaimId === undefined ||
                derivedClaimId === ""
            ) {
                violations.push({
                    tier: "structural",
                    code: "S-6",
                    message: `derivation premise ${p.id} has missing derivedClaimId`,
                    argumentId: ctx.argument.id,
                    premiseId: p.id,
                })
            }
        } else if (p.type === "freeform") {
            if (
                derivedClaimId !== null &&
                derivedClaimId !== undefined &&
                derivedClaimId !== ""
            ) {
                violations.push({
                    tier: "structural",
                    code: "S-6",
                    message: `freeform premise ${p.id} has non-null derivedClaimId ${derivedClaimId}`,
                    argumentId: ctx.argument.id,
                    premiseId: p.id,
                })
            }
        }
    }
    return violations
}

/**
 * S-7 — Claim type immutability. Creation-time invariant enforced by
 * `ClaimLibrary.update()` via the engine-error code `CLAIM_TYPE_IMMUTABLE`.
 * The AST-level validator is intentionally a no-op; callers cannot
 * observe a type-mutation event from a static argument snapshot.
 */
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
