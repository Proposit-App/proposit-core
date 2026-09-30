import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../src/cli/output.js", () => ({
    printLine: vi.fn(),
    printJson: vi.fn(),
    printWarning: vi.fn(),
    errorExit: mockErrorExit,
    requireConfirmation: vi.fn(),
}))

const mockErrorExit = vi.hoisted(() =>
    vi.fn((message: string) => {
        throw new Error(`errorExit: ${message}`)
    })
)

vi.mock("../../src/cli/engine.js", () => ({
    hydrateEngine: vi.fn(),
}))

const mockReadAnalysis = vi.hoisted(() => vi.fn())
const mockWriteAnalysis = vi.hoisted(() => vi.fn())
vi.mock("../../src/cli/storage/analysis.js", () => ({
    analysisFileExists: vi.fn(() => Promise.resolve(false)),
    deleteAnalysisFile: vi.fn(),
    listAnalysisFiles: vi.fn(() => Promise.resolve([])),
    nextAnalysisFilename: vi.fn(),
    readAnalysis: mockReadAnalysis,
    resolveAnalysisFilename: (filename: string | undefined) =>
        Promise.resolve(filename ?? "analysis-1.json"),
    writeAnalysis: mockWriteAnalysis,
}))

const { registerAnalysisCommands } =
    await import("../../src/cli/commands/analysis.js")

import { Command } from "commander"

beforeEach(() => {
    vi.clearAllMocks()
})

async function run(...args: string[]): Promise<void> {
    const program = new Command()
    program.exitOverride()
    registerAnalysisCommands(program, "arg-1", 1)
    await program.parseAsync(["node", "proposit-core", ...args])
}

// Every analysis command that names a file reports a missing one the same
// way, before reading it or acting on any other option.
describe("analysis commands on a file that does not exist", () => {
    it("show reports the missing file", async () => {
        await expect(
            run("analysis", "show", "--file", "missing.json")
        ).rejects.toThrow(
            'errorExit: Analysis file "missing.json" does not exist.'
        )
        expect(mockReadAnalysis).not.toHaveBeenCalled()
    })

    it("reset reports the missing file before checking the value", async () => {
        await expect(
            run(
                "analysis",
                "reset",
                "--file",
                "missing.json",
                "--value",
                "maybe"
            )
        ).rejects.toThrow(
            'errorExit: Analysis file "missing.json" does not exist.'
        )
        expect(mockReadAnalysis).not.toHaveBeenCalled()
        expect(mockWriteAnalysis).not.toHaveBeenCalled()
    })
})
