import Type, { type Static } from "typebox"
import { CoreClaimConnectionSchema } from "./claim-connection.js"

export const CoreClaimCitationSchema = Type.Object(
    {
        ...CoreClaimConnectionSchema.properties,
    },
    {
        additionalProperties: true,
        description:
            "A directional citation edge: the claim at supportingClaimId is cited as evidence for the claim at claimId. The supporting-side endpoint must reference a claim with type='citation'. Extended via additionalProperties for app-level fields.",
    }
)
export type TCoreClaimCitation = Static<typeof CoreClaimCitationSchema>
