import Type, { type Static } from "typebox"
import { UUID, Nullable } from "./shared.js"

const VariableType = Type.Literal("variable")
const OperatorType = Type.Literal("operator")
const FormulaType = Type.Literal("formula")

export const CorePropositionalExpressionTypes = Type.Union([
    VariableType,
    OperatorType,
    FormulaType,
])
export type TCorePropositionalExpressionTypes = Static<
    typeof CorePropositionalExpressionTypes
>

const BasePropositionalExpressionSchema = Type.Object({
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    premiseId: UUID,
    parentId: Nullable(UUID, {
        description:
            "The ID of the parent operator expression, or null if this is a top-level expression.",
    }),

    position: Type.Number({
        description:
            "The ordering of this expression among its siblings under the same parent. Must be unique within (parentId, argumentId, argumentVersion).",
    }),

    checksum: Type.String({
        description: "Entity-level checksum for sync detection.",
    }),
})

export const CorePropositionalVariableExpressionSchema = Type.Interface(
    [BasePropositionalExpressionSchema],
    {
        type: VariableType,
        variableId: UUID,
    }
)

export type TCorePropositionalVariableExpression = Static<
    typeof CorePropositionalVariableExpressionSchema
>

export const CoreLogicalOperatorType = Type.Union([
    Type.Literal("not"), // unary
    Type.Literal("and"), // variadic (≥2)
    Type.Literal("or"), // variadic (≥2)
    Type.Literal("implies"), // binary (ordered)
    Type.Literal("iff"), // binary (unordered but fixed 2)
])

export type TCoreLogicalOperatorType = Static<typeof CoreLogicalOperatorType>

export const CoreOperatorExpressionSchema = Type.Interface(
    [BasePropositionalExpressionSchema],
    {
        type: OperatorType,
        operator: CoreLogicalOperatorType,
    }
)
export type TCoreOperatorExpression = Static<
    typeof CoreOperatorExpressionSchema
>

export const CoreFormulaExpressionSchema = Type.Interface(
    [BasePropositionalExpressionSchema],
    {
        type: FormulaType,
    }
)
export type TCoreFormulaExpression = Static<typeof CoreFormulaExpressionSchema>

export const CorePropositionalExpressionSchema = Type.Union([
    CorePropositionalVariableExpressionSchema,
    CoreOperatorExpressionSchema,
    CoreFormulaExpressionSchema,
])

export type TCorePropositionalExpressionCombined = Static<
    typeof CorePropositionalExpressionSchema
>

export type TCorePropositionalExpression<
    T extends TCorePropositionalExpressionTypes =
        TCorePropositionalExpressionTypes,
> = Extract<TCorePropositionalExpressionCombined, { type: T }>

const CoreVariableBaseFields = {
    id: UUID,
    argumentId: UUID,
    argumentVersion: Type.Number(),
    symbol: Type.String({
        description: 'Human-readable symbol for this variable (e.g. "P", "Q").',
    }),
    checksum: Type.String({
        description: "Entity-level checksum for sync detection.",
    }),
}

export const CoreClaimBoundVariableSchema = Type.Object(
    {
        ...CoreVariableBaseFields,
        claimId: UUID,
        claimVersion: Type.Number({
            description: "The version of the claim this variable references.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A claim-bound propositional variable referencing a global claim.",
    }
)

export type TClaimBoundVariable = Static<typeof CoreClaimBoundVariableSchema>

export const CorePremiseBoundVariableSchema = Type.Object(
    {
        ...CoreVariableBaseFields,
        boundPremiseId: UUID,
        boundArgumentId: UUID,
        boundArgumentVersion: Type.Number({
            description:
                "The version of the argument that owns the bound premise.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A premise-bound propositional variable whose truth value is derived from another premise's evaluation.",
    }
)

export type TPremiseBoundVariable = Static<
    typeof CorePremiseBoundVariableSchema
>

export const CorePropositionalVariableSchema = Type.Union([
    CoreClaimBoundVariableSchema,
    CorePremiseBoundVariableSchema,
])

export type TCorePropositionalVariable = Static<
    typeof CorePropositionalVariableSchema
>

/** Type guard: returns `true` if the variable is claim-bound. */
export function isClaimBound(
    v: TCorePropositionalVariable
): v is TClaimBoundVariable {
    return "claimId" in v
}

/** Type guard: returns `true` if the variable is premise-bound. */
export function isPremiseBound(
    v: TCorePropositionalVariable
): v is TPremiseBoundVariable {
    return "boundPremiseId" in v
}

export const CorePremiseSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        checksum: Type.String({
            description: "Premise-level checksum for sync detection.",
        }),
    },
    {
        additionalProperties: true,
        description:
            "A premise entity with identity and metadata. Expressions and variables are managed by PremiseEngine.",
    }
)

export type TCorePremise = Static<typeof CorePremiseSchema>
