import Type, { type Static } from "typebox"
import { UUID } from "./shared.js"

// ---------------------------------------------------------------------------
// New entity fork record schemas
// ---------------------------------------------------------------------------

/**
 * Base schema shared by all entity fork records. Each record tracks that
 * a specific entity was created as part of a fork operation.
 *
 * No checksum field — fork records are immutable after creation.
 */
export const CoreEntityForkRecordSchema = Type.Object(
    {
        entityId: UUID,
        forkedFromEntityId: UUID,
        forkedFromArgumentId: UUID,
        forkedFromArgumentVersion: Type.Number({
            minimum: 0,
            description: "Version of the original argument at fork time",
        }),
        forkId: UUID,
    },
    { additionalProperties: true }
)

export type TCoreEntityForkRecord = Static<typeof CoreEntityForkRecordSchema>

/** Argument fork record. Identical to base. */
export const CoreArgumentForkRecordSchema = CoreEntityForkRecordSchema
export type TCoreArgumentForkRecord = TCoreEntityForkRecord

/** Premise fork record. Identical to base. */
export const CorePremiseForkRecordSchema = CoreEntityForkRecordSchema
export type TCorePremiseForkRecord = TCoreEntityForkRecord

/** Expression fork record. Adds source premise reference. */
export const CoreExpressionForkRecordSchema = Type.Intersect(
    [
        CoreEntityForkRecordSchema,
        Type.Object({
            forkedFromPremiseId: UUID,
        }),
    ],
    { additionalProperties: true }
)
export type TCoreExpressionForkRecord = Static<
    typeof CoreExpressionForkRecordSchema
>

/** Variable fork record. Identical to base. */
export const CoreVariableForkRecordSchema = CoreEntityForkRecordSchema
export type TCoreVariableForkRecord = TCoreEntityForkRecord

/** Claim fork record. Adds version tracking for independently versioned claims. */
export const CoreClaimForkRecordSchema = Type.Intersect(
    [
        CoreEntityForkRecordSchema,
        Type.Object({
            forkedFromEntityVersion: Type.Number({
                minimum: 0,
                description: "Claim version that was cloned",
            }),
        }),
    ],
    { additionalProperties: true }
)
export type TCoreClaimForkRecord = Static<typeof CoreClaimForkRecordSchema>
