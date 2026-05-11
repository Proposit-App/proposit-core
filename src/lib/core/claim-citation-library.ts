import { Value } from "typebox/value"
import type { TCoreClaimCitation } from "../schemata/claim-citation.js"
import { CoreClaimCitationSchema } from "../schemata/claim-citation.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TClaimLookup,
    TClaimConnectionLibraryManagement,
    TClaimConnectionLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    CITATION_SCHEMA_INVALID,
    CITATION_DUPLICATE_ID,
    CITATION_CLAIM_REF_NOT_FOUND,
    CITATION_SUPPORTING_REF_NOT_FOUND,
    CITATION_SUPPORTING_NOT_CITATION_TYPE,
    CITATION_CYCLE_DETECTED,
    LEGACY_CLAIM_CITATION_SHAPE,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

export class ClaimCitationLibrary<
    TCitation extends TCoreClaimCitation = TCoreClaimCitation,
> implements TClaimConnectionLibraryManagement<TCitation> {
    private citations: Map<string, TCitation>
    private claimToConnections: Map<string, Set<string>>
    private claimLookup: TClaimLookup
    private checksumConfig?: TCoreChecksumConfig

    constructor(
        claimLookup: TClaimLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ) {
        this.citations = new Map()
        this.claimToConnections = new Map()
        this.claimLookup = claimLookup
        this.checksumConfig = options?.checksumConfig
    }

    private restoreFromSnapshot(
        snap: TClaimConnectionLibrarySnapshot<TCitation>
    ): void {
        this.citations = new Map()
        this.claimToConnections = new Map()
        for (const citation of snap.connections) {
            this.citations.set(citation.id, citation)
        }
        for (const [id, citation] of this.citations) {
            const claimKey = citation.claimId
            if (!this.claimToConnections.has(claimKey)) {
                this.claimToConnections.set(claimKey, new Set())
            }
            this.claimToConnections.get(claimKey)!.add(id)
        }
    }

    private withValidation<T>(fn: () => T): T {
        const snap = this.snapshot()
        try {
            const result = fn()
            const validation = this.validate()
            if (!validation.ok) {
                this.restoreFromSnapshot(snap)
                throw new InvariantViolationError(validation.violations)
            }
            return result
        } catch (e) {
            if (!(e instanceof InvariantViolationError)) {
                this.restoreFromSnapshot(snap)
            }
            throw e
        }
    }

    public add(citation: Omit<TCitation, "checksum">): TCitation {
        return this.withValidation(() => {
            if (this.citations.has(citation.id)) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_DUPLICATE_ID,
                        message: `Citation with id ${citation.id} already exists`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            const dependentClaim = this.claimLookup.get(
                citation.claimId,
                citation.claimVersion
            )
            if (!dependentClaim) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_CLAIM_REF_NOT_FOUND,
                        message: `Citation references unknown dependent claim ${citation.claimId}@${citation.claimVersion}`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            const supportingClaim = this.claimLookup.get(
                citation.supportingClaimId,
                citation.supportingClaimVersion
            )
            if (!supportingClaim) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_SUPPORTING_REF_NOT_FOUND,
                        message: `Citation references unknown supporting claim ${citation.supportingClaimId}@${citation.supportingClaimVersion}`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }
            if (supportingClaim.type !== "citation") {
                throw new InvariantViolationError([
                    {
                        code: CITATION_SUPPORTING_NOT_CITATION_TYPE,
                        message: `Citation supporting claim ${citation.supportingClaimId} has type='${supportingClaim.type}'; only 'citation' is permitted on the supporting side`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            if (
                this.wouldCreateCycle(
                    citation.claimId,
                    citation.supportingClaimId
                )
            ) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_CYCLE_DETECTED,
                        message: `Adding citation from ${citation.claimId} to ${citation.supportingClaimId} would create a cycle in the claim citation graph`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            const full = { ...citation, checksum: "" } as TCitation
            full.checksum = this.computeChecksum(full)

            this.citations.set(full.id, full)

            let claimSet = this.claimToConnections.get(full.claimId)
            if (!claimSet) {
                claimSet = new Set()
                this.claimToConnections.set(full.claimId, claimSet)
            }
            claimSet.add(full.id)

            return full
        })
    }

    public remove(id: string): TCitation {
        return this.withValidation(() => {
            const citation = this.citations.get(id)
            if (!citation) {
                throw new Error(`ClaimCitation "${id}" not found.`)
            }

            this.citations.delete(id)

            const claimSet = this.claimToConnections.get(citation.claimId)
            if (claimSet) {
                claimSet.delete(id)
            }

            return citation
        })
    }

    public getConnectionsForClaim(claimId: string): TCitation[] {
        const ids = this.claimToConnections.get(claimId)
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.citations.get(id)!)
            .filter(Boolean)
    }

    public get(id: string): TCitation | undefined {
        return this.citations.get(id)
    }

    public getAll(): TCitation[] {
        return Array.from(this.citations.values())
    }

    public filter(predicate: (c: TCitation) => boolean): TCitation[] {
        return this.getAll().filter(predicate)
    }

    public snapshot(): TClaimConnectionLibrarySnapshot<TCitation> {
        return { connections: this.getAll() }
    }

    /** Restores a claim-citation library from a snapshot, re-indexing all citations. */
    public static fromSnapshot<
        TCitation extends TCoreClaimCitation = TCoreClaimCitation,
    >(
        snapshot: TClaimConnectionLibrarySnapshot<TCitation>,
        claimLookup: TClaimLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimCitationLibrary<TCitation> {
        // Detect pre-v0.12 snapshot shape: wrapper key `claimCitations` or
        // per-entity legacy field `citingClaimId`. Throw a clear migration signal
        // before TypeScript coerces the unknown JSON into the new typed snapshot.
        const raw = snapshot as unknown as Record<string, unknown>
        if ("claimCitations" in raw && !("connections" in raw)) {
            throw new InvariantViolationError([
                {
                    code: LEGACY_CLAIM_CITATION_SHAPE,
                    message:
                        "Snapshot uses pre-v0.12 wrapper field 'claimCitations'. Run the v0.12 CLI migration.",
                    entityType: "citation",
                    entityId: "<snapshot>",
                },
            ])
        }
        const list = Array.isArray((raw as { connections?: unknown }).connections)
            ? ((raw as { connections: unknown[] }).connections)
            : []
        for (const entity of list) {
            if (
                entity !== null &&
                typeof entity === "object" &&
                ("citingClaimId" in (entity as Record<string, unknown>) ||
                    "sourceClaimId" in (entity as Record<string, unknown>))
            ) {
                const id =
                    typeof (entity as { id?: unknown }).id === "string"
                        ? (entity as { id: string }).id
                        : "<unknown>"
                throw new InvariantViolationError([
                    {
                        code: LEGACY_CLAIM_CITATION_SHAPE,
                        message: `Citation "${id}" uses pre-v0.12 field names (citingClaimId/sourceClaimId). Run the v0.12 CLI migration.`,
                        entityType: "citation",
                        entityId: id,
                    },
                ])
            }
        }

        const lib = new ClaimCitationLibrary<TCitation>(claimLookup, options)
        for (const citation of snapshot.connections) {
            lib.citations.set(citation.id, citation)

            let claimSet = lib.claimToConnections.get(citation.claimId)
            if (!claimSet) {
                claimSet = new Set()
                lib.claimToConnections.set(citation.claimId, claimSet)
            }
            claimSet.add(citation.id)
        }
        return lib
    }

    public validate(): TInvariantValidationResult {
        const violations: TInvariantViolation[] = []
        for (const [id, citation] of this.citations) {
            if (!Value.Check(CoreClaimCitationSchema, citation)) {
                violations.push({
                    code: CITATION_SCHEMA_INVALID,
                    message: `Citation "${id}" does not conform to schema`,
                    entityType: "citation",
                    entityId: id,
                })
            }
            if (
                !this.claimLookup.get(
                    citation.claimId,
                    citation.claimVersion
                )
            ) {
                violations.push({
                    code: CITATION_CLAIM_REF_NOT_FOUND,
                    message: `Citation "${id}" references non-existent dependent claim "${citation.claimId}" version ${citation.claimVersion}`,
                    entityType: "citation",
                    entityId: id,
                })
            }
            if (
                !this.claimLookup.get(
                    citation.supportingClaimId,
                    citation.supportingClaimVersion
                )
            ) {
                violations.push({
                    code: CITATION_SUPPORTING_REF_NOT_FOUND,
                    message: `Citation "${id}" references non-existent supporting claim "${citation.supportingClaimId}" version ${citation.supportingClaimVersion}`,
                    entityType: "citation",
                    entityId: id,
                })
            }
        }

        // Strict supporting-side type: every citation's supporting claim must have
        // type='citation'. Catches tampered snapshots loaded via fromSnapshot.
        for (const citation of this.citations.values()) {
            const supportingClaim = this.claimLookup.get(
                citation.supportingClaimId,
                citation.supportingClaimVersion
            )
            if (supportingClaim && supportingClaim.type !== "citation") {
                violations.push({
                    code: CITATION_SUPPORTING_NOT_CITATION_TYPE,
                    message: `Citation ${citation.id} supporting claim ${citation.supportingClaimId} has type='${supportingClaim.type}'; only 'citation' is permitted on the supporting side`,
                    entityType: "citation",
                    entityId: citation.id,
                })
            }
        }

        // Acyclicity: walk the entire citation graph (ID-only) and detect
        // cycles. Catches cycles introduced by snapshot tampering.
        const cycleViolations = this.detectAllCycles()
        for (const v of cycleViolations) violations.push(v)

        return { ok: violations.length === 0, violations }
    }

    /**
     * Detects all cycles in the ID-only projection of the citation graph.
     * Returns one violation per cycle (deduped by the citation that closes
     * each detected cycle).
     */
    private detectAllCycles(): TInvariantViolation[] {
        const violations: TInvariantViolation[] = []
        const visited = new Set<string>()
        const inProgress = new Set<string>()
        const reportedCycleIds = new Set<string>()

        const visit = (node: string, path: string[]): void => {
            if (inProgress.has(node)) {
                // Cycle detected: report the citation that closes it.
                // Find the citation linking the previous node to this one.
                const prev = path[path.length - 1]
                for (const connection of this.citations.values()) {
                    if (
                        connection.claimId === prev &&
                        connection.supportingClaimId === node &&
                        !reportedCycleIds.has(connection.id)
                    ) {
                        violations.push({
                            code: CITATION_CYCLE_DETECTED,
                            message: `Citation graph contains a cycle involving claim ${node}`,
                            entityType: "citation",
                            entityId: connection.id,
                        })
                        reportedCycleIds.add(connection.id)
                    }
                }
                return
            }
            if (visited.has(node)) return
            visited.add(node)
            inProgress.add(node)
            const outgoing = this.claimToConnections.get(node)
            if (outgoing) {
                for (const cid of outgoing) {
                    const c = this.citations.get(cid)
                    if (c) visit(c.supportingClaimId, [...path, node])
                }
            }
            inProgress.delete(node)
        }

        for (const node of this.claimToConnections.keys()) {
            if (!visited.has(node)) visit(node, [])
        }
        return violations
    }

    /**
     * Returns true if adding an edge from `claimId` to `supportingClaimId`
     * would create a cycle in the claim-citation graph. Edges go from the
     * dependent claim to the supporting claim; a cycle exists when the
     * dependent claim is reachable from the proposed supporting claim by
     * following outgoing edges.
     */
    private wouldCreateCycle(
        claimId: string,
        supportingClaimId: string
    ): boolean {
        // Optimization: if the dependent-side claim has type "normal", it can
        // never appear on the supporting side, so no cycle is reachable. Type
        // is immutable post-creation, so v0's type is authoritative.
        const claimType = this.claimLookup.get(claimId, 0)?.type
        if (claimType === "normal") return false

        // DFS from supportingClaimId following outgoing edges via the
        // claimToConnections index (avoids scanning all citations).
        const visited = new Set<string>()
        const stack: string[] = [supportingClaimId]
        while (stack.length > 0) {
            const node = stack.pop()!
            if (node === claimId) return true
            if (visited.has(node)) continue
            visited.add(node)
            const outgoingIds = this.claimToConnections.get(node)
            if (outgoingIds) {
                for (const cid of outgoingIds) {
                    const c = this.citations.get(cid)
                    if (c) {
                        stack.push(c.supportingClaimId)
                    }
                }
            }
        }
        return false
    }

    private computeChecksum(citation: TCitation): string {
        const fields =
            this.checksumConfig?.claimCitationFields ??
            DEFAULT_CHECKSUM_CONFIG.claimCitationFields!
        return entityChecksum(
            citation as unknown as Record<string, unknown>,
            fields
        )
    }
}
