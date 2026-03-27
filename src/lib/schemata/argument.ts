import Type, { type Static } from "typebox"
import { Nullable, UUID } from "./shared.js"

export const CoreArgumentSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number(),
        checksum: Type.String({
            description: "Argument-level checksum for sync detection.",
        }),
        descendantChecksum: Nullable(Type.String(), {
            description:
                "Checksum derived from premises and variables collections. Null if argument has no descendants.",
        }),
        combinedChecksum: Type.String({
            description:
                "Hash of checksum + descendantChecksum. Equals checksum when descendantChecksum is null.",
        }),
        forkedFromArgumentId: Type.Optional(
            Nullable(UUID, {
                description:
                    "The ID of the argument this was forked from, or null if not a fork.",
            })
        ),
        forkedFromArgumentVersion: Type.Optional(
            Nullable(Type.Number(), {
                description:
                    "The version of the argument this was forked from, or null if not a fork.",
            })
        ),
    },
    {
        additionalProperties: true,
        description: "Core argument identity: ID and version number.",
    }
)
export type TCoreArgument = Static<typeof CoreArgumentSchema>

export const CoreArgumentRoleStateSchema = Type.Object(
    {
        conclusionPremiseId: Type.Optional(UUID),
    },
    {
        description:
            "Tracks which premise serves as the conclusion. Supporting premises are derived from expression type.",
    }
)
export type TCoreArgumentRoleState = Static<typeof CoreArgumentRoleStateSchema>
