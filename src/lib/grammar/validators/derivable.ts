// Derivable-tier validators (D-1..D-6). Code 'D-7' is reserved — see spec
// §4.3 (derivation premise cardinality was restated as Evaluable E-6).
//
// D-1 derivation premise canonical shape (naked-Q or populated)
// D-2 single-citation derivation form (IMPLIES(c, Q), no surrounding OR)
// D-3 no mixing axioms and citations in one derivation
// D-4 axiomatic claim placement (only in derivation antecedent)
// D-5 citation claim placement (only in derivation antecedent)
// D-6 derivation premise role (supporting, not conclusion)

import type { TViolation } from "../types.js"
import type { TValidatorContext } from "./context.js"
import { isClaimBound } from "../../schemata/propositional.js"
import type {
    TCorePropositionalExpression,
    TCorePropositionalVariableExpression,
    TCoreClaim,
} from "../../schemata/index.js"

// ---- Internal helpers -------------------------------------------------

type TChildMap = Map<string, TCorePropositionalExpression[]>

/**
 * Build a Map<parentId, children-sorted-by-position> view of the expression
 * tree.
 */
function buildTChildMap(
    expressions: readonly TCorePropositionalExpression[]
): TChildMap {
    const out: TChildMap = new Map()
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
 * Walks down through transparent `formula` nodes, returning the first
 * descendant that is not a formula. Per spec §4.3 D-1: the Presentable
 * tier wraps `OR` in a formula buffer; validators must treat the buffer
 * as transparent when matching the populated-form skeleton.
 *
 * Returns the input expression itself if it is not a formula. Returns
 * undefined if a malformed formula (0 or >1 children) breaks the walk —
 * higher-level callers can treat that as a shape-mismatch.
 */
function peelFormulas(
    expr: TCorePropositionalExpression,
    children: TChildMap
): TCorePropositionalExpression | undefined {
    let cursor: TCorePropositionalExpression | undefined = expr
    while (cursor?.type === "formula") {
        const kids: TCorePropositionalExpression[] =
            children.get(cursor.id) ?? []
        if (kids.length !== 1) return undefined
        cursor = kids[0]
    }
    return cursor
}

/**
 * Group expressions by premise.
 */
function groupExpressionsByPremise(
    expressions: readonly TCorePropositionalExpression[]
): Map<string, TCorePropositionalExpression[]> {
    const out = new Map<string, TCorePropositionalExpression[]>()
    for (const e of expressions) {
        const list = out.get(e.premiseId) ?? []
        list.push(e)
        out.set(e.premiseId, list)
    }
    return out
}

/**
 * Map variableId → its claim record (claim-bound variables only).
 */
function buildVarToClaim(ctx: TValidatorContext): Map<string, TCoreClaim> {
    const claimById = new Map<string, TCoreClaim>()
    for (const c of ctx.claims) claimById.set(c.id, c)
    const out = new Map<string, TCoreClaim>()
    for (const v of ctx.variables) {
        if (!isClaimBound(v)) continue
        const claim = claimById.get(v.claimId)
        if (claim !== undefined) out.set(v.id, claim)
    }
    return out
}

/**
 * Collect every variable expression in the subtree rooted at `start`,
 * walking through all descendants. Used by D-3 (collect antecedent
 * variables) and D-4/D-5 placement scans.
 */
function collectVariableExpressionsInSubtree(
    start: TCorePropositionalExpression,
    children: TChildMap
): TCorePropositionalVariableExpression[] {
    const out: TCorePropositionalVariableExpression[] = []
    const stack: TCorePropositionalExpression[] = [start]
    while (stack.length > 0) {
        const cursor = stack.pop()!
        if (cursor.type === "variable") out.push(cursor)
        const kids: TCorePropositionalExpression[] =
            children.get(cursor.id) ?? []
        stack.push(...kids)
    }
    return out
}

/**
 * For a `type='derivation'` premise, find the root expression
 * (parentId === null) within that premise. Returns undefined if no root
 * exists or multiple roots exist (other validators flag those).
 */
function findPremiseRoot(
    premiseId: string,
    grouped: Map<string, TCorePropositionalExpression[]>
): TCorePropositionalExpression | undefined {
    const exprs = grouped.get(premiseId) ?? []
    const roots = exprs.filter((e) => e.parentId === null)
    if (roots.length !== 1) return undefined
    return roots[0]
}

// ---- Validators -------------------------------------------------------

/**
 * D-1 — Derivation premise canonical shape. Every `type='derivation'`
 * premise's tree matches one of two canonical forms:
 *
 * - **Naked-Q**: a single `variable` expression at the root, bound to
 *   `derivedClaimId`.
 * - **Populated**: root `IMPLIES` with consequent at position 1 (variable
 *   bound to `derivedClaimId`); antecedent at position 0, after peeling
 *   formula buffers, is either a single claim-bound variable
 *   (citation/axiomatic) — see D-2 — or an `OR` whose children (each
 *   peeled of formulas) are all claim-bound variables of the same
 *   grounding type. IFF at root fails D-1 (Structurally allowed per
 *   S-14; D-1 narrows derivation premise root to IMPLIES).
 *
 * Wrong-root-operator cases (and/or/not/formula at root) are already
 * caught by Structural S-14; D-1 silently skips them.
 */
export function validateD1(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildTChildMap(ctx.expressions)
    const grouped = groupExpressionsByPremise(ctx.expressions)
    const varToClaim = buildVarToClaim(ctx)

    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        const root = findPremiseRoot(p.id, grouped)
        if (root === undefined) continue

        // Naked-Q: single variable at root bound to derivedClaimId.
        if (root.type === "variable") {
            const claim = varToClaim.get(root.variableId)
            if (claim?.id !== p.derivedClaimId) {
                violations.push({
                    tier: "derivable",
                    code: "D-1",
                    message: `derivation premise ${p.id} naked-Q root variable is not bound to derivedClaimId ${p.derivedClaimId}`,
                    argumentId: ctx.argument.id,
                    premiseId: p.id,
                    expressionId: root.id,
                })
            }
            continue
        }

        // Populated form requires root='implies'. IFF at root is a D-1
        // violation. Any other operator type (and/or/not/formula) is
        // caught by S-14; D-1 skips silently.
        if (root.type !== "operator") continue
        if (root.operator === "iff") {
            violations.push({
                tier: "derivable",
                code: "D-1",
                message: `derivation premise ${p.id} has IFF at root; populated form must be IMPLIES`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: root.id,
            })
            continue
        }
        if (root.operator !== "implies") continue

        // Populated form: check consequent at position 1.
        const kids = children.get(root.id) ?? []
        if (kids.length !== 2) {
            violations.push({
                tier: "derivable",
                code: "D-1",
                message: `derivation premise ${p.id} populated form has ${kids.length} root children (expected 2)`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: root.id,
            })
            continue
        }
        const consequent = kids[1]
        if (consequent.type !== "variable") {
            violations.push({
                tier: "derivable",
                code: "D-1",
                message: `derivation premise ${p.id} consequent slot must be a variable expression`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: consequent.id,
            })
            continue
        }
        const consequentClaim = varToClaim.get(consequent.variableId)
        if (consequentClaim?.id !== p.derivedClaimId) {
            violations.push({
                tier: "derivable",
                code: "D-1",
                message: `derivation premise ${p.id} consequent variable is not bound to derivedClaimId ${p.derivedClaimId}`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: consequent.id,
            })
            continue
        }

        // Antecedent at position 0, peeled of formula buffers.
        const antecedent = peelFormulas(kids[0], children)
        if (antecedent === undefined) {
            violations.push({
                tier: "derivable",
                code: "D-1",
                message: `derivation premise ${p.id} antecedent has malformed formula buffer`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: kids[0].id,
            })
            continue
        }
        const valid = antecedentMatchesPopulatedForm(
            antecedent,
            children,
            varToClaim
        )
        if (!valid) {
            violations.push({
                tier: "derivable",
                code: "D-1",
                message: `derivation premise ${p.id} antecedent shape does not match populated form (single claim variable or OR of same-grounding claim variables)`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: antecedent.id,
            })
        }
    }

    return violations
}

