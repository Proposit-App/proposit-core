import Type, { type Static, type TObject, type TSchema } from "typebox"
import { Nullable } from "../schemata/shared.js"
import type { TParsingSchemaOptions } from "./types.js"

export const ParsedClaimRoleType = Type.Union([
    Type.Literal("premise"),
    Type.Literal("conclusion"),
    Type.Literal("intermediate"),
])

export const ParsedClaimSchema = Type.Object(
    {
        miniId: Type.String(),
        role: ParsedClaimRoleType,
        sourceMiniIds: Type.Array(Type.String()),
    },
    { additionalProperties: true }
)
export type TParsedClaim = Static<typeof ParsedClaimSchema>

export const ParsedVariableSchema = Type.Object(
    {
        miniId: Type.String(),
        symbol: Type.String(),
        claimMiniId: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedVariable = Static<typeof ParsedVariableSchema>

export const ParsedSourceSchema = Type.Object(
    {
        miniId: Type.String(),
        text: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedSource = Static<typeof ParsedSourceSchema>

export const ParsedPremiseSchema = Type.Object(
    {
        miniId: Type.String(),
        formula: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedPremise = Static<typeof ParsedPremiseSchema>

export const ParsedArgumentSchema = Type.Object(
    {
        claims: Type.Array(ParsedClaimSchema, { minItems: 1 }),
        variables: Type.Array(ParsedVariableSchema, { minItems: 1 }),
        sources: Type.Array(ParsedSourceSchema),
        premises: Type.Array(ParsedPremiseSchema, { minItems: 1 }),
        conclusionPremiseMiniId: Type.String(),
    },
    { additionalProperties: true }
)
export type TParsedArgument = Static<typeof ParsedArgumentSchema>

export const ParsedArgumentResponseSchema = Type.Object(
    {
        argument: Nullable(ParsedArgumentSchema),
        uncategorizedText: Nullable(Type.String()),
        selectionRationale: Nullable(Type.String()),
        failureText: Nullable(Type.String()),
    },
    { additionalProperties: true }
)
export type TParsedArgumentResponse = Static<typeof ParsedArgumentResponseSchema>
