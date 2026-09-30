import { describe, it, expect, vi, beforeEach } from "vitest"

const printedLines: string[] = []

vi.mock("../src/cli/output.js", () => ({
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

const mockHydrateEngine = vi.fn()
vi.mock("../src/cli/engine.js", () => ({
    hydrateEngine: mockHydrateEngine,
}))

const { registerAnalysisCommands } =
    await import("../src/cli/commands/analysis.js")

import { Command } from "commander"
import { ArgumentEngine } from "../src/lib/core/argument-engine.js"
import { ClaimLibrary } from "../src/lib/core/claim-library.js"
import type { TExpressionInput } from "../src/lib/core/expression-manager.js"
import type { TCorePropositionalExpression } from "../src/lib/schemata/index.js"
import { importArgumentFromYaml } from "../src/cli/import.js"

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

// Premises P and P -> Q with the conclusion Q, plus one more premise whose only
// expression is the premise-bound variable of the "P is true" premise, marked
// unspoken. Grammar rule P-6 reports that mark, at the Presentable tier only.
function buildFixtureA() {
    const { engine } = importArgumentFromYaml(`
metadata:
    title: "Modus Ponens"
premises:
    - metadata:
          title: "P is true"
      formula: "P"
    - metadata:
          title: "P implies Q"
      formula: "P -> Q"
    - metadata:
          title: "Q follows"
      role: "conclusion"
      formula: "Q"
`)
    const pTrue = engine
        .listPremises()
        .find(
            (pm) =>
                (pm.toPremiseData() as { title?: string }).title === "P is true"
        )
    if (pTrue === undefined) throw new Error('No premise titled "P is true".')
    const [boundVariable] = engine.getVariablesBoundToPremise(pTrue.getId())
    if (boundVariable === undefined) {
        throw new Error('No variable is bound to the "P is true" premise.')
    }
    const argument = engine.getArgument()
    const { result: restates } = engine.createPremise()
    restates.addExpression({
        id: "restates-p",
        type: "variable",
        variableId: boundVariable.id,
        argumentId: argument.id,
        argumentVersion: argument.version,
        premiseId: restates.getId(),
        parentId: null,
        position: 0,
    } as TExpressionInput<TCorePropositionalExpression>)
    engine.patchExpressionAppFields("restates-p", { enthymeme: true })
    engine.flushChecksums()
    return engine
}

function buildEmptyArgument() {
    return new ArgumentEngine(
        { id: "arg-empty", version: 0 },
        new ClaimLibrary()
    )
}

function readinessLines(engine: {
    validateEvaluability(): {
        ok: boolean
        issues: { severity: string; code: string; message: string }[]
    }
}): string[] {
    const result = engine.validateEvaluability()
    return [
        result.ok ? "ok" : "invalid",
        ...result.issues.map(
            (issue) => `${issue.severity} ${issue.code}: ${issue.message}`
        ),
    ]
}

describe("analysis validate-argument fixtures", () => {
    it("fixture A breaks only P-6, and only at the Presentable tier", () => {
        const engine = buildFixtureA()
        expect(engine.validateEvaluability()).toEqual({ ok: true, issues: [] })
        for (const tier of ["structural", "evaluable", "derivable"] as const) {
            expect(engine.validate(tier)).toEqual([])
        }
        expect(engine.validate("presentable").map((v) => v.code)).toEqual([
            "P-6",
        ])
    })

    it("the empty argument has no conclusion and no grammar violations", () => {
        const engine = buildEmptyArgument()
        expect(
            engine.validateEvaluability().issues.map((issue) => issue.code)
        ).toEqual(["ARGUMENT_NO_CONCLUSION"])
        expect(engine.validate("presentable")).toEqual([])
    })
})

describe("analysis validate-argument without --tier", () => {
    const fixtures = [
        ["fixture A", buildFixtureA],
        ["the empty argument", buildEmptyArgument],
    ] as const

    for (const [name, build] of fixtures) {
        it(`prints today's readiness lines for ${name}`, async () => {
            const engine = build()
            mockHydrateEngine.mockResolvedValue(engine)
            await run("analysis", "validate-argument")
            expect(printedLines).toEqual(readinessLines(engine))
        })

        it(`prints today's readiness object as JSON for ${name}`, async () => {
            const engine = build()
            mockHydrateEngine.mockResolvedValue(engine)
            await run("analysis", "validate-argument", "--json")
            expect(mockPrintJson).toHaveBeenCalledTimes(1)
            const printed = mockPrintJson.mock.calls[0][0] as object
            expect(printed).toEqual(engine.validateEvaluability())
            expect(printed).not.toHaveProperty("tier")
            expect(printed).not.toHaveProperty("violations")
        })
    }

    it("prints the missing conclusion for the empty argument", async () => {
        mockHydrateEngine.mockResolvedValue(buildEmptyArgument())
        await run("analysis", "validate-argument")
        expect(printedLines).toEqual([
            "invalid",
            "error ARGUMENT_NO_CONCLUSION: Argument has no designated conclusion premise.",
        ])
    })
})
