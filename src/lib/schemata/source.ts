import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreSourceSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number({
            description: "Source version number. Starts at 0.",
        }),
        frozen: Type.Boolean({
            description:
                "Whether this version is frozen (immutable). Frozen versions cannot be updated.",
        }),
        checksum: Type.String({
            description: "Source-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A global source entity providing evidentiary support for variables or expressions.",
    }
)
export type TCoreSource = Static<typeof CoreSourceSchema>

export const CoreClaimSourceAssociationSchema = Type.Object(
    {
        id: UUID,
        claimId: UUID,
        claimVersion: Type.Number({
            description: "The version of the claim this association pins to.",
        }),
        sourceId: UUID,
        sourceVersion: Type.Number({
            description: "The version of the source this association pins to.",
        }),
        checksum: Type.String({
            description: "Association checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "An association between a claim and a source. Extended via generics for additional fields (e.g., createdBy).",
    }
)
export type TCoreClaimSourceAssociation = Static<
    typeof CoreClaimSourceAssociationSchema
>
