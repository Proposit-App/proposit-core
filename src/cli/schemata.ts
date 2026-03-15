import Type, { type Static } from "typebox"
import { CoreLogicalOperatorType } from "../lib/schemata/propositional.js"
import { EncodableDate, Nullable, UUID } from "../lib/schemata/shared.js"

// ---------------------------------------------------------------------------
// Argument meta (stored in arguments/<id>/meta.json)
// Flat fields: { id, title, description? }
// ---------------------------------------------------------------------------
export const CliArgumentMetaSchema = Type.Object(
    {
        id: UUID,
        title: Type.String(),
        description: Type.Optional(Type.String()),
    },
    { additionalProperties: Type.String() }
)
export type TCliArgumentMeta = Static<typeof CliArgumentMetaSchema>

// ---------------------------------------------------------------------------
// Version meta (stored in arguments/<id>/<version>/meta.json)
// { version, createdAt, published, publishedAt? }
// ---------------------------------------------------------------------------
export const CliArgumentVersionMetaSchema = Type.Object({
    version: Type.Number(),
    createdAt: EncodableDate,
    published: Type.Boolean(),
    publishedAt: Type.Optional(EncodableDate),
})
export type TCliArgumentVersionMeta = Static<
    typeof CliArgumentVersionMetaSchema
>

// ---------------------------------------------------------------------------
// Full CLI argument (core identity + CLI-specific flat fields)
// Uses optional checksum for backward-compatible disk reads.
// ---------------------------------------------------------------------------
export const CliArgumentSchema = Type.Object({
    id: UUID,
    version: Type.Number(),
    checksum: Type.Optional(Type.String()),
    title: Type.String(),
    description: Type.Optional(Type.String()),
    createdAt: EncodableDate,
    published: Type.Boolean(),
    publishedAt: Type.Optional(EncodableDate),
})
export type TCliArgument = Static<typeof CliArgumentSchema>

// ---------------------------------------------------------------------------
// Premise meta (stored in premises/<id>/meta.json)
// Flat fields: { id, title? }
// ---------------------------------------------------------------------------
export const CliPremiseMetaSchema = Type.Object(
    {
        id: UUID,
        title: Type.Optional(Type.String()),
    },
    { additionalProperties: Type.String() }
)
export type TCliPremiseMeta = Static<typeof CliPremiseMetaSchema>

// ---------------------------------------------------------------------------
// CLI expression schema — optional checksum for backward-compatible disk reads
// ---------------------------------------------------------------------------
const CliBaseExpressionSchema = Type.Object({
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    premiseId: Type.Optional(UUID),
    parentId: Nullable(UUID),
    position: Type.Number(),
    checksum: Type.Optional(Type.String()),
})

const CliExpressionSchema = Type.Union([
    Type.Interface([CliBaseExpressionSchema], {
        type: Type.Literal("variable"),
        variableId: UUID,
    }),
    Type.Interface([CliBaseExpressionSchema], {
        type: Type.Literal("operator"),
        operator: CoreLogicalOperatorType,
    }),
    Type.Interface([CliBaseExpressionSchema], {
        type: Type.Literal("formula"),
    }),
])

// ---------------------------------------------------------------------------
// Premise data (stored in premises/<id>/data.json)
// { rootExpressionId?, variables, expressions }
// ---------------------------------------------------------------------------
export const CliPremiseDataSchema = Type.Object({
    rootExpressionId: Type.Optional(
        Type.String({
            description:
                "ID of the root expression, if the premise has expressions.",
        })
    ),
    variables: Type.Array(UUID, {
        description: "IDs of all variables referenced in this premise.",
    }),
    expressions: Type.Array(CliExpressionSchema, {
        description:
            "All expressions in this premise. The root has a null parentId.",
    }),
})
export type TCliPremiseData = Static<typeof CliPremiseDataSchema>
