import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

export const CoreSourceSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        checksum: Type.String({
            description: "Source-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A source entity providing evidentiary support for variables or expressions.",
    }
)
export type TCoreSource = Static<typeof CoreSourceSchema>

export const CoreVariableSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    variableId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String({
        description: "Association checksum for sync detection.",
    }),
})
export type TCoreVariableSourceAssociation = Static<
    typeof CoreVariableSourceAssociationSchema
>

export const CoreExpressionSourceAssociationSchema = Type.Object({
    id: UUID,
    sourceId: UUID,
    expressionId: UUID,
    premiseId: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    checksum: Type.String({
        description: "Association checksum for sync detection.",
    }),
})
export type TCoreExpressionSourceAssociation = Static<
    typeof CoreExpressionSourceAssociationSchema
>
