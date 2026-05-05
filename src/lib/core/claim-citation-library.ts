import { Value } from "typebox/value"
import type { TCoreClaimCitation } from "../schemata/claim-citation.js"
import { CoreClaimCitationSchema } from "../schemata/claim-citation.js"
import type { TCoreChecksumConfig } from "../types/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../consts.js"
import { entityChecksum } from "./checksum.js"
import type {
    TClaimLookup,
    TClaimCitationLibraryManagement,
    TClaimCitationLibrarySnapshot,
} from "./interfaces/library.interfaces.js"
import type {
    TInvariantValidationResult,
    TInvariantViolation,
} from "../types/validation.js"
import {
    CITATION_SCHEMA_INVALID,
    CITATION_DUPLICATE_ID,
    CITATION_CITING_REF_NOT_FOUND,
    CITATION_SOURCE_REF_NOT_FOUND,
    CITATION_SOURCE_NOT_CITATION_TYPE,
    CITATION_CYCLE_DETECTED,
} from "../types/validation.js"
import { InvariantViolationError } from "./invariant-violation-error.js"

export class ClaimCitationLibrary<
    TCitation extends TCoreClaimCitation = TCoreClaimCitation,
> implements TClaimCitationLibraryManagement<TCitation> {
    private citations: Map<string, TCitation>
    private citingClaimToCitations: Map<string, Set<string>>
    private sourceClaimToCitations: Map<string, Set<string>>
    private claimLookup: TClaimLookup
    private checksumConfig?: TCoreChecksumConfig

    constructor(
        claimLookup: TClaimLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ) {
        this.citations = new Map()
        this.citingClaimToCitations = new Map()
        this.sourceClaimToCitations = new Map()
        this.claimLookup = claimLookup
        this.checksumConfig = options?.checksumConfig
    }

    private restoreFromSnapshot(
        snap: TClaimCitationLibrarySnapshot<TCitation>
    ): void {
        this.citations = new Map()
        this.citingClaimToCitations = new Map()
        this.sourceClaimToCitations = new Map()
        for (const citation of snap.claimCitations) {
            this.citations.set(citation.id, citation)
        }
        for (const [id, citation] of this.citations) {
            const citingKey = citation.citingClaimId
            if (!this.citingClaimToCitations.has(citingKey)) {
                this.citingClaimToCitations.set(citingKey, new Set())
            }
            this.citingClaimToCitations.get(citingKey)!.add(id)

            const sourceKey = citation.sourceClaimId
            if (!this.sourceClaimToCitations.has(sourceKey)) {
                this.sourceClaimToCitations.set(sourceKey, new Set())
            }
            this.sourceClaimToCitations.get(sourceKey)!.add(id)
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

            const citingClaim = this.claimLookup.get(
                citation.citingClaimId,
                citation.citingClaimVersion
            )
            if (!citingClaim) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_CITING_REF_NOT_FOUND,
                        message: `Citation references unknown citing claim ${citation.citingClaimId}@${citation.citingClaimVersion}`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            const sourceClaim = this.claimLookup.get(
                citation.sourceClaimId,
                citation.sourceClaimVersion
            )
            if (!sourceClaim) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_SOURCE_REF_NOT_FOUND,
                        message: `Citation references unknown source claim ${citation.sourceClaimId}@${citation.sourceClaimVersion}`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }
            if (sourceClaim.type !== "citation") {
                throw new InvariantViolationError([
                    {
                        code: CITATION_SOURCE_NOT_CITATION_TYPE,
                        message: `Citation source claim ${citation.sourceClaimId} has type='${sourceClaim.type}'; only 'citation' is permitted on the source side`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            if (
                this.wouldCreateCycle(
                    citation.citingClaimId,
                    citation.sourceClaimId
                )
            ) {
                throw new InvariantViolationError([
                    {
                        code: CITATION_CYCLE_DETECTED,
                        message: `Adding citation from ${citation.citingClaimId} to ${citation.sourceClaimId} would create a cycle in the claim citation graph`,
                        entityType: "citation",
                        entityId: citation.id,
                    },
                ])
            }

            const full = { ...citation, checksum: "" } as TCitation
            full.checksum = this.computeChecksum(full)

            this.citations.set(full.id, full)

            let citingSet = this.citingClaimToCitations.get(full.citingClaimId)
            if (!citingSet) {
                citingSet = new Set()
                this.citingClaimToCitations.set(full.citingClaimId, citingSet)
            }
            citingSet.add(full.id)

            let sourceSet = this.sourceClaimToCitations.get(full.sourceClaimId)
            if (!sourceSet) {
                sourceSet = new Set()
                this.sourceClaimToCitations.set(full.sourceClaimId, sourceSet)
            }
            sourceSet.add(full.id)

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

            const citingSet = this.citingClaimToCitations.get(
                citation.citingClaimId
            )
            if (citingSet) {
                citingSet.delete(id)
            }

            const sourceSet = this.sourceClaimToCitations.get(
                citation.sourceClaimId
            )
            if (sourceSet) {
                sourceSet.delete(id)
            }

            return citation
        })
    }

    public getCitationsForCitingClaim(citingClaimId: string): TCitation[] {
        const ids = this.citingClaimToCitations.get(citingClaimId)
        if (!ids) return []
        return Array.from(ids)
            .map((id) => this.citations.get(id)!)
            .filter(Boolean)
    }

    public getCitationsForSourceClaim(sourceClaimId: string): TCitation[] {
        const ids = this.sourceClaimToCitations.get(sourceClaimId)
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

    public snapshot(): TClaimCitationLibrarySnapshot<TCitation> {
        return { claimCitations: this.getAll() }
    }

    /** Restores a claim-citation library from a snapshot, re-indexing all citations. */
    public static fromSnapshot<
        TCitation extends TCoreClaimCitation = TCoreClaimCitation,
    >(
        snapshot: TClaimCitationLibrarySnapshot<TCitation>,
        claimLookup: TClaimLookup,
        options?: { checksumConfig?: TCoreChecksumConfig }
    ): ClaimCitationLibrary<TCitation> {
        const lib = new ClaimCitationLibrary<TCitation>(claimLookup, options)
        for (const citation of snapshot.claimCitations) {
            lib.citations.set(citation.id, citation)

            let citingSet = lib.citingClaimToCitations.get(
                citation.citingClaimId
            )
            if (!citingSet) {
                citingSet = new Set()
                lib.citingClaimToCitations.set(
                    citation.citingClaimId,
                    citingSet
                )
            }
            citingSet.add(citation.id)

            let sourceSet = lib.sourceClaimToCitations.get(
                citation.sourceClaimId
            )
            if (!sourceSet) {
                sourceSet = new Set()
                lib.sourceClaimToCitations.set(
                    citation.sourceClaimId,
                    sourceSet
                )
            }
            sourceSet.add(citation.id)
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
                    citation.citingClaimId,
                    citation.citingClaimVersion
                )
            ) {
                violations.push({
                    code: CITATION_CITING_REF_NOT_FOUND,
                    message: `Citation "${id}" references non-existent citing claim "${citation.citingClaimId}" version ${citation.citingClaimVersion}`,
                    entityType: "citation",
                    entityId: id,
                })
            }
            if (
                !this.claimLookup.get(
                    citation.sourceClaimId,
                    citation.sourceClaimVersion
                )
            ) {
                violations.push({
                    code: CITATION_SOURCE_REF_NOT_FOUND,
                    message: `Citation "${id}" references non-existent source claim "${citation.sourceClaimId}" version ${citation.sourceClaimVersion}`,
                    entityType: "citation",
                    entityId: id,
                })
            }
        }

        // Strict source-side type: every citation's source claim must have
        // type='citation'. Catches tampered snapshots loaded via fromSnapshot.
        for (const citation of this.citations.values()) {
            const sourceClaim = this.claimLookup.get(
                citation.sourceClaimId,
                citation.sourceClaimVersion
            )
            if (sourceClaim && sourceClaim.type !== "citation") {
                violations.push({
                    code: CITATION_SOURCE_NOT_CITATION_TYPE,
                    message: `Citation ${citation.id} source claim ${citation.sourceClaimId} has type='${sourceClaim.type}'; only 'citation' is permitted on the source side`,
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
                for (const citation of this.citations.values()) {
                    if (
                        citation.citingClaimId === prev &&
                        citation.sourceClaimId === node &&
                        !reportedCycleIds.has(citation.id)
                    ) {
                        violations.push({
                            code: CITATION_CYCLE_DETECTED,
                            message: `Citation graph contains a cycle involving claim ${node}`,
                            entityType: "citation",
                            entityId: citation.id,
                        })
                        reportedCycleIds.add(citation.id)
                    }
                }
                return
            }
            if (visited.has(node)) return
            visited.add(node)
            inProgress.add(node)
            const outgoing = this.citingClaimToCitations.get(node)
            if (outgoing) {
                for (const cid of outgoing) {
                    const c = this.citations.get(cid)
                    if (c) visit(c.sourceClaimId, [...path, node])
                }
            }
            inProgress.delete(node)
        }

        for (const node of this.citingClaimToCitations.keys()) {
            if (!visited.has(node)) visit(node, [])
        }
        return violations
    }

    /**
     * Returns true if adding an edge from `citingClaimId` to `sourceClaimId`
     * would create a cycle in the claim-citation graph. Edges go from citing
     * to source; a cycle exists when the citing claim is reachable from the
     * proposed source claim by following outgoing source edges.
     */
    private wouldCreateCycle(
        citingClaimId: string,
        sourceClaimId: string
    ): boolean {
        // Optimization: if citing-side has type "normal", it can never appear
        // on the source side, so no cycle is reachable. Type is immutable
        // post-creation, so v0's type is authoritative.
        const citingClaimType = this.claimLookup.get(citingClaimId, 0)?.type
        if (citingClaimType === "normal") return false

        // DFS from sourceClaimId following outgoing source edges via the
        // citingClaimToCitations index (avoids scanning all citations).
        const visited = new Set<string>()
        const stack: string[] = [sourceClaimId]
        while (stack.length > 0) {
            const node = stack.pop()!
            if (node === citingClaimId) return true
            if (visited.has(node)) continue
            visited.add(node)
            const outgoingIds = this.citingClaimToCitations.get(node)
            if (outgoingIds) {
                for (const cid of outgoingIds) {
                    const c = this.citations.get(cid)
                    if (c) {
                        stack.push(c.sourceClaimId)
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
