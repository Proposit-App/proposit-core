import type { TCoreClaim } from "../schemata/claim.js"
import { CoreClaimSchema } from "../schemata/claim.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import type {
    TClaimLibraryManagement,
    TClaimLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import {
    CLAIM_SCHEMA_INVALID,
    CLAIM_FROZEN_NO_SUCCESSOR,
    CLAIM_TYPE_IMMUTABLE,
    LEGACY_CLAIM_MISSING_TYPE,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"
import { defaultGenerateId } from "./argument-engine.js"
import { VersionedLibrary } from "./versioned-library.js"

/**
 * Input shape for {@link ClaimLibrary.create}. The `type` field is required
 * (and immutable thereafter); `id` is auto-generated when omitted. Other
 * extension fields on `TClaim` are passed through as-is, matching the base
 * {@link VersionedLibrary.create} contract.
 */
export type TClaimCreateInput<TClaim extends TCoreClaim = TCoreClaim> =
    | Omit<TClaim, "version" | "frozen" | "checksum">
    | (Omit<TClaim, "id" | "version" | "frozen" | "checksum"> & { id?: string })

export class ClaimLibrary<TClaim extends TCoreClaim = TCoreClaim>
    extends VersionedLibrary<TClaim>
    implements TClaimLibraryManagement<TClaim>
{
    protected readonly entityLabel = "Claim"
    protected readonly entityType = "claim" as const
    protected readonly schema = CoreClaimSchema
    protected readonly checksumFieldsKey = "claimFields" as const
    protected readonly schemaInvalidCode = CLAIM_SCHEMA_INVALID
    protected readonly frozenSuccessorCode = CLAIM_FROZEN_NO_SUCCESSOR

    private readonly generateId: () => string

    constructor(options?: {
        checksumConfig?: TCoreChecksumConfig
        generateId?: () => string
    }) {
        super(options)
        this.generateId = options?.generateId ?? defaultGenerateId
    }

    /**
     * Creates a new claim at version 0. The `type` field is required and is
     * immutable across the claim's lifetime. `id` is auto-generated when omitted.
     */
    public override create(input: TClaimCreateInput<TClaim>): TClaim {
        const inputId = (input as { id?: string }).id
        const id = inputId ?? this.generateId()
        const entity = {
            ...input,
            id,
        } as Omit<TClaim, "version" | "frozen" | "checksum">
        return super.create(entity)
    }

    /**
     * Applies partial updates to the latest version of a claim. Rejects any
     * update that would change the immutable `type` field.
     */
    public override update(
        id: string,
        updates: Partial<
            Omit<TClaim, "id" | "version" | "frozen" | "checksum">
        >
    ): TClaim {
        const existing = this.getCurrent(id)
        if (
            existing !== undefined &&
            (updates as Partial<TCoreClaim>).type !== undefined &&
            (updates as Partial<TCoreClaim>).type !== existing.type
        ) {
            throw new InvariantViolationError([
                {
                    code: CLAIM_TYPE_IMMUTABLE,
                    message: `Claim "${id}" type is immutable; cannot change type from '${existing.type}' to '${(updates as Partial<TCoreClaim>).type}'`,
                    entityType: "claim",
                    entityId: id,
                },
            ])
        }
        return super.update(id, updates)
    }

    public snapshot(): TClaimLibrarySnapshot<TClaim> {
        return { claims: this.getAll() }
    }

    /**
     * Restores a claim library from a previously captured snapshot.
     * Pre-screens for legacy (pre-v0.10.0) claim entries that lack the
     * required `type` field and emits {@link LEGACY_CLAIM_MISSING_TYPE} so
     * the caller gets a clear migration signal rather than a generic schema
     * error.
     */
    public static fromSnapshot<TClaim extends TCoreClaim = TCoreClaim>(
        snapshot: TClaimLibrarySnapshot<TClaim>,
        options?: {
            checksumConfig?: TCoreChecksumConfig
            generateId?: () => string
        }
    ): ClaimLibrary<TClaim> {
        const claims = snapshot.claims ?? []
        for (const claim of claims) {
            if (
                claim === null ||
                typeof claim !== "object" ||
                !("type" in claim) ||
                (claim as { type?: unknown }).type === undefined
            ) {
                const claimId =
                    claim !== null &&
                    typeof claim === "object" &&
                    "id" in claim &&
                    typeof (claim as { id?: unknown }).id === "string"
                        ? ((claim as { id: string }).id)
                        : "<unknown>"
                throw new InvariantViolationError([
                    {
                        code: LEGACY_CLAIM_MISSING_TYPE,
                        message: `Claim "${claimId}" is missing the 'type' field, indicating pre-v0.10.0 data. Migration required.`,
                        entityType: "claim",
                        entityId: claimId,
                    },
                ])
            }
        }
        const lib = new ClaimLibrary<TClaim>(options)
        lib.restoreFromEntities(claims)
        return lib
    }
}
