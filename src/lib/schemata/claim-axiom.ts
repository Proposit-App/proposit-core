import Type, { type Static } from "typebox"
import { CoreClaimConnectionSchema } from "./claim-connection.js"

export const CoreClaimAxiomSchema = Type.Object(
    {
        ...CoreClaimConnectionSchema.properties,
    },
    {
        additionalProperties: true,
        description:
            "A directional axiom-invocation edge: the claim at supportingClaimId (type='axiomatic') supports the claim at claimId (type='normal'). Extended via additionalProperties for app-level fields.",
    }
)
export type TCoreClaimAxiom = Static<typeof CoreClaimAxiomSchema>
