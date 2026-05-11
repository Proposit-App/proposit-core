import Type, { type Static } from "typebox"

export const CoreClaimConnectionSchema = Type.Object(
    {
        id: Type.String({
            description: "Unique identifier for this connection.",
        }),
        claimId: Type.String({
            description: "The claim being supported.",
        }),
        claimVersion: Type.Number({
            description:
                "Version of the supported claim this connection pins to.",
        }),
        supportingClaimId: Type.String({
            description:
                "The claim that supplies the support — cited evidence or invoked axiom.",
        }),
        supportingClaimVersion: Type.Number({
            description:
                "Version of the supporting claim this connection pins to.",
        }),
        checksum: Type.String({
            description: "Connection checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A directional support edge between two claims. The supported claim is at claimId; the claim that supplies the support is at supportingClaimId. Specialized into citation and axiom connections by which library the entity lives in.",
    }
)
export type TCoreClaimConnection = Static<typeof CoreClaimConnectionSchema>
