import type {
    TCoreDerivationPremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "../schemata/propositional.js"
import { isClaimBound } from "../schemata/propositional.js"
import type { TInvariantValidationResult } from "../types/validation.js"
import { DERIVATION_STRUCTURE_INVALID } from "../types/validation.js"

/**
 * Validate that a derivation premise's expression tree conforms to the
 * structural rules in the v0.11.0 spec:
 *
 *   - Root must be either a single variable expression for a variable bound
 *     to the derived claim (naked form), or an `implies`/`iff` operator with
 *     arity 2.
 *   - When the root is `implies`/`iff`:
 *       - position 0 (antecedent slot) is any valid expression tree.
 *       - position 1 (consequent slot) is exactly a variable expression for
 *         a variable bound to the derived claim. No operator subtree, no
 *         variable bound elsewhere, no formula wrapper.
 *
 * A claim may bind more than one variable, and each of them stands for that
 * claim — so any of them satisfies the consequent slot.
 *
 * Returns a `TInvariantValidationResult` with one violation per detected
 * rule break, all using `DERIVATION_STRUCTURE_INVALID` (the message
 * differentiates them).
 *
 * This is a pure function — it takes a premise, its expressions, and the
 * argument's variables. It has no engine dependencies and no side effects.
 */
export function validateDerivationStructure(
    premise: TCoreDerivationPremise,
    expressions: TCorePropositionalExpression[],
    variables: TCorePropositionalVariable[]
): TInvariantValidationResult {
    const violations: TInvariantValidationResult["violations"] = []

    // 1. Locate the claim-bound variables for derivedClaimId. A claim may bind
    // more than one, and each of them stands for the derived claim — so the
    // consequent slot naming any of them is well-formed. Matching only the
    // first would call a correct premise malformed on nothing but id order.
    const consequentVariableIds = new Set(
        variables
            .filter(
                (v) => isClaimBound(v) && v.claimId === premise.derivedClaimId
            )
            .map((v) => v.id)
    )
    if (consequentVariableIds.size === 0) {
        violations.push({
            entityType: "premise",
            entityId: premise.id,
            code: DERIVATION_STRUCTURE_INVALID,
            message: `No claim-bound variable for derivedClaimId ${premise.derivedClaimId} in this argument`,
        })
        return { ok: false, violations }
    }

    // 2. Find the root expression (parentId === null) for this premise.
    const rootExpressions = expressions.filter(
        (e) => e.premiseId === premise.id && e.parentId === null
    )
    if (rootExpressions.length === 0) {
        violations.push({
            entityType: "premise",
            entityId: premise.id,
            code: DERIVATION_STRUCTURE_INVALID,
            message: "Derivation premise has no root expression",
        })
        return { ok: false, violations }
    }
    if (rootExpressions.length > 1) {
        violations.push({
            entityType: "premise",
            entityId: premise.id,
            code: DERIVATION_STRUCTURE_INVALID,
            message: "Derivation premise has multiple root expressions",
        })
        return { ok: false, violations }
    }
    const root = rootExpressions[0]

    // 3. Validate root shape.

    // Naked form: root is a variable expression for a variable bound to the
    // derived claim.
    if (root.type === "variable") {
        if (!consequentVariableIds.has(root.variableId)) {
            violations.push({
                entityType: "premise",
                entityId: premise.id,
                code: DERIVATION_STRUCTURE_INVALID,
                message: `Naked-form root variable ${root.variableId} is not bound to derivedClaimId ${premise.derivedClaimId} (bound variables: ${[...consequentVariableIds].join(", ")})`,
            })
        }
        return { ok: violations.length === 0, violations }
    }

    // Implication/biconditional form: root is implies or iff with arity 2.
    if (
        root.type === "operator" &&
        (root.operator === "implies" || root.operator === "iff")
    ) {
        const children = expressions
            .filter((e) => e.parentId === root.id)
            .sort((a, b) => a.position - b.position)

        if (children.length !== 2) {
            violations.push({
                entityType: "premise",
                entityId: premise.id,
                code: DERIVATION_STRUCTURE_INVALID,
                message: `Derivation root ${root.operator} must have arity 2 (got ${children.length})`,
            })
            return { ok: false, violations }
        }

        const consequent = children[1]
        if (
            consequent.type !== "variable" ||
            !consequentVariableIds.has(consequent.variableId)
        ) {
            violations.push({
                entityType: "premise",
                entityId: premise.id,
                code: DERIVATION_STRUCTURE_INVALID,
                message:
                    "Consequent slot (position 1) must be a variable expression for a variable bound to derivedClaimId",
            })
        }
        return { ok: violations.length === 0, violations }
    }

    // Any other root type (formula, or non-implies/iff operator) is invalid.
    const rootDesc = root.type === "operator" ? root.operator : root.type
    violations.push({
        entityType: "premise",
        entityId: premise.id,
        code: DERIVATION_STRUCTURE_INVALID,
        message: `Derivation premise root must be a variable expression or implies/iff operator (got ${rootDesc})`,
    })
    return { ok: false, violations }
}
