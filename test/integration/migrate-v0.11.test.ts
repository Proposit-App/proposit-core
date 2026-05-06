import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { describe, it, expect, afterEach } from "vitest"
import { migrateV011 } from "../../src/cli/storage/migrate-v0.11.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeTmpDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "proposit-migrate-v011-"))
}

/**
 * Creates a minimal premise meta.json at
 * `{stateDir}/arguments/{argId}/{version}/premises/{premiseId}/meta.json`.
 */
async function writePremiseMeta(
    stateDir: string,
    argId: string,
    version: number,
    premiseId: string,
    meta: Record<string, unknown>
): Promise<void> {
    const dir = path.join(
        stateDir,
        "arguments",
        argId,
        String(version),
        "premises",
        premiseId
    )
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify(meta, null, 2)
    )
}

async function readPremiseMeta(
    stateDir: string,
    argId: string,
    version: number,
    premiseId: string
): Promise<Record<string, unknown>> {
    const filePath = path.join(
        stateDir,
        "arguments",
        argId,
        String(version),
        "premises",
        premiseId,
        "meta.json"
    )
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as Record<
        string,
        unknown
    >
}

// ---------------------------------------------------------------------------
// Track PROPOSIT_HOME so we can restore it after each test
// ---------------------------------------------------------------------------

const originalHome = process.env.PROPOSIT_HOME

afterEach(() => {
    if (originalHome === undefined) {
        delete process.env.PROPOSIT_HOME
    } else {
        process.env.PROPOSIT_HOME = originalHome
    }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("v0.11.0 CLI migration", () => {
    it("backfills type='freeform' on legacy premises that lack a type field", async () => {
        const tmpDir = await makeTmpDir()
        process.env.PROPOSIT_HOME = tmpDir

        await writePremiseMeta(tmpDir, "arg-1", 0, "prem-a", {
            id: "prem-a",
            title: "Premise A",
        })
        await writePremiseMeta(tmpDir, "arg-1", 0, "prem-b", {
            id: "prem-b",
            title: "Premise B",
        })
        // Second version of the same argument.
        await writePremiseMeta(tmpDir, "arg-1", 1, "prem-c", {
            id: "prem-c",
            title: "Premise C",
        })
        // Second argument.
        await writePremiseMeta(tmpDir, "arg-2", 0, "prem-d", {
            id: "prem-d",
        })

        await migrateV011()

        const a = await readPremiseMeta(tmpDir, "arg-1", 0, "prem-a")
        const b = await readPremiseMeta(tmpDir, "arg-1", 0, "prem-b")
        const c = await readPremiseMeta(tmpDir, "arg-1", 1, "prem-c")
        const d = await readPremiseMeta(tmpDir, "arg-2", 0, "prem-d")

        expect(a.type).toBe("freeform")
        expect(b.type).toBe("freeform")
        expect(c.type).toBe("freeform")
        expect(d.type).toBe("freeform")

        // Other fields preserved.
        expect(a.title).toBe("Premise A")
        expect(d.id).toBe("prem-d")

        // Marker written.
        await expect(
            fs.access(path.join(tmpDir, ".proposit-v0.11"))
        ).resolves.toBeUndefined()
    })

    it("does not overwrite an existing type field", async () => {
        const tmpDir = await makeTmpDir()
        process.env.PROPOSIT_HOME = tmpDir

        // A premise that already has type: "freeform".
        await writePremiseMeta(tmpDir, "arg-1", 0, "prem-existing", {
            id: "prem-existing",
            type: "freeform",
        })
        // A premise with a non-standard type (should be left as-is).
        await writePremiseMeta(tmpDir, "arg-1", 0, "prem-derivation", {
            id: "prem-derivation",
            type: "derivation",
            derivedClaimId: "claim-xyz",
        })

        await migrateV011()

        const existing = await readPremiseMeta(
            tmpDir,
            "arg-1",
            0,
            "prem-existing"
        )
        const derivation = await readPremiseMeta(
            tmpDir,
            "arg-1",
            0,
            "prem-derivation"
        )

        expect(existing.type).toBe("freeform")
        expect(derivation.type).toBe("derivation")
        expect(derivation.derivedClaimId).toBe("claim-xyz")
    })

    it("is idempotent — second run is a no-op and does not modify files", async () => {
        const tmpDir = await makeTmpDir()
        process.env.PROPOSIT_HOME = tmpDir

        await writePremiseMeta(tmpDir, "arg-1", 0, "prem-a", {
            id: "prem-a",
        })

        await migrateV011()

        const metaPath = path.join(
            tmpDir,
            "arguments",
            "arg-1",
            "0",
            "premises",
            "prem-a",
            "meta.json"
        )
        const stat1 = await fs.stat(metaPath)

        // Wait a tick to ensure mtime would differ if the file were rewritten.
        await new Promise((r) => setTimeout(r, 10))

        await migrateV011()

        const stat2 = await fs.stat(metaPath)

        // File was not rewritten on the second pass.
        expect(stat2.mtimeMs).toBe(stat1.mtimeMs)
    })

    it("succeeds on a fresh state dir with no arguments", async () => {
        const tmpDir = await makeTmpDir()
        process.env.PROPOSIT_HOME = tmpDir

        // No arguments directory at all.
        await expect(migrateV011()).resolves.toBeUndefined()

        // Marker written.
        await expect(
            fs.access(path.join(tmpDir, ".proposit-v0.11"))
        ).resolves.toBeUndefined()
    })

    it("marker prevents re-running when already present", async () => {
        const tmpDir = await makeTmpDir()
        process.env.PROPOSIT_HOME = tmpDir

        // Pre-write the marker.
        await fs.mkdir(tmpDir, { recursive: true })
        await fs.writeFile(path.join(tmpDir, ".proposit-v0.11"), "2026-01-01")

        // Write a premise WITHOUT type.
        await writePremiseMeta(tmpDir, "arg-1", 0, "prem-skip", {
            id: "prem-skip",
        })

        await migrateV011()

        // Migration was skipped — premise type should still be absent.
        const meta = await readPremiseMeta(tmpDir, "arg-1", 0, "prem-skip")
        expect(meta.type).toBeUndefined()
    })
})
