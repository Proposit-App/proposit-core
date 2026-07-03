import type { TCorePropositionalExpression } from "../schemata/index.js"
import { CorePropositionalExpressionSchema } from "../schemata/index.js"
import type { ChangeCollector } from "./change-collector.js"
import type { TLogicEngineOptions } from "./argument-engine.js"
import { Value } from "typebox/value"
import type {
    TInvariantViolation,
    TInvariantValidationResult,
} from "../types/validation.js"
import {
    EXPR_SCHEMA_INVALID,
    EXPR_DUPLICATE_ID,
    EXPR_SELF_REFERENTIAL_PARENT,
    EXPR_PARENT_NOT_FOUND,
    EXPR_PARENT_NOT_CONTAINER,
    EXPR_ROOT_ONLY_VIOLATED,
    EXPR_CHILD_LIMIT_EXCEEDED,
    EXPR_POSITION_DUPLICATE,
    EXPR_CHECKSUM_MISMATCH,
} from "../types/validation.js"
import { flushExpressionChecksums } from "./expression-manager-dirty-set.js"

/**
 * Performs a comprehensive validation sweep on all managed expressions.
 *
 * Collects ALL violations rather than failing on the first one. Checks:
 * schema validity, duplicate IDs, self-referential parents, parent
 * existence, parent container type, root-only operators, child limits,
 * position uniqueness, and checksum integrity.
 */
export function validateExpressionManagerInvariants<
    TExpr extends TCorePropositionalExpression,
