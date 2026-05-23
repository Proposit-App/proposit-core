// `role-derivation` — pure helper that assigns each claim a role
// (`'conclusion'` | `'premise'` | `'intermediate'`) given the
// argument's premise/variable graph + the selected conclusion premise.
//
// v1 is trivial: the LLM already emits per-claim roles in its
// `parsed.argument.claims[].role` field; v1's pipeline just trusts
// that assignment and `deriveRoles` returns the LLM-provided map.
//
// v2 will derive roles from the relations graph + selected conclusion
// (the LLM no longer self-assigns roles in the multi-stage pipeline).
// The helper signature is forward-compatible: it accepts a generic
// `claims` collection plus the selected conclusion premise miniId and
// the per-premise variable wiring, so v2 can swap in a real
// derivation without breaking v1 callers.

import type { TParsedClaim } from "../../../lib/parsing/index.js"

export type TClaimRole = "conclusion" | "premise" | "intermediate"

export type TDeriveRolesInput = {
    claims: readonly TParsedClaim[]
}

/**
 * Returns a `claimMiniId -> role` map. v1 trusts the LLM's
 * self-assigned roles; v2 will compute roles from premise relations.
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
