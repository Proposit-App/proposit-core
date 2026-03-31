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
} from "../types/validation.js"
import { VersionedLibrary } from "./versioned-library.js"

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

    public snapshot(): TClaimLibrarySnapshot<TClaim> {
        return { claims: this.getAll() }
    }

    /** Restores a claim library from a previously captured snapshot. */
    public static fromSnapshot<TClaim extends TCoreClaim = TCoreClaim>(
        snapshot: TClaimLibrarySnapshot<TClaim>,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimLibrary<TClaim> {
        const lib = new ClaimLibrary<TClaim>(options)
        lib.restoreFromEntities(snapshot.claims)
        return lib
    }
}