>(
    expressions: Map<string, TExpr>,
    childExpressionIdsByParentId: Map<string | null, Set<string>>,
    dirtyExpressionIds: Set<string>,
    config: TLogicEngineOptions | undefined,
    collector: ChangeCollector | null
): TInvariantValidationResult {
    const violations: TInvariantViolation[] = []
    const seenIds = new Set<string>()

    // ── 1. Save pre-flush checksums for later comparison ──
    const preFlushChecksums = new Map<
        string,
        {
            checksum: string
            descendantChecksum: string | null
            combinedChecksum: string
        }
    >()
    for (const [id, expr] of expressions) {
        if (expr.checksum != null) {
            preFlushChecksums.set(id, {
                checksum: expr.checksum,
                descendantChecksum: expr.descendantChecksum,
                combinedChecksum: expr.combinedChecksum,
            })
        }
    }

    // ── 2. Flush checksums to get fresh values ──
    // Mark all expressions dirty so flush recomputes everything
    for (const id of expressions.keys()) {
        dirtyExpressionIds.add(id)
    }
    flushExpressionChecksums(
        dirtyExpressionIds,
        expressions,
        childExpressionIdsByParentId,
        config,
        collector
    )

    // ── 3. Per-expression checks ──
    // Build a sibling-position map for position uniqueness checks
    const positionsByParent = new Map<string | null, Map<number, string[]>>()

    for (const [id, expr] of expressions) {
        // 3a. Schema check
        if (
            !Value.Check(
                CorePropositionalExpressionSchema,
                expr as unknown as TCorePropositionalExpression
            )
        ) {
            violations.push({
                code: EXPR_SCHEMA_INVALID,
                message: `Expression "${id}" does not conform to CorePropositionalExpressionSchema.`,
                entityType: "expression",
                entityId: id,
            })
        }

        // 3b. Duplicate ID
        if (seenIds.has(id)) {
            violations.push({
                code: EXPR_DUPLICATE_ID,
                message: `Duplicate expression ID "${id}".`,
                entityType: "expression",
                entityId: id,
            })
        }
        seenIds.add(id)

        // 3c. Self-referential parent
        if (expr.parentId === id) {
            violations.push({
                code: EXPR_SELF_REFERENTIAL_PARENT,
                message: `Expression "${id}" references itself as parent.`,
                entityType: "expression",
                entityId: id,
            })
        }

        // 3d. Parent existence
        if (expr.parentId !== null && !expressions.has(expr.parentId)) {
            violations.push({
                code: EXPR_PARENT_NOT_FOUND,
                message: `Expression "${id}" references non-existent parent "${expr.parentId}".`,
                entityType: "expression",
                entityId: id,
            })
        }

        // 3e. Parent is container (operator or formula)
        if (expr.parentId !== null && expressions.has(expr.parentId)) {
            const parent = expressions.get(expr.parentId)!
            if (parent.type !== "operator" && parent.type !== "formula") {
                violations.push({
                    code: EXPR_PARENT_NOT_CONTAINER,
                    message: `Expression "${id}" has parent "${expr.parentId}" of type "${parent.type}" (expected operator or formula).`,
                    entityType: "expression",
                    entityId: id,
                })
            }
        }

        // 3f. Root-only: implies/iff must have parentId === null
        if (
            expr.type === "operator" &&
            (expr.operator === "implies" || expr.operator === "iff") &&
            expr.parentId !== null
        ) {
            violations.push({
                code: EXPR_ROOT_ONLY_VIOLATED,
                message: `Root-only operator "${expr.operator}" expression "${id}" has non-null parentId "${expr.parentId}".`,
                entityType: "expression",
                entityId: id,
            })
        }

        // The pre-v1.0 3g `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED`
        // legacy-validate() check (gated on
        // `grammarConfig.enforceFormulaBetweenOperators`) is gone.
        // P-1 is now surfaced via the grammar-tier validators —
        // call `engine.validate('presentable')` and look for the
        // `P-1` code. The `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED`
        // engine-error constant is gone in lockstep.

        // Collect positions for uniqueness check
        const parentKey = expr.parentId
        let parentPositions = positionsByParent.get(parentKey)
        if (!parentPositions) {
            parentPositions = new Map()
            positionsByParent.set(parentKey, parentPositions)
        }
        const idsAtPosition = parentPositions.get(expr.position)
        if (idsAtPosition) {
            idsAtPosition.push(id)
        } else {
            parentPositions.set(expr.position, [id])
        }

        // 3j. Checksum comparison
        const pre = preFlushChecksums.get(id)
        if (pre) {
            const fresh = expressions.get(id)!
            if (
                pre.checksum !== fresh.checksum ||
                pre.descendantChecksum !== fresh.descendantChecksum ||
                pre.combinedChecksum !== fresh.combinedChecksum
            ) {
                violations.push({
                    code: EXPR_CHECKSUM_MISMATCH,
                    message: `Expression "${id}" checksum mismatch: stored does not match recomputed.`,
                    entityType: "expression",
                    entityId: id,
                })
            }
        }
    }

    // ── 4. Child limit checks (not/formula: max 1 child) ──
    for (const [id, expr] of expressions) {
        if (
            (expr.type === "operator" && expr.operator === "not") ||
            expr.type === "formula"
        ) {
            const childIds = childExpressionIdsByParentId.get(id)
            const childCount = childIds?.size ?? 0
            if (childCount > 1) {
                const label =
                    expr.type === "formula" ? "Formula" : `Operator "not"`
                violations.push({
                    code: EXPR_CHILD_LIMIT_EXCEEDED,
                    message: `${label} expression "${id}" has ${childCount} children (max 1).`,
                    entityType: "expression",
                    entityId: id,
                })
            }
        }
    }

    // ── 5. Position uniqueness ──
    for (const [, posMap] of positionsByParent) {
        for (const [position, ids] of posMap) {
            if (ids.length > 1) {
                for (const id of ids) {
                    violations.push({
                        code: EXPR_POSITION_DUPLICATE,
                        message: `Position ${position} is shared by expressions [${ids.join(", ")}].`,
                        entityType: "expression",
                        entityId: id,
                    })
                }
            }
        }
    }

    return {
        ok: violations.length === 0,
        violations,
    }
}
