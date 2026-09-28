/**
 * Normalizes the two call forms `createPremise` / `createPremiseWithId` accept
 * — a typed options bag, or the older `(extras, symbol)` pair — into one bag.
 */
export function parsePremiseArgs(
    arg1:
        | Record<string, unknown>
        | {
              type?: "freeform" | "derivation"
              derivedClaimId?: string
              extras?: Record<string, unknown>
              symbol?: string
          }
        | undefined,
    arg2: string | undefined
): {
    type: "freeform" | "derivation"
    derivedClaimId?: string
    extras?: Record<string, unknown>
    symbol?: string
} {
    const isTypedBag =
        arg1 !== null &&
        arg1 !== undefined &&
        (typeof (arg1 as Record<string, unknown>).type === "string" ||
            typeof (arg1 as Record<string, unknown>).derivedClaimId ===
                "string")
    if (isTypedBag) {
        const bag = arg1 as {
            type?: "freeform" | "derivation"
            derivedClaimId?: string
            extras?: Record<string, unknown>
            symbol?: string
        }
        return {
            type: bag.type ?? "freeform",
            derivedClaimId: bag.derivedClaimId,
            extras: bag.extras,
            symbol: bag.symbol,
        }
    }
    return {
        type: "freeform",
        extras: arg1 as Record<string, unknown> | undefined,
        symbol: arg2,
    }
}
