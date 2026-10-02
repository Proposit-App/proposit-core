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
        respondsTo: Type.Optional(
            Type.Object(
                {
                    argumentId: UUID,
                    argumentVersion: Type.Number(),
                },
                {
                    additionalProperties: false,
                    description:
                        "Present only on a response argument: the argument it answers, pinned to one version. Absent on a standard argument, never null.",
                }
            )
        ),
    },
    {
        additionalProperties: true,
        description: "Core argument identity: ID and version number.",
    }
)
export type TCoreArgument = Static<typeof CoreArgumentSchema>

/** The argument a response answers, pinned to one version. */
export type TCoreArgumentReference = NonNullable<TCoreArgument["respondsTo"]>

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
