import { describe, it, expect, vi, beforeEach } from "vitest"

const printedLines: string[] = []
let printedJson: unknown = undefined
let _exitMessage: string | undefined = undefined

vi.mock("../src/cli/output.js", () => ({
    printLine: (text: string) => {
        printedLines.push(text)
    },
    printJson: (value: unknown) => {
        printedJson = value
    },
    errorExit: (message: string) => {
        _exitMessage = message
        throw new Error(`errorExit: ${message}`)
    },
}))

// Mock hydrateEngine to return minimal ArgumentEngine stubs
const mockHydrateEngine = vi.fn()
vi.mock("../src/cli/engine.js", () => ({
    hydrateEngine: mockHydrateEngine,
}))

// Mock resolveVersion to return the version number as-is
const mockResolveVersion = vi.fn()
vi.mock("../src/cli/router.js", () => ({
    resolveVersion: mockResolveVersion,
}))

// Mock diffArguments to return a controllable diff
const mockDiffArguments = vi.fn()
vi.mock("../src/lib/core/diff.js", () => ({
    diffArguments: mockDiffArguments,
}))

// Mock renderDiff and isDiffEmpty
const mockRenderDiff = vi.fn()
const mockIsDiffEmpty = vi.fn()
vi.mock("../src/cli/output/diffRenderer.js", () => ({
    renderDiff: mockRenderDiff,
    isDiffEmpty: mockIsDiffEmpty,
}))

const { registerDiffCommand } = await import("../src/cli/commands/diff.js")

import { Command } from "commander"

beforeEach(() => {
    printedLines.length = 0
    printedJson = undefined
    _exitMessage = undefined
    vi.clearAllMocks()
})

describe("registerDiffCommand", () => {
    function makeProgram(): Command {
        const program = new Command()
        program.exitOverride()
        registerDiffCommand(program)
        return program
    }

    const emptyDiff = {
        argument: { before: {}, after: {}, changes: [] },
        variables: { added: [], removed: [], modified: [] },
        premises: { added: [], removed: [], modified: [] },
        roles: {
            conclusion: { before: undefined, after: undefined },
            supportingAdded: [],
            supportingRemoved: [],
        },
    }

    it("parses 3-arg shorthand (same argument, two versions)", async () => {
        mockResolveVersion.mockResolvedValue(1)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)
        mockIsDiffEmpty.mockReturnValue(true)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "myarg",
            "0",
            "1",
        ])

        expect(mockResolveVersion).toHaveBeenCalledWith("myarg", "0")
        expect(mockResolveVersion).toHaveBeenCalledWith("myarg", "1")
        expect(mockHydrateEngine).toHaveBeenCalledTimes(2)
    })

    it("parses 4-arg full form (cross-argument)", async () => {
        mockResolveVersion.mockResolvedValue(0)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)
        mockIsDiffEmpty.mockReturnValue(true)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "argA",
            "0",
            "argB",
            "1",
        ])

        expect(mockResolveVersion).toHaveBeenCalledWith("argA", "0")
        expect(mockResolveVersion).toHaveBeenCalledWith("argB", "1")
    })

    it("outputs JSON when --json is passed", async () => {
        mockResolveVersion.mockResolvedValue(0)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "myarg",
            "0",
            "1",
            "--json",
        ])

        expect(printedJson).toEqual(emptyDiff)
        expect(mockRenderDiff).not.toHaveBeenCalled()
    })

    it("calls renderDiff for human-readable output", async () => {
        mockResolveVersion.mockResolvedValue(0)
        mockHydrateEngine.mockResolvedValue({})
        mockDiffArguments.mockReturnValue(emptyDiff)
        mockIsDiffEmpty.mockReturnValue(false)

        const program = makeProgram()
        await program.parseAsync([
            "node",
            "proposit-core",
            "diff",
            "myarg",
            "0",
            "1",
        ])

        expect(mockRenderDiff).toHaveBeenCalledWith(emptyDiff)
    })

    it("exits with error for fewer than 3 positional args", async () => {
        const program = makeProgram()
        await expect(
            program.parseAsync(["node", "proposit-core", "diff", "myarg", "0"])
        ).rejects.toThrow()
    })
})
