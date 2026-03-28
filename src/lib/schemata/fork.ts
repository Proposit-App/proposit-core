import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

/**
 * Schema for a fork record. Represents a single fork operation — the event of
 * creating an independent copy of an argument. Create-or-delete only; fork
 * records are immutable after creation.
 */
export const CoreForkSchema = Type.Object(
    {
        id: UUID,
        sourceArgumentId: UUID,
        sourceArgumentVersion: Type.Number({
            description:
                "The version of the source argument at the time of the fork.",
        }),
        createdOn: Type.String({
            description: "ISO 8601 timestamp of when the fork was created.",
        }),
        creatorId: Type.Optional(
            Type.String({
                description: "Optional application-provided ID of the creator.",
            })
        ),
        checksum: Type.String({
            description: "Fork record checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A fork record. Extended via generics for additional fields.",
    }
)

/** A fork record entity. */
export type TCoreFork = Static<typeof CoreForkSchema>
