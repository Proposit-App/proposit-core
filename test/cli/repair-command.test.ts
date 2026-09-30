import { describe, it, expect, vi, beforeEach } from "vitest"

const printedLines: string[] = []

vi.mock("../../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
    printJson: mockPrintJson,
    printWarning: vi.fn(),
    errorExit: mockErrorExit,
    requireConfirmation: vi.fn(),
}))

const mockPrintJson = vi.hoisted(() => vi.fn())

const mockErrorExit = vi.hoisted(() =>
    vi.fn((message: string) => {
        throw new Error(`errorExit: ${message}`)
    })
)

const mockHydrateEngine = vi.hoisted(() => vi.fn())
const mockPersistEngine = vi.hoisted(() => vi.fn())
vi.mock("../../src/cli/engine.js", () => ({
    hydrateEngine: mockHydrateEngine,
    persistEngine: mockPersistEngine,
}))

vi.mock("../../src/cli/storage/premises.js", () => ({
    listPremiseIds: vi.fn(() => Promise.resolve(["p1"])),
    readPremiseData: vi.fn(() => Promise.resolve({ expressions: [] })),
    premiseExists: vi.fn(() => Promise.resolve(true)),
}))

const mockReadVersionMeta = vi.hoisted(() => vi.fn())
vi.mock("../../src/cli/storage/arguments.js", () => ({
    readVersionMeta: mockReadVersionMeta,
}))

const { registerRepairCommand } =
    await import("../../src/cli/commands/repair.js")

import { Command } from "commander"

beforeEach(() => {
    printedLines.length = 0
    vi.clearAllMocks()
    // The stored premise has no expressions and the hydrated engine has one,
    // so the repair inserted one formula buffer and would write it back.
    mockHydrateEngine.mockResolvedValue({
        listPremises: () => [{ getExpressions: () => [{ id: "buffer" }] }],
    })
})

async function run(...args: string[]): Promise<void> {
    const program = new Command()
    program.exitOverride()
    registerRepairCommand(program, "arg-1", 1)
    await program.parseAsync(["node", "proposit-core", ...args])
}

describe("repair on a published version", () => {
    beforeEach(() => {
        mockReadVersionMeta.mockResolvedValue({ published: true })
    })

    it("refuses to write the repair", async () => {
        await expect(run("repair")).rejects.toThrow(
            'errorExit: Version 1 of argument "arg-1" is published and cannot be modified.'
        )
        expect(mockPersistEngine).not.toHaveBeenCalled()
    })

    it("refuses to write the repair with --json, before printing a result", async () => {
        await expect(run("repair", "--json")).rejects.toThrow(
            /is published and cannot be modified/
        )
        expect(mockPersistEngine).not.toHaveBeenCalled()
        expect(mockPrintJson).not.toHaveBeenCalled()
    })

    it("still reports what it would repair with --dry-run, which writes nothing", async () => {
        await run("repair", "--dry-run")
        expect(printedLines).toEqual(["Would insert 1 formula buffer(s)"])
        expect(mockPersistEngine).not.toHaveBeenCalled()
    })
})

describe("repair on a draft version", () => {
    beforeEach(() => {
        mockReadVersionMeta.mockResolvedValue({ published: false })
    })

    it("writes the repair", async () => {
        await run("repair")
        expect(mockPersistEngine).toHaveBeenCalledOnce()
        expect(printedLines).toEqual(["Repaired: inserted 1 formula buffer(s)"])
    })
})
