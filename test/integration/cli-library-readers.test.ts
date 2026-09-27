import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import {
    readAxiomLibrary,
    readCitationLibrary,
    readClaimLibrary,
    readForkLibrary,
    readOriginLibrary,
} from "../../src/cli/storage/libraries.js"
import { ClaimLibrary } from "../../src/lib/core/claim-library.js"

// A library file that exists but cannot be loaded must stop the command. If
// the reader handed back an empty library instead, the command's next write
// would save that empty library over the file and erase everything in it.

let stateDir: string
let stderrWrite: ReturnType<typeof vi.spyOn>
const originalHome = process.env.PROPOSIT_HOME

beforeEach(async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "proposit-readers-"))
    process.env.PROPOSIT_HOME = stateDir
    vi.spyOn(process, "exit").mockImplementation((code) => {
        throw new Error(`process.exit(${String(code)})`)
    })
    stderrWrite = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true)
})

afterEach(async () => {
    vi.restoreAllMocks()
    if (originalHome === undefined) delete process.env.PROPOSIT_HOME
    else process.env.PROPOSIT_HOME = originalHome
    await fs.rm(stateDir, { recursive: true, force: true })
})

const readers: [string, () => Promise<unknown>][] = [
    ["claims.json", readClaimLibrary],
    ["citations.json", () => readCitationLibrary(new ClaimLibrary())],
    ["axioms.json", () => readAxiomLibrary(new ClaimLibrary())],
    ["origins.json", readOriginLibrary],
    ["forks.json", readForkLibrary],
]

describe("CLI library readers", () => {
    for (const [file, read] of readers) {
        it(`${file}: a corrupt file stops the command and is left untouched`, async () => {
            const filePath = path.join(stateDir, file)
            await fs.writeFile(filePath, "{ not json")
            await expect(read()).rejects.toThrow("process.exit(1)")
            expect(stderrWrite).toHaveBeenCalledWith(
                expect.stringContaining(filePath)
            )
            expect(await fs.readFile(filePath, "utf-8")).toBe("{ not json")
        })

        it(`${file}: an unreadable file stops the command with its path`, async () => {
            const filePath = path.join(stateDir, file)
            await fs.writeFile(filePath, "{}")
            await fs.chmod(filePath, 0o000)
            try {
                await expect(read()).rejects.toThrow("process.exit(1)")
                expect(stderrWrite).toHaveBeenCalledWith(
                    expect.stringContaining(filePath)
                )
            } finally {
                await fs.chmod(filePath, 0o644)
            }
        })

        it(`${file}: a missing file gives an empty library`, async () => {
            await expect(read()).resolves.toBeDefined()
        })
    }
})

describe("CLI origin library read", () => {
    it("drops a stored anchor on a premise and keeps the rest", async () => {
        const { OriginLibrary } =
            await import("../../src/lib/core/origin-library.js")
        const origins = new OriginLibrary()
        origins.addDocument({ id: "doc-1", text: "All swans are white." })
        origins.addLink({
            id: "link-1",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            stance: "seed",
        })
        const kept = origins.addAnchor({
            id: "anchor-expression",
            argumentId: "arg-1",
            argumentVersion: 0,
            documentId: "doc-1",
            targetType: "expression",
            targetId: "expr-1",
            exact: "All swans",
            startCodePoint: 0,
            endCodePoint: 9,
        })
        const snapshot = origins.snapshot()
        snapshot.anchors.push({
            ...kept,
            id: "anchor-premise",
            targetType: "premise" as never,
            targetId: "prem-1",
        })
        await fs.writeFile(
            path.join(stateDir, "origins.json"),
            JSON.stringify(snapshot)
        )

        const loaded = await readOriginLibrary()
        expect(loaded.getAllAnchors().map((a) => a.id)).toEqual([
            "anchor-expression",
        ])
    })
})

describe("CLI premise meta read", () => {
    it("drops a stored enthymeme key and keeps the rest", async () => {
        const { readPremiseMeta } =
            await import("../../src/cli/storage/premises.js")
        const premiseId = "33333333-3333-4333-8333-333333333333"
        const dir = path.join(
            stateDir,
            "arguments",
            "arg-1",
            "0",
            "premises",
            premiseId
        )
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(
            path.join(dir, "meta.json"),
            JSON.stringify({ id: premiseId, title: "kept", enthymeme: true })
        )

        const meta = await readPremiseMeta("arg-1", 0, premiseId)
        expect(meta).toEqual({ id: premiseId, title: "kept" })
    })
})
