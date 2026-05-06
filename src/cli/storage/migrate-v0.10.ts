import fs from "node:fs/promises"
import path from "node:path"
import { getStateDir } from "../config.js"
import {
    readClaimLibrary,
    readClaimCitationLibrary,
    writeClaimLibrary,
    writeClaimCitationLibrary,
} from "./libraries.js"
import { entityChecksum } from "../../lib/core/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../../lib/consts.js"

const MARKER = ".proposit-v0.10"

/**
 * One-time migration of CLI state directories from pre-v0.10.0 layout to the
 * unified Source-as-Claim layout.
 *
 * Detected via the absence of a `.proposit-v0.10` marker in the state dir;
 * once migration completes (or there is nothing to migrate) the marker is
 * written so subsequent CLI invocations no-op immediately.
 */
export async function migrateV010(): Promise<void> {
    const stateDir = getStateDir()
    const markerPath = path.join(stateDir, MARKER)

    // Step 1: Detection — skip if marker exists.
    try {
        await fs.access(markerPath)
        return // Already migrated.
    } catch {
        // Marker missing — proceed with migration.
    }

    // If the state dir doesn't exist yet (fresh install), there's nothing to
    // migrate. Create the directory and drop the marker so we don't re-check
    // every invocation.
    try {
        await fs.mkdir(stateDir, { recursive: true })
    } catch {
        // mkdir failures are surfaced by later steps when they touch files.
    }

    // Step 2: Source extras collision check.
    await checkSourceExtrasCollision(stateDir)

    // Step 3: Sources → claims conversion.
    await convertSourcesToClaims(stateDir)

    // Step 4: Existing claim type backfill.
    await backfillClaimTypes(stateDir)

    // Step 5: Associations → citations conversion.
    await convertAssociationsToCitations(stateDir)

    // Step 6: Forks fold.
    await foldForkSourcesIntoClaims(stateDir)

    // Step 7: Checksum recompute. Pre-v0.10 claim and citation entities were
    // hashed without the new `type`, `citingClaim*`, and `sourceClaim*` fields
    // (and without the field-renaming applied above), so the stored checksums
    // no longer match their content. Rewrite each entity's checksum directly
    // from disk before hydrating, so consumers that verify stored-vs-computed
    // checksums don't see mismatches.
    await recomputeChecksums(stateDir)

    // Step 8: Acyclicity validation — hydrate the libraries (which exercises
    // ClaimCitationLibrary.fromSnapshot's cycle check) and write back so any
    // structural normalization is captured.
    await validateAndRewriteLibraries()

    // Step 9: Marker write.
    await fs.writeFile(markerPath, new Date().toISOString())

    process.stderr.write(
        `[proposit] Migrated state directory to v0.10.0 format at ${stateDir}\n`
    )
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
    try {
        const content = await fs.readFile(filePath, "utf-8")
        return JSON.parse(content) as T
    } catch {
        return null
    }
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(data, null, 2))
}

async function checkSourceExtrasCollision(stateDir: string): Promise<void> {
    const sourcesPath = path.join(stateDir, "sources.json")
    const snapshot = await readJsonFile<{
        sources?: Record<string, unknown>[]
    }>(sourcesPath)
    if (!snapshot?.sources) return
    const colliding = snapshot.sources.filter(
        (s) => (s as { type?: unknown }).type !== undefined
    )
    if (colliding.length > 0) {
        const ids = colliding
            .map((s) => {
                const id = (s as { id?: unknown }).id
                return typeof id === "string" ? id : "<unknown>"
            })
            .join(", ")
        throw new Error(
            `[proposit migration] Cannot migrate: source records have a 'type' extra that would collide with the new top-level 'type' field. Conflicting source IDs: ${ids}. Rename the extra (e.g., to 'kind') in sources.json and re-run.`
        )
    }
}

async function convertSourcesToClaims(stateDir: string): Promise<void> {
    const sourcesPath = path.join(stateDir, "sources.json")
    const claimsPath = path.join(stateDir, "claims.json")
    const sourcesSnapshot = await readJsonFile<{
        sources?: Record<string, unknown>[]
    }>(sourcesPath)
    if (!sourcesSnapshot?.sources) return
    const claimsSnapshot = (await readJsonFile<{
        claims?: Record<string, unknown>[]
    }>(claimsPath)) ?? { claims: [] }
    claimsSnapshot.claims ??= []
    for (const source of sourcesSnapshot.sources) {
        claimsSnapshot.claims.push({
            ...source,
            type: "citation",
        })
    }
    await writeJsonFile(claimsPath, claimsSnapshot)
    await fs.unlink(sourcesPath)
    process.stderr.write(
        `[proposit migration] Converted ${sourcesSnapshot.sources.length} sources to citation-type claims\n`
    )
}