/**
 * Returns true when `antecedent` is one of:
 * - A variable expression bound to a citation or axiomatic claim.
 * - An `or` operator whose children (each peeled of formulas) are all
 *   variable expressions bound to citation or axiomatic claims of the
 *   same grounding type.
 *
 * D-2 (single-citation form) and D-3 (no mixing) are separate validators
 * that emit their own codes; this helper only answers the D-1 question.
 */
function antecedentMatchesPopulatedForm(
    antecedent: TCorePropositionalExpression,
    children: TChildMap,
    varToClaim: Map<string, TCoreClaim>
): boolean {
    if (antecedent.type === "variable") {
        const claim = varToClaim.get(antecedent.variableId)
        if (claim === undefined) return false
        return claim.type === "citation" || claim.type === "axiomatic"
    }
    if (antecedent.type !== "operator" || antecedent.operator !== "or") {
        return false
    }
    const orChildren = children.get(antecedent.id) ?? []
    // Multi-citation populated form requires ≥ 2 children. A 1-child OR
    // is not valid populated form — the single-grounding case is
    // `IMPLIES(claim-var, Q)` without an OR wrapper (D-2). Without this
    // ≥-2 floor, `IMPLIES(OR(single-citation), Q)` would pass D-1
    // silently and only D-2 would fire; consumers gating on a clean D-1
    // would accept invalid shape.
    if (orChildren.length < 2) return false
    for (const child of orChildren) {
        const peeled = peelFormulas(child, children)
        if (peeled === undefined) return false
        if (peeled.type !== "variable") return false
        const claim = varToClaim.get(peeled.variableId)
        if (claim === undefined) return false
        if (claim.type !== "citation" && claim.type !== "axiomatic") {
            return false
        }
    }
    return true
}

