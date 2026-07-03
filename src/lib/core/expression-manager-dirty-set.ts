import type { TCorePropositionalExpression } from "../schemata/index.js"
import type { ChangeCollector } from "./change-collector.js"
import type { TLogicEngineOptions } from "./argument-engine.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum, computeHash, canonicalSerialize } from "./checksum.js"

/**
 * Marks an expression and all its ancestors as dirty for hierarchical
 * checksum recomputation. Stops early when it reaches an expression
 * already in the dirty set (since its ancestors are already marked).
 */
export function markExpressionDirty<TExpr extends TCorePropositionalExpression>(
    exprId: string,
    dirtyExpressionIds: Set<string>,
    expressions: Map<string, TExpr>
): void {
    let current: string | null = exprId
    while (current !== null) {
        if (dirtyExpressionIds.has(current)) break // ancestors already dirty
        dirtyExpressionIds.add(current)
        const expr = expressions.get(current)
        current = expr ? expr.parentId : null
    }
}

/**
 * Recomputes `descendantChecksum` and `combinedChecksum` for all dirty
 * expressions, processing bottom-up (deepest first) so that children
 * are up-to-date before their parents are computed.
 */
export function flushExpressionChecksums<
    TExpr extends TCorePropositionalExpression,
>(
    dirtyExpressionIds: Set<string>,
    expressions: Map<string, TExpr>,
    childExpressionIdsByParentId: Map<string | null, Set<string>>,
    config: TLogicEngineOptions | undefined,
    collector: ChangeCollector | null
): void {
    if (dirtyExpressionIds.size === 0) return

    // Sort dirty expressions by depth (deepest first) for bottom-up processing
    const dirtyIds = [...dirtyExpressionIds]
    const depthOf = (id: string): number => {
        let depth = 0
        let current = expressions.get(id)
        while (current && current.parentId !== null) {
            depth++
            current = expressions.get(current.parentId)
        }
        return depth
    }
    dirtyIds.sort((a, b) => depthOf(b) - depthOf(a))

    const fields =
        config?.checksumConfig?.expressionFields ??
        DEFAULT_CHECKSUM_CONFIG.expressionFields!

    for (const id of dirtyIds) {
        const expr = expressions.get(id)
        if (!expr) continue

        const oldChecksum = expr.checksum
        const oldDescendantChecksum = expr.descendantChecksum
        const oldCombinedChecksum = expr.combinedChecksum

        const metaChecksum = entityChecksum(
            expr as unknown as Record<string, unknown>,
            fields
        )

        const childIds = childExpressionIdsByParentId.get(id)
        let descendantChecksum: string | null = null
        if (childIds && childIds.size > 0) {
            const childMap: Record<string, string> = {}
            for (const childId of childIds) {
                const child = expressions.get(childId)
                if (child) {
                    childMap[childId] = child.combinedChecksum
                }
            }
            descendantChecksum = computeHash(canonicalSerialize(childMap))
        }

        const combinedChecksum =
            descendantChecksum === null
                ? metaChecksum
                : computeHash(metaChecksum + descendantChecksum)

        expressions.set(id, {
            ...expr,
            checksum: metaChecksum,
            descendantChecksum,
            combinedChecksum,
        } as TExpr)

        if (
            collector &&
            !collector.isExpressionAdded(expr.id) &&
            (metaChecksum !== oldChecksum ||
                descendantChecksum !== oldDescendantChecksum ||
                combinedChecksum !== oldCombinedChecksum)
        ) {
            collector.modifiedExpression({
                ...expr,
                checksum: metaChecksum,
                descendantChecksum,
                combinedChecksum,
            } as TExpr)
        }
    }

    dirtyExpressionIds.clear()
}

/**
 * Removes deleted expression IDs from the dirty set so that flush
 * doesn't attempt to process expressions that no longer exist.
 */
export function pruneDeletedFromDirtySet(
    deletedIds: Set<string>,
    dirtyExpressionIds: Set<string>
): void {
    for (const id of deletedIds) {
        dirtyExpressionIds.delete(id)
    }
}
