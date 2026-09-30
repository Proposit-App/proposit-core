// `role-derivation` — pure helper that returns each claim's role
// (`'conclusion'` | `'premise'` | `'intermediate'`).
//
// It copies the role already recorded on each parsed claim
// (`claims[].role`) into a `claimMiniId -> role` map; it does not
// work anything out from the premise or relation graph.

import type { TParsedClaim } from "../../../lib/parsing/index.js"

export type TClaimRole = "conclusion" | "premise" | "intermediate"

export type TDeriveRolesInput = {
    claims: readonly TParsedClaim[]
}

/**
 * Returns a `claimMiniId -> role` map, taking each claim's role as
 * recorded on the claim itself.
 */
export function deriveRoles(
    input: TDeriveRolesInput
): Record<string, TClaimRole> {
    const out: Record<string, TClaimRole> = {}
    for (const claim of input.claims) {
        out[claim.miniId] = claim.role
    }
    return out
}
