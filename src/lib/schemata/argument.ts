import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreArgumentMetaSchema = Type.Object(
    {
        id: UUID,
        title: Type.String(),
        description: Type.String(),
    },
    {
        description:
            "Metadata for an argument that does not change for different versions of the same argument.",
    }
)
export type TCoreArgumentMeta = Static<typeof CoreArgumentMetaSchema>

export const CoreArgumentVersionedSchema = Type.Object(
    {
        version: Type.Number(),
        createdAt: Type.Number({
            description:
                "Unix timestamp in milliseconds of when the argument was created.",
            default: () => Date.now(),
        }),
    },
    {
        description:
            "Data for an argument that will differ between different versions of the same argument",
    }
)
export type TCoreArgumentVersioned = Static<typeof CoreArgumentVersionedSchema>

export const CoreArgumentMutableDataSchema = Type.Object(
    {
        published: Type.Boolean(),
        publishedAt: Type.Optional(
            Type.Number({
                description:
                    "Unix timestamp in milliseconds of when the argument was published.",
            })
        ),
    },
    {
        description:
            "Data for an argument that can be changed (e.g. published status).",
    }
)
export type TCoreArgumentMutableData = Static<
    typeof CoreArgumentMutableDataSchema
>

export const CoreArgumentSchema = Type.Intersect([
    CoreArgumentMetaSchema,
    CoreArgumentVersionedSchema,
    CoreArgumentMutableDataSchema,
])
export type TCoreArgument = Static<typeof CoreArgumentSchema>

export const CoreArgumentVersionMetaSchema = Type.Intersect([
    CoreArgumentVersionedSchema,
    CoreArgumentMutableDataSchema,
])
export type TCoreArgumentVersionMeta = Static<
    typeof CoreArgumentVersionMetaSchema
>

export const CoreArgumentRoleStateSchema = Type.Object(
    {
        conclusionPremiseId: Type.Optional(UUID),
        supportingPremiseIds: Type.Array(UUID),
    },
    {
        description:
            "Tracks which premises serve as the conclusion and which are supporting.",
    }
)
export type TCoreArgumentRoleState = Static<typeof CoreArgumentRoleStateSchema>
