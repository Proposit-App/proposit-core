import fs from "node:fs/promises"
import path from "node:path"
import { getStateDir } from "../config.js"

const MARKER = ".proposit-v0.11"

/**
 * One-time migration of CLI state directories from pre-v0.11.0 to v0.11.0:
 *
 *   - Backfills `type: "freeform"` on every premise `meta.json` that lacks it.
 *
 * Checksums are NOT stored in premise `meta.json` on disk — they are computed
 * lazily at hydration time by `ArgumentEngine.fromSnapshot` via `flushChecksums()`.
 * No checksum recomputation pass is required here; the runtime handles it.
 *
 * Detected via the absence of a `.proposit-v0.11` marker in the state dir;
 * once migration completes (or there is nothing to migrate) the marker is
 * written so subsequent CLI invocations no-op immediately.
 */
export async function migrateV011(): Promise<void> {
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

    // Step 2: Backfill premise types.
    await backfillPremiseTypes(stateDir)

    // Step 3: Marker write.
    await fs.writeFile(markerPath, new Date().toISOString())

    process.stderr.write(
        `[proposit] Migrated state directory to v0.11.0 format at ${stateDir}\n`
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

/**
 * Walks `{stateDir}/arguments/{id}/{version}/premises/{premiseId}/meta.json`
 * for every argument/version/premise combination and adds `type: "freeform"`
 * where the field is absent.
 *
 * Checksums are not stored in premise meta.json — they are recomputed at
 * runtime by `flushChecksums()` during engine hydration. No checksum pass is
 * needed here; the cascade to argument-level checksums is handled automatically
 * when `ArgumentEngine.fromSnapshot` restores the engine.
 */
async function backfillPremiseTypes(stateDir: string): Promise<void> {
    const argumentsDir = path.join(stateDir, "arguments")

    let argumentDirs: string[]
    try {
        const entries = await fs.readdir(argumentsDir, { withFileTypes: true })
        argumentDirs = entries
            .filter((e) => e.isDirectory())
            .map((e) => path.join(argumentsDir, e.name))
    } catch {
        return // No arguments directory — nothing to migrate.
    }

    let backfilled = 0

    for (const argumentDir of argumentDirs) {
        // Each sub-directory with a numeric name is a version directory.
        let versionEntries: import("node:fs").Dirent[]
        try {
            versionEntries = await fs.readdir(argumentDir, {
                withFileTypes: true,
            })
        } catch {
            continue
        }

        const versionDirs = versionEntries
            .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
            .map((e) => path.join(argumentDir, e.name))

        for (const versionDir of versionDirs) {
            const premisesDir = path.join(versionDir, "premises")

            let premiseEntries: import("node:fs").Dirent[]
            try {
                premiseEntries = await fs.readdir(premisesDir, {
                    withFileTypes: true,
                })
            } catch {
                continue // No premises directory for this version.
            }

            const premiseDirs = premiseEntries
                .filter((e) => e.isDirectory())
                .map((e) => path.join(premisesDir, e.name))

            for (const premiseDir of premiseDirs) {
                const metaPath = path.join(premiseDir, "meta.json")
                const meta = await readJsonFile<Record<string, unknown>>(
                    metaPath
                )
                if (!meta) continue
                if (meta.type !== undefined) continue // Already has type.

                meta.type = "freeform"
                await writeJsonFile(metaPath, meta)
                backfilled++
            }
        }
    }

    if (backfilled > 0) {
        process.stderr.write(
            `[proposit migration] Backfilled type='freeform' on ${backfilled} pre-existing premise(s)\n`
        )
    }
}
