import fs from "node:fs/promises"
import path from "node:path"
import { getStateDir } from "../config.js"
import { entityChecksum } from "../../lib/core/checksum.js"
import { DEFAULT_CHECKSUM_CONFIG } from "../../lib/consts.js"

const MARKER = ".proposit-v0.12"

/**
 * One-time migration of CLI state directories from pre-v0.12.0 to v0.12.0:
 *
 *   - Renames `claim-citations.json` → `citations.json`.
 *   - Rewrites the wrapper field `claimCitations` → `connections`.
 *   - Renames per-citation field names:
 *       citingClaimId        → claimId
 *       citingClaimVersion   → claimVersion
 *       sourceClaimId        → supportingClaimId
 *       sourceClaimVersion   → supportingClaimVersion
 *   - Recomputes each citation's checksum with the v0.12 field set.
 *   - Creates `axioms.json` if absent, initialized to `{ connections: [] }`.
 *
 * Each step is idempotent: a partial-failure rerun lands on the same end
 * state. The `.proposit-v0.12` marker is the last write; if any prior step
 * failed, the next CLI invocation re-runs all prior steps.
 *
 * Note: a v0.10→v0.12 jump is supported because `migrateV010` runs first and
 * writes the legacy `claim-citations.json`/`claimCitations` shape; this
 * migration then converts that fresh-from-migration file alongside genuine
 * pre-v0.12 state.
 */
export async function migrateV012(): Promise<void> {
    const stateDir = getStateDir()
    const markerPath = path.join(stateDir, MARKER)

    // Step 1: Detection — skip if marker exists. Surface non-ENOENT errors
    // (e.g., EACCES) so a broken permissions setup fails loudly rather than
    // re-running the migration on every invocation.
    try {
        await fs.access(markerPath)
        return // Already migrated.
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            throw err
        }
        // Marker missing — proceed with migration.
    }

    // If the state dir doesn't exist yet (fresh install), there's nothing to
    // migrate. Create the directory and drop the marker so we don't re-check
    // every invocation. mkdir is best-effort — unlike the marker check above,
    // any real failure will surface later when the subsequent file writes try
    // to touch this directory and produce a path-specific error.
    try {
        await fs.mkdir(stateDir, { recursive: true })
    } catch {
        // mkdir failures are surfaced by later steps when they touch files.
    }

    const oldCitationsPath = path.join(stateDir, "claim-citations.json")
    const newCitationsPath = path.join(stateDir, "citations.json")
    const axiomsFilePath = path.join(stateDir, "axioms.json")

    // Step 2: Citations file rename + shape rewrite.
    await migrateCitations(oldCitationsPath, newCitationsPath)

    // Step 3: Init axioms.json if absent.
    await initAxiomsFile(axiomsFilePath)

    // Step 4: Marker write.
    await fs.writeFile(markerPath, new Date().toISOString())

    process.stderr.write(
        `[proposit] Migrated state directory to v0.12.0 format at ${stateDir}\n`
    )
}

async function migrateCitations(
    oldCitationsPath: string,
    newCitationsPath: string
): Promise<void> {
    // Source-selection rules:
    //  * If the legacy `claim-citations.json` exists, treat it as authoritative.
    //    The v0.10 migration (when chained v0.10→v0.12) writes this file via
    //    `convertAssociationsToCitations`. A pre-existing `citations.json` at
    //    this point can only be a stale artifact (e.g., an empty library
    //    written by v0.10's `validateAndRewriteLibraries`, which uses the
    //    v0.12 file path), so it's overwritten.
    //  * Else, if `citations.json` already exists, it's already in v0.12 shape
    //    (or this is an idempotent re-run before the marker was written) —
    //    re-process it as a no-op rewrite to confirm the shape and checksums.
    //  * Else, neither exists — write a new-format empty file.
    let rawContent: string | null = null
    let sourceIsLegacy = false
    try {
        rawContent = await fs.readFile(oldCitationsPath, "utf-8")
        sourceIsLegacy = true
    } catch {
        try {
            rawContent = await fs.readFile(newCitationsPath, "utf-8")
        } catch {
            // Neither exists — treat as fresh and write a new-format empty file.
            await fs.writeFile(
                newCitationsPath,
                JSON.stringify({ connections: [] }, null, 2)
            )
            return
        }
    }

    const parsed = JSON.parse(rawContent) as Record<string, unknown>
    const needsShapeRewrite =
        "claimCitations" in parsed && !("connections" in parsed)
    const rawList = (parsed.connections ??
        parsed.claimCitations ??
        []) as Record<string, unknown>[]

    // Rename fields per-citation. Idempotent: if the new keys already exist,
    // the in-key checks below skip the rename. Per-citation extras are
    // preserved by spreading first and only overwriting the renamed keys.
    const fields =
        DEFAULT_CHECKSUM_CONFIG.claimCitationFields ?? new Set<string>()
    const list = rawList.map((c) => {
        const renamed: Record<string, unknown> = { ...c }
        if ("citingClaimId" in renamed) {
            renamed.claimId = renamed.citingClaimId
            delete renamed.citingClaimId
        }
        if ("citingClaimVersion" in renamed) {
            renamed.claimVersion = renamed.citingClaimVersion
            delete renamed.citingClaimVersion
        }
        if ("sourceClaimId" in renamed) {
            renamed.supportingClaimId = renamed.sourceClaimId
            delete renamed.sourceClaimId
        }
        if ("sourceClaimVersion" in renamed) {
            renamed.supportingClaimVersion = renamed.sourceClaimVersion
            delete renamed.sourceClaimVersion
        }
        // Recompute checksum from v0.12 field set. Even in the idempotent
        // re-run path (already-renamed fields), this is a no-op rewrite to
        // the same value.
        renamed.checksum = entityChecksum(renamed, fields)
        return renamed
    })

    const newContent = { connections: list }

    // Only rewrite when the source actually needed conversion. This keeps the
    // re-run path a pure no-op once `citations.json` is already in shape.
    if (sourceIsLegacy || needsShapeRewrite) {
        await fs.writeFile(
            newCitationsPath,
            JSON.stringify(newContent, null, 2)
        )
        if (sourceIsLegacy) {
            await fs.rm(oldCitationsPath, { force: true })
        }
    }
}

async function initAxiomsFile(axiomsFilePath: string): Promise<void> {
    try {
        await fs.access(axiomsFilePath)
        return // Already exists.
    } catch {
        // Missing — create.
    }
    await fs.writeFile(
        axiomsFilePath,
        JSON.stringify({ connections: [] }, null, 2)
    )
}