async function backfillClaimTypes(stateDir: string): Promise<void> {
    const claimsPath = path.join(stateDir, "claims.json")
    const snapshot = await readJsonFile<{
        claims?: Record<string, unknown>[]
    }>(claimsPath)
    if (!snapshot?.claims) return
    let backfilled = 0
    for (const claim of snapshot.claims) {
        if (claim.type === undefined) {
            claim.type = "normal"
            backfilled++
        }
    }
    if (backfilled > 0) {
        await writeJsonFile(claimsPath, snapshot)
        process.stderr.write(
            `[proposit migration] Backfilled type='normal' on ${backfilled} pre-existing claims\n`
        )
    }
}

async function convertAssociationsToCitations(stateDir: string): Promise<void> {
    const oldPath = path.join(stateDir, "claim-source-associations.json")
    const newPath = path.join(stateDir, "claim-citations.json")
    const snapshot = await readJsonFile<{
        claimSourceAssociations?: Record<string, unknown>[]
    }>(oldPath)
    if (!snapshot?.claimSourceAssociations) return
    const RESERVED_KEYS = new Set([
        "id",
        "claimId",
        "claimVersion",
        "sourceId",
        "sourceVersion",
        "checksum",
    ])
    const citations = snapshot.claimSourceAssociations.map((a) => ({
        id: a.id,
        citingClaimId: a.claimId,
        citingClaimVersion: a.claimVersion,
        sourceClaimId: a.sourceId,
        sourceClaimVersion: a.sourceVersion,
        checksum: a.checksum,
        // Preserve any additional properties under their original key names.
        ...Object.fromEntries(
            Object.entries(a).filter(([k]) => !RESERVED_KEYS.has(k))
        ),
    }))
    await writeJsonFile(newPath, { claimCitations: citations })
    await fs.unlink(oldPath)
    process.stderr.write(
        `[proposit migration] Converted ${citations.length} claim-source associations to citations\n`
    )
}

async function foldForkSourcesIntoClaims(stateDir: string): Promise<void> {
    const forksPath = path.join(stateDir, "forks.json")
    const snapshot = await readJsonFile<{
        sources?: Record<string, unknown>[]
        claims?: Record<string, unknown>[]
        [key: string]: unknown
    }>(forksPath)
    if (!snapshot) return
    if (!("sources" in snapshot)) return

    const sources = snapshot.sources ?? []
    if (sources.length === 0) {
        // Empty sources array — drop the key and rewrite for cleanliness.
        delete snapshot.sources
        await writeJsonFile(forksPath, snapshot)
        return
    }

    snapshot.claims ??= []
    snapshot.claims.push(...sources)
    const sourceCount = sources.length
    delete snapshot.sources
    await writeJsonFile(forksPath, snapshot)
    process.stderr.write(
        `[proposit migration] Folded ${sourceCount} source fork records into claims namespace\n`
    )
}

async function recomputeChecksums(stateDir: string): Promise<void> {
    const claimFields = DEFAULT_CHECKSUM_CONFIG.claimFields ?? new Set<string>()
    const claimCitationFields =
        DEFAULT_CHECKSUM_CONFIG.claimCitationFields ?? new Set<string>()

    // Recompute claim checksums.
    const claimsPath = path.join(stateDir, "claims.json")
    const claimsSnapshot = await readJsonFile<{
        claims?: Record<string, unknown>[]
    }>(claimsPath)
    let claimCount = 0
    if (claimsSnapshot?.claims) {
        for (const claim of claimsSnapshot.claims) {
            claim.checksum = entityChecksum(claim, claimFields)
            claimCount++
        }
        await writeJsonFile(claimsPath, claimsSnapshot)
    }

    // Recompute citation checksums.
    const citationsPath = path.join(stateDir, "claim-citations.json")
    const citationsSnapshot = await readJsonFile<{
        claimCitations?: Record<string, unknown>[]
    }>(citationsPath)
    let citationCount = 0
    if (citationsSnapshot?.claimCitations) {
        for (const citation of citationsSnapshot.claimCitations) {
            citation.checksum = entityChecksum(citation, claimCitationFields)
            citationCount++
        }
        await writeJsonFile(citationsPath, citationsSnapshot)
    }

    process.stderr.write(
        `[proposit migration] Recomputed checksums for ${claimCount} claim(s) and ${citationCount} citation(s)\n`
    )
}

async function validateAndRewriteLibraries(): Promise<void> {
    // Hydrate libraries via fromSnapshot — exercises ClaimCitationLibrary's
    // acyclicity and type-strictness validation paths — then write back
    // through the standard storage helpers so any structural normalization
    // (e.g., ordering, key shapes) is captured. Order matters: hydrate claims
    // first so the citation library has a populated claim lookup.
    const claimLibrary = await readClaimLibrary()
    await writeClaimLibrary(claimLibrary)

    const claimCitationLibrary = await readClaimCitationLibrary(claimLibrary)
    await writeClaimCitationLibrary(claimCitationLibrary)

    process.stderr.write(
        `[proposit migration] Citation graph validated (no cycles)\n`
    )
}
