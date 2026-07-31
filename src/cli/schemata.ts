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
// Premise meta (stored in premises/<id>/meta.json)
// Flat fields: { id, title?, enthymeme? }
//
// `additionalProperties` is a string schema, so any non-string core field has
// to be declared here explicitly or a premise carrying it fails to read back.
// ---------------------------------------------------------------------------
export const CliPremiseMetaSchema = Type.Object(
    {
        id: UUID,
        title: Type.Optional(Type.String()),
        // Optional and `true`-only, mirroring the core schema: a premise that
        // omits the key hashes as it did before the field existed, while a
        // stored `null` or `false` would shift the checksum of every premise
        // on disk.
        enthymeme: Type.Optional(Type.Literal(true)),
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
    descendantChecksum: Type.Optional(Nullable(Type.String())),
    combinedChecksum: Type.Optional(Type.String()),
})

const CliExpressionSchema = Type.Union([
    Type.Interface([CliBaseExpressionSchema], {
        type: Type.Literal("variable"),
        variableId: UUID,
        // Optional and `true`-only, mirroring the core schema: an expression
        // that omits the key hashes as it did before the field existed, while
        // a stored `null` or `false` would shift the checksum of every
        // expression on disk.
        enthymeme: Type.Optional(Type.Literal(true)),
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

// ---------------------------------------------------------------------------
// Axiomatic claim reason codes (v0.12)
// ---------------------------------------------------------------------------
export const CliAxiomReasonCode = Type.Union([
    Type.Literal("true-by-definition"),
    Type.Literal("historically-established"),
    Type.Literal("logically-required"),
])
export type TCliAxiomReasonCode = Static<typeof CliAxiomReasonCode>

export const CLI_AXIOM_REASON_CODES: readonly TCliAxiomReasonCode[] = [
    "true-by-definition",
    "historically-established",
    "logically-required",
]
