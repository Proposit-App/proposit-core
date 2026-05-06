import Type, { type Static } from "typebox"

export const CoreClaimCitationSchema = Type.Object(
    {
        id: Type.String({
            description: "Unique identifier for this citation edge.",
        }),
        citingClaimId: Type.String({
            description: "The claim that cites — the 'cites' end of the edge.",
        }),
        citingClaimVersion: Type.Number({
            description:
                "The version of the citing claim this citation pins to.",
        }),
        sourceClaimId: Type.String({
            description:
                "The claim being cited as evidence — the 'cited' end of the edge. Must reference a claim with type='citation'.",
        }),
        sourceClaimVersion: Type.Number({
            description:
                "The version of the source claim this citation pins to.",
        }),
        checksum: Type.String({
            description: "Citation checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "An edge in the global claim citation graph: the claim at sourceClaimId is cited as evidence for the claim at citingClaimId. The source-side endpoint must reference a claim with type='citation'. Extended via additionalProperties for app-level fields.",
    }
)
export type TCoreClaimCitation = Static<typeof CoreClaimCitationSchema>
