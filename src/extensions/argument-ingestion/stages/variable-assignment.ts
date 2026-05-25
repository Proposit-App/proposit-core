// `variable-assignment` — deterministic stage that mints one
// `TParsedVariable`-shaped record per canonical claim.
//
// Behavior (spec §7.2 row 8):
//   1. Read `claim-canonicalization.canonicalClaims` (in canonicalization
//      order).
//   2. For each claim, attempt to use its `suggestedSymbol` as the
//      variable symbol. The symbol is valid iff it matches the regex
//      `/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/` AND is unique among already-
//      assigned variable symbols.
//   3. If the suggested symbol is invalid or already used, fall back to
//      `p1`, `p2`, `p3`, ... where the integer is the smallest one not
//      already used by any valid suggested symbol or earlier fallback.
//   4. Mint a fresh variable `miniId` (separate from the claim's
//      `miniId`) via `ctx.generateId` for each output record. Tests use
//      a deterministic stub generator that produces `v1`, `v2`, ...
//
// The framework default `ctx.generateId` is `crypto.randomUUID()`; the
// recording-replay tests inject a deterministic counter so the
// recorded fixtures stay stable.
//
// Errors / failures: this stage never throws and emits no
// `ProcessingFailure`s. Empty input simply yields an empty array.

import {
    STAGE_IDS,
    VariableAssignmentOutputSchema,
    type TAssignedVariable,
    type TClaimCanonicalizationOutput,
    type TVariableAssignmentOutput,
} from "./schemas.js"
import { deterministicStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage } from "../../../lib/pipelines/types.js"

const SYMBOL_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/

export function isValidVariableSymbol(symbol: string): boolean {
    if (symbol.length === 0) return false
    if (symbol.length > 32) return false
    return SYMBOL_REGEX.test(symbol)
}

export type TAssignVariablesInput = {
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"]
    generateId: () => string
}

/**
 * Pure helper exposed for direct unit testing. The `variable-assignment`
 * stage is a thin wrapper that reads `ctx.get(claim-canonicalization)`
 * and calls this function with `ctx.generateId`.
 */
export function assignVariables(
    input: TAssignVariablesInput
): TVariableAssignmentOutput {
    const out: TAssignedVariable[] = []
    const usedSymbols = new Set<string>()
    let fallbackCounter = 1

    for (const claim of input.canonicalClaims) {
        let symbol: string
        const suggested = claim.suggestedSymbol
        if (isValidVariableSymbol(suggested) && !usedSymbols.has(suggested)) {
            symbol = suggested
        } else {
            // Walk fallback counter to the next unused `p<n>`.
            while (usedSymbols.has(`p${fallbackCounter}`)) {
                fallbackCounter += 1
            }
            symbol = `p${fallbackCounter}`
            fallbackCounter += 1
        }
        usedSymbols.add(symbol)
        out.push({
            miniId: input.generateId(),
            symbol,
            claimMiniId: claim.miniId,
        })
    }
    return out
}

export const variableAssignmentStage: TStage<TVariableAssignmentOutput> =
    deterministicStage<TVariableAssignmentOutput>({
        id: STAGE_IDS.variableAssignment,
        dependsOn: [STAGE_IDS.claimCanonicalization],
        outputSchema: VariableAssignmentOutputSchema,
        fn: (ctx) => {
            const canon = ctx.get<TClaimCanonicalizationOutput>(
                STAGE_IDS.claimCanonicalization
            )
            if (!canon) {
                // Required dep — executor wouldn't have scheduled us
                // without it. Defensive: empty array if it somehow
                // arrived.
                return []
            }
            return assignVariables({
                canonicalClaims: canon.canonicalClaims,
                generateId: ctx.generateId,
            })
        },
    })
