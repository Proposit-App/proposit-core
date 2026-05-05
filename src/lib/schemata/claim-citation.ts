import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreClaimCitationSchema = Type.Object(
    {
        id: UUID,
        citingClaimId: UUID,
        citingClaimVersion: Type.Number({
            description:
                "The version of the citing claim this citation pins to.",
        }),
        sourceClaimId: UUID,
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