/**
 * D-2 — Single-citation derivation form. If a derivation premise has a
 * populated form whose antecedent (peeled of formula buffers) is an `OR`
 * with exactly one child (also peeled of formulas), that's wrong — the
 * canonical single-grounding form is `IMPLIES(claim-var, Q)` without the
 * `OR` wrapper.
 *
 * Note: a 1-child `OR` also fails E-1 (variadic ≥ 2) and P-4
 * (single-child binary). D-2 is the Derivable-tier UI hint specifically
 * naming the "drop the OR wrapper" remediation.
 */
export function validateD2(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildTChildMap(ctx.expressions)
    const grouped = groupExpressionsByPremise(ctx.expressions)

    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        const root = findPremiseRoot(p.id, grouped)
        if (root === undefined) continue
        if (root.type !== "operator" || root.operator !== "implies") continue
        const kids = children.get(root.id) ?? []
        if (kids.length < 1) continue
        const antecedent = peelFormulas(kids[0], children)
        if (antecedent === undefined) continue
        if (antecedent.type !== "operator" || antecedent.operator !== "or") {
            continue
        }
        const orChildren = children.get(antecedent.id) ?? []
        if (orChildren.length === 1) {
            violations.push({
                tier: "derivable",
                code: "D-2",
                message: `derivation premise ${p.id} antecedent is OR with a single child; drop the OR wrapper`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: antecedent.id,
            })
        }
    }

    return violations
}

/**
 * D-3 — No mixing axioms and citations in one derivation. For each
 * derivation premise's populated form, collect all claim-bound variables
 * in the antecedent subtree. If they bind to claims of more than one
 * grounding type (citation vs axiomatic), emit D-3.
 *
 * Formula nodes are traversed transparently by
 * `collectVariableExpressionsInSubtree`'s plain DFS descent — no
 * explicit `peelFormulas` call needed for D-3, since the DFS visits
 * formula descendants like any other node and the variable collector
 * picks up the claim-bound variables regardless of nesting depth.
 */
export function validateD3(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildTChildMap(ctx.expressions)
    const grouped = groupExpressionsByPremise(ctx.expressions)
    const varToClaim = buildVarToClaim(ctx)

    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        const root = findPremiseRoot(p.id, grouped)
        if (root === undefined) continue
        if (root.type !== "operator" || root.operator !== "implies") continue
        const kids = children.get(root.id) ?? []
        if (kids.length < 1) continue
        const antecedent = kids[0]
        const varExprs = collectVariableExpressionsInSubtree(
            antecedent,
            children
        )
        const groundingTypes = new Set<string>()
        for (const ve of varExprs) {
            const claim = varToClaim.get(ve.variableId)
            if (claim === undefined) continue
            if (claim.type === "citation" || claim.type === "axiomatic") {
                groundingTypes.add(claim.type)
            }
        }
        if (groundingTypes.size > 1) {
            violations.push({
                tier: "derivable",
                code: "D-3",
                message: `derivation premise ${p.id} antecedent mixes axiom and citation grounding`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
                expressionId: antecedent.id,
            })
        }
    }

    return violations
}

