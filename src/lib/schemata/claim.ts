import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreClaimSchema = Type.Object(
    {
        id: UUID,
        version: Type.Number({
            description: "Claim version number. Starts at 0.",
        }),
        frozen: Type.Boolean({
            description:
                "Whether this version is frozen (immutable). Frozen versions cannot be updated.",
        }),
        checksum: Type.String({
            description: "Entity-level checksum for sync detection.",
        }),
        type: Type.Union(
            [Type.Literal("normal"), Type.Literal("citation")],
            {
                description:
                    "Distinguishes a primary-reasoning claim ('normal') from a cited external-content claim ('citation'). Immutable post-creation.",
            }
        ),
    },
    {
        additionalProperties: true,
        description:
            "A global claim representing propositional content. Variables reference claims by ID and version.",
    }
)
export type TCoreClaim = Static<typeof CoreClaimSchema>
