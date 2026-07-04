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
// S-8  binary operator arity
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
// Static-string allow-lists used by S-2 below. Kept as `string[]` (not the
// narrow literal union) so `.includes(...)` accepts a widened input from
// runtime data — the whole point of S-2 is to detect deserialized data
// whose discriminant value doesn't match the legal union at compile time.
const validExpressionTypes: string[] = ["variable", "operator", "formula"]
const validOperatorTypes: string[] = ["not", "and", "or", "implies", "iff"]

/**
 * S-2 — Operator types. Every expression's `type` is one of `variable`,
 * `operator`, `formula`. For operator-typed expressions, the `operator`
 * field is one of `not`, `and`, `or`, `implies`, `iff`.
 */
export function validateS2(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const e of ctx.expressions) {
        // Widen `type` to `string` so .includes() accepts it without a cast.
        // TS thinks the field can only be the legal union; the widening is
        // a defensive read against malformed runtime data.
        const eType: string = e.type
        if (!validExpressionTypes.includes(eType)) {
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
        if (e.type === "operator") {
            const op: string = e.operator
            if (!validOperatorTypes.includes(op)) {
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
            // Every root-level implies/iff in a premise with >1 is in
            // violation — there's no canonical "first" that's correct and
            // the rest wrong, so flag each. Consumers that prefer
            // first-wins can dedupe by `premiseId` at the UI layer.
            for (const offendingId of ids) {
                violations.push({
                    tier: "structural",
                    code: "S-5",
                    message: `premise ${premiseId} has more than one root-level implies/iff (${ids.length} total; offender: ${offendingId})`,
                    argumentId: ctx.argument.id,
                    premiseId,
                    expressionId: offendingId,
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
 *
 * `TCoreFreeformPremise` and `TCoreDerivationPremise` are both
 * `additionalProperties: true` in their TypeBox schemas, so a freeform
 * premise CAN carry a stray `derivedClaimId` field at runtime even
 * though the TS shape doesn't surface it. We use the `in` operator and
 * a narrow shape cast to read the field as `unknown` rather than the
 * earlier `as unknown` double-cast.
 */
export function validateS6(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const p of ctx.premises) {
        if (p.type === "derivation") {
            if (
                p.derivedClaimId === null ||
                p.derivedClaimId === undefined ||
                p.derivedClaimId === ""
            ) {
                violations.push({
                    tier: "structural",
                    code: "S-6",
                    message: `derivation premise ${p.id} has missing derivedClaimId`,
                    argumentId: ctx.argument.id,
                    premiseId: p.id,
                })
            }
            continue
        }
        // Freeform branch. Check for a stray derivedClaimId via the
        // additionalProperties extension slot.
        if (!("derivedClaimId" in p)) continue
        const stray = (p as { derivedClaimId?: unknown }).derivedClaimId
        if (stray != null && stray !== "") {
            violations.push({
                tier: "structural",
                code: "S-6",
                message: `freeform premise ${p.id} has non-null derivedClaimId (${typeof stray === "string" ? stray : typeof stray})`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
            })
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
/**
 * Build a Map<parentId, children-sorted-by-position> view of the
 * expression tree. Internal helper for the arity/position validators.
 */
function childrenByParent(
    expressions: readonly TValidatorContext["expressions"][number][]
): Map<string, TValidatorContext["expressions"][number][]> {
    const out = new Map<string, TValidatorContext["expressions"][number][]>()
    for (const e of expressions) {
        if (e.parentId === null) continue
        const list = out.get(e.parentId) ?? []
        list.push(e)
        out.set(e.parentId, list)
    }
    for (const list of out.values()) {
        list.sort((a, b) => a.position - b.position)
    }
    return out
}

/**
 * S-8 — Binary operator arity. `implies` and `iff` have exactly 2
 * children. Child ordering (antecedent at lower position, consequent at
 * higher) is conveyed by the relative sibling positions — any
 * `[a, b]` with `a < b` is semantically equivalent to `[0, 1]`. The
 * absolute position values are sibling-ordering metadata maintained by
 * the mutation primitives and are not a Structural invariant; sibling
 * uniqueness is enforced separately by S-9.
 *
 * Pre-1.0.2 S-8 also pinned positions to literal `[0, 1]`. That check
 * was over-strict — it false-flagged existing arguments whose binary
 * operators sat at midpoint-spaced positions (e.g., `[0, 1073741823]`,
 * the default `wrapExpression` spacing for variadic operators). The
 * position pin was relaxed in 1.0.2 to arity-only.
 */
export function validateS8(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = childrenByParent(ctx.expressions)
    for (const e of ctx.expressions) {
        if (e.type !== "operator") continue
        if (e.operator !== "implies" && e.operator !== "iff") continue
        const kids = children.get(e.id) ?? []
        if (kids.length !== 2) {
            violations.push({
                tier: "structural",
                code: "S-8",
                message: `${e.operator} expression ${e.id} has ${kids.length} children (expected 2)`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }
    return violations
}

/**
 * S-9 — Sibling position uniqueness. Within a single parent's children,
 * no two siblings share the same `position`.
 */
export function validateS9(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    // Group by parentId (including null root group, scoped per premise).
    const groups = new Map<string, (typeof ctx.expressions)[number][]>()
    for (const e of ctx.expressions) {
        // Root-level siblings: scope by premise (each premise's roots are
        // their own sibling set). We key root groups by `__root__::premiseId`.
        const key =
            e.parentId === null
                ? `__root__::${e.premiseId}`
                : `parent::${e.parentId}`
        const list = groups.get(key) ?? []
        list.push(e)
        groups.set(key, list)
    }
    for (const list of groups.values()) {
        const seenAt = new Map<number, string>()
        for (const e of list) {
            const existing = seenAt.get(e.position)
            if (existing !== undefined) {
                violations.push({
                    tier: "structural",
                    code: "S-9",
                    message: `siblings ${existing} and ${e.id} share position ${e.position}`,
                    argumentId: ctx.argument.id,
                    premiseId: e.premiseId,
                    expressionId: e.id,
                })
            } else {
                seenAt.set(e.position, e.id)
            }
        }
    }
    return violations
}

/**
 * Collect duplicate-ID violations from a collection.
 */
function duplicateIdsIn<T extends { id: string }>(
    items: readonly T[]
): string[] {
    const seen = new Set<string>()
    const dups: string[] = []
    for (const item of items) {
        if (seen.has(item.id)) dups.push(item.id)
        seen.add(item.id)
    }
    return dups
}

/**
 * S-10 — Entity ID uniqueness. Within an argument, premises, expressions,
 * and variables each have unique IDs in their respective collection.
 */
export function validateS10(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const dup of duplicateIdsIn(ctx.premises)) {
        violations.push({
            tier: "structural",
            code: "S-10",
            message: `duplicate premise id ${dup}`,
            argumentId: ctx.argument.id,
            premiseId: dup,
        })
    }
    for (const dup of duplicateIdsIn(ctx.expressions)) {
        violations.push({
            tier: "structural",
            code: "S-10",
            message: `duplicate expression id ${dup}`,
            argumentId: ctx.argument.id,
            expressionId: dup,
        })
    }
    for (const dup of duplicateIdsIn(ctx.variables)) {
        violations.push({
            tier: "structural",
            code: "S-10",
            message: `duplicate variable id ${dup}`,
            argumentId: ctx.argument.id,
            variableId: dup,
        })
    }
    return violations
}

/**
 * S-11 — Variable symbol uniqueness. Within a single argument, no two
 * variables share the same `symbol`.
 */
export function validateS11(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const seenAt = new Map<string, string>()
    for (const v of ctx.variables) {
        const existing = seenAt.get(v.symbol)
        if (existing !== undefined) {
            violations.push({
                tier: "structural",
                code: "S-11",
                message: `variables ${existing} and ${v.id} share symbol '${v.symbol}'`,
                argumentId: ctx.argument.id,
                variableId: v.id,
            })
        } else {
            seenAt.set(v.symbol, v.id)
        }
    }
    return violations
}

/**
 * S-12 — NOT unary arity. Every `not` expression has exactly one child.
 */
export function validateS12(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = childrenByParent(ctx.expressions)
    for (const e of ctx.expressions) {
        if (e.type !== "operator" || e.operator !== "not") continue
        const count = (children.get(e.id) ?? []).length
        if (count !== 1) {
            violations.push({
                tier: "structural",
                code: "S-12",
                message: `not expression ${e.id} has ${count} children (expected 1)`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }
    return violations
}

/**
 * S-13 — Formula unary arity. Every `formula` expression has exactly one
 * child.
 */
export function validateS13(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = childrenByParent(ctx.expressions)
    for (const e of ctx.expressions) {
        if (e.type !== "formula") continue
        const count = (children.get(e.id) ?? []).length
        if (count !== 1) {
            violations.push({
                tier: "structural",
                code: "S-13",
                message: `formula expression ${e.id} has ${count} children (expected 1)`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
            })
        }
    }
    return violations
}

/**
 * S-14 — Derivation premise root operator. Every `type='derivation'`
 * premise's root expression is one of `variable`, `implies`, or `iff`.
 * (`iff` is Structurally allowed; D-1 narrows the populated form to
 * `implies` only — Derivable concern.)
 */
export function validateS14(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const expressionsByPremise = new Map<
        string,
        (typeof ctx.expressions)[number][]
    >()
    for (const e of ctx.expressions) {
        const list = expressionsByPremise.get(e.premiseId) ?? []
        list.push(e)
        expressionsByPremise.set(e.premiseId, list)
    }
    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        const inThisPremise = expressionsByPremise.get(p.id) ?? []
        const roots = inThisPremise.filter((e) => e.parentId === null)
        // Zero or multiple roots is a different invariant (S-1 / S-10 may
        // catch shape issues); S-14 specifically guards the root operator
        // *kind* when a root exists.
        if (roots.length === 0) continue
        for (const root of roots) {
            const isAllowed =
                root.type === "variable" ||
                (root.type === "operator" &&
                    (root.operator === "implies" || root.operator === "iff"))
            if (!isAllowed) {
                const rootDesc =
                    root.type === "operator" ? root.operator : root.type
                violations.push({
                    tier: "structural",
                    code: "S-14",
                    message: `derivation premise ${p.id} root operator is '${rootDesc}' (must be variable, implies, or iff)`,
                    argumentId: ctx.argument.id,
                    premiseId: p.id,
                    expressionId: root.id,
                })
            }
        }
    }
    return violations
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
