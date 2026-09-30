import { describe, it, expect, vi, beforeEach } from "vitest"

const printedLines: string[] = []

vi.mock("../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
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

const mockHydrateEngine = vi.fn()
vi.mock("../src/cli/engine.js", () => ({
    hydrateEngine: mockHydrateEngine,
}))

const { registerAnalysisCommands } =
    await import("../src/cli/commands/analysis.js")

import { Command } from "commander"

beforeEach(() => {
    printedLines.length = 0
    vi.clearAllMocks()
})

function makeProgram(): Command {
    const program = new Command()
    program.exitOverride()
    registerAnalysisCommands(program, "arg-1", 1)
    return program
}

async function run(...args: string[]): Promise<void> {
    await makeProgram().parseAsync(["node", "proposit-core", ...args])
}

describe("analysis check-validity --mode", () => {
    const checkValidity = vi.fn()

    beforeEach(() => {
        checkValidity.mockReturnValue({
            ok: true,
            isValid: true,
            truncated: false,
            numAssignmentsChecked: 0,
            numAdmissibleAssignments: 0,
            counterexamples: [],
        })
        mockHydrateEngine.mockResolvedValue({ checkValidity })
    })

    it("refuses a mode it does not recognise before reading the argument", async () => {
        await expect(
            run("analysis", "check-validity", "--mode", "exhastive")
        ).rejects.toThrow("errorExit")
        expect(mockErrorExit).toHaveBeenCalledWith(
            'Mode must be "first-counterexample" or "exhaustive", got "exhastive".'
        )
        expect(mockHydrateEngine).not.toHaveBeenCalled()
    })

    it("runs the exhaustive search when asked", async () => {
        await run("analysis", "check-validity", "--mode", "exhaustive")
        expect(checkValidity).toHaveBeenCalledTimes(1)
        expect(checkValidity).toHaveBeenCalledWith(
            expect.objectContaining({ mode: "exhaustive" })
        )
    })

    it("runs the first-counterexample search by default", async () => {
        await run("analysis", "check-validity")
        expect(checkValidity).toHaveBeenCalledWith(
            expect.objectContaining({ mode: "firstCounterexample" })
        )
    })
})