/**
 * Returns true when `expr` is in the antecedent subtree (position-0
 * descendants of root IMPLIES) of a derivation premise. Used by D-4/D-5
 * to determine whether a typed-claim variable expression is in a
 * permissible location.
 *
 * Returns false for variables in freeform premises, variables at the
 * consequent slot of a derivation premise's IMPLIES, and variables at the
 * naked-Q root of a derivation premise.
 */
function isInDerivationAntecedent(
    expr: TCorePropositionalExpression,
    premiseType: "freeform" | "derivation",
    children: TChildMap,
    expressionsById: Map<string, TCorePropositionalExpression>,
    grouped: Map<string, TCorePropositionalExpression[]>
): boolean {
    if (premiseType !== "derivation") return false
    const root = findPremiseRoot(expr.premiseId, grouped)
    if (root === undefined) return false
    // Naked-Q: the root variable is the consequent, not the antecedent.
    if (root.type === "variable") return false
    if (root.type !== "operator" || root.operator !== "implies") return false
    const kids = children.get(root.id) ?? []
    if (kids.length < 1) return false
    const antecedentRoot = kids[0]
    // Walk up from expr's parent until we either reach the antecedent root
    // (in scope) or reach the IMPLIES root via the consequent path (out of scope).
    let cursor: string | null = expr.id
    while (cursor !== null) {
        if (cursor === antecedentRoot.id) return true
        if (cursor === root.id) return false
        const node = expressionsById.get(cursor)
        if (node === undefined) return false
        cursor = node.parentId
    }
    return false
}

/**
 * Common implementation for D-4 / D-5: variables bound to a particular
 * claim type appear only in derivation premise antecedents.
 */
function validateClaimPlacement(
    ctx: TValidatorContext,
    claimType: "citation" | "axiomatic",
    code: "D-4" | "D-5"
): readonly TViolation[] {
    const violations: TViolation[] = []
    const children = buildTChildMap(ctx.expressions)
    const grouped = groupExpressionsByPremise(ctx.expressions)
    const varToClaim = buildVarToClaim(ctx)
    const premiseTypeById = new Map<string, "freeform" | "derivation">()
    for (const p of ctx.premises) premiseTypeById.set(p.id, p.type)
    const expressionsById = new Map<string, TCorePropositionalExpression>()
    for (const e of ctx.expressions) expressionsById.set(e.id, e)

    for (const e of ctx.expressions) {
        if (e.type !== "variable") continue
        const claim = varToClaim.get(e.variableId)
        if (claim?.type !== claimType) continue
        const premiseType = premiseTypeById.get(e.premiseId)
        if (premiseType === undefined) continue
        const allowed = isInDerivationAntecedent(
            e,
            premiseType,
            children,
            expressionsById,
            grouped
        )
        if (!allowed) {
            violations.push({
                tier: "derivable",
                code,
                message: `${claimType}-bound variable expression ${e.id} appears outside a derivation premise antecedent`,
                argumentId: ctx.argument.id,
                premiseId: e.premiseId,
                expressionId: e.id,
                claimId: claim.id,
                variableId: e.variableId,
            })
        }
    }

    return violations
}

/**
 * D-4 — Axiomatic claim placement. Variables bound to `type='axiomatic'`
 * claims appear only in the antecedent of a derivation premise, never in
 * freeform premises and never in a derivation premise's consequent slot.
 */
export function validateD4(ctx: TValidatorContext): readonly TViolation[] {
    return validateClaimPlacement(ctx, "axiomatic", "D-4")
}

/**
 * D-5 — Citation claim placement. Mirror of D-4 for citation claims.
 */
export function validateD5(ctx: TValidatorContext): readonly TViolation[] {
    return validateClaimPlacement(ctx, "citation", "D-5")
}

/**
 * D-6 — Derivation premise role. Every `type='derivation'` premise has
 * `role='supporting'` — concretely, `roleState.conclusionPremiseId !==
 * premise.id`.
 */
export function validateD6(ctx: TValidatorContext): readonly TViolation[] {
    const violations: TViolation[] = []
    for (const p of ctx.premises) {
        if (p.type !== "derivation") continue
        if (ctx.roleState.conclusionPremiseId === p.id) {
            violations.push({
                tier: "derivable",
                code: "D-6",
                message: `derivation premise ${p.id} is designated as conclusion; derivation premises must be supporting`,
                argumentId: ctx.argument.id,
                premiseId: p.id,
            })
        }
    }
    return violations
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
