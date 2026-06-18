// `claim-reference-validation` — deterministic stage that audits the
// `claim-canonicalization` output for internal consistency.
//
// Emits a `ProcessingFailure` (via `ctx.addFailure`) for each of:
//   - **miniId collision** — two canonical claims share the same
//     `miniId`.
//   - **dangling mapping** — `mentionToClaim` references a `miniId`
//     that isn't in `canonicalClaims`.
//   - **empty mention id** — `mentionToClaim` key is empty/whitespace.
//   - **empty mention list on a claim** — a claim's `mentionIds` is
//     empty (a canonicalizer-internal bug; every canonical claim
//     should map back to ≥1 mention).
//
// Doesn't gate downstream (failures are informational; the stage's
// return value mirrors the emitted failures for any downstream stage
// that wants to consult them, but most don't).

import {
    STAGE_IDS,
    ValidationStageOutputSchema,
    type TClaimCanonicalizationOutput,
    type TValidationStageOutput,
} from "./schemas.js"
import { deterministicStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage } from "../../../../lib/pipelines/types.js"

export const CLAIM_REFERENCE_FAILURE_CODES = {
    miniIdCollision: "CLAIM_MINIID_COLLISION",
    danglingMapping: "CLAIM_MENTION_MAPPING_DANGLING",
    emptyMentionId: "CLAIM_MENTION_ID_EMPTY",
    emptyMentionList: "CLAIM_MENTION_LIST_EMPTY",
} as const

export type TClaimReferenceFailureContext =
    | {
          code: "CLAIM_MINIID_COLLISION"
          claimMiniId: string
          occurrences: number
      }
    | {
          code: "CLAIM_MENTION_MAPPING_DANGLING"
          mentionId: string
          unknownClaimMiniId: string
      }
    | { code: "CLAIM_MENTION_ID_EMPTY"; targetClaimMiniId: string }
    | { code: "CLAIM_MENTION_LIST_EMPTY"; claimMiniId: string }

/**
 * Pure helper exposed for direct testing. Returns the list of
 * failures the stage will emit; the stage wrapper also calls
 * `ctx.addFailure` on each.
 */
export function validateClaimReferences(canon: TClaimCanonicalizationOutput): {
    failures: {
        code: string
        message: string
        context: Record<string, unknown>
    }[]
} {
    const failures: {
        code: string
        message: string
        context: Record<string, unknown>
    }[] = []

    // 1. miniId collisions.
    const miniIdCounts = new Map<string, number>()
    for (const claim of canon.canonicalClaims) {
        miniIdCounts.set(
            claim.miniId,
            (miniIdCounts.get(claim.miniId) ?? 0) + 1
        )
    }
    for (const [miniId, count] of miniIdCounts) {
        if (count > 1) {
            failures.push({
                code: CLAIM_REFERENCE_FAILURE_CODES.miniIdCollision,
                message: `Canonical claim miniId "${miniId}" appears ${String(
                    count
                )} times; miniIds must be unique within a single pipeline run.`,
                context: { claimMiniId: miniId, occurrences: count },
            })
        }
    }

    const knownMiniIds = new Set(canon.canonicalClaims.map((c) => c.miniId))

    // 2. mentionToClaim dangling references + empty mention ids.
    // mentionToClaim is now a list of { mentionId, claimMiniId }
    // entries (lambda-fold 4 — OpenAI strict-mode doesn't accept
    // Record-shaped maps with arbitrary string keys).
    for (const entry of canon.mentionToClaim) {
        const { mentionId, claimMiniId } = entry
        if (mentionId.trim().length === 0) {
            failures.push({
                code: CLAIM_REFERENCE_FAILURE_CODES.emptyMentionId,
                message: `mentionToClaim has an empty/whitespace mention id targeting claim "${claimMiniId}".`,
                context: { targetClaimMiniId: claimMiniId },
            })
            continue
        }
        if (!knownMiniIds.has(claimMiniId)) {
            failures.push({
                code: CLAIM_REFERENCE_FAILURE_CODES.danglingMapping,
                message: `mentionToClaim entry "${mentionId}" points at claim "${claimMiniId}" which is not in canonicalClaims.`,
                context: {
                    mentionId,
                    unknownClaimMiniId: claimMiniId,
                },
            })
        }
    }

    // 3. claims with empty mentionIds.
    for (const claim of canon.canonicalClaims) {
        if (claim.mentionIds.length === 0) {
            failures.push({
                code: CLAIM_REFERENCE_FAILURE_CODES.emptyMentionList,
                message: `Canonical claim "${claim.miniId}" has an empty mentionIds list; every canonical claim must reference at least one mention.`,
                context: { claimMiniId: claim.miniId },
            })
        }
    }

    return { failures }
}

export const claimReferenceValidationStage: TStage<TValidationStageOutput> =
    deterministicStage<TValidationStageOutput>({
        id: STAGE_IDS.claimReferenceValidation,
        dependsOn: [STAGE_IDS.claimCanonicalization],
        outputSchema: ValidationStageOutputSchema,
        fn: (ctx) => {
            const canon = ctx.get<TClaimCanonicalizationOutput>(
                STAGE_IDS.claimCanonicalization
            )
            if (!canon) return []
            const { failures } = validateClaimReferences(canon)
            for (const f of failures) {
                ctx.addFailure({
                    code: f.code,
                    message: f.message,
                    severity: "warning",
                    context: f.context,
                })
            }
            return failures.map((f) => ({
                code: f.code,
                message: f.message,
                context: f.context,
            }))
        },
    })
