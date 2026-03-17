import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { importArgumentFromYaml } from "../src/cli/import"
import type { TCoreExpressionAssignment } from "../src/lib/types/evaluation"

const __dirname = dirname(fileURLToPath(import.meta.url))
const examplesDir = resolve(__dirname, "../examples/arguments")

function loadExample(filename: string): string {
    return readFileSync(resolve(examplesDir, filename), "utf-8")
}

/** Build a variable-id lookup from the first premise's variable list. */
function variableMap(
    engine: ReturnType<typeof importArgumentFromYaml>["engine"]
): Map<string, string> {
    const vars = engine.listPremises()[0].getVariables()
    return new Map(vars.map((v) => [v.symbol, v.id]))
}

/** Build an assignment from a symbol→boolean map. */
function makeAssignment(
    vars: Map<string, string>,
    values: Record<string, boolean>
): TCoreExpressionAssignment {
    const variables: Record<string, boolean> = {}
    for (const [symbol, value] of Object.entries(values)) {
        const id = vars.get(symbol)
        if (!id) throw new Error(`Unknown variable symbol: ${symbol}`)
        variables[id] = value
    }
    return { variables, rejectedExpressionIds: [] }
}

// ---------------------------------------------------------------------------
// Monopoly Regulation (valid argument)
// ---------------------------------------------------------------------------

describe("monopoly-regulation.yaml", () => {
    const { engine } = importArgumentFromYaml(
        loadExample("monopoly-regulation.yaml")
    )

    it("has the correct title and description", () => {
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("The Case for Monopoly Regulation")
        expect(arg.description).toContain("market dominance")
    })

    it("has 5 premises with 4 variables", () => {
        expect(engine.listPremises()).toHaveLength(5)
        const vars = engine.listPremises()[0].getVariables()
        const symbols = vars.map((v) => v.symbol).sort()
        expect(symbols).toEqual([
            "Competition",
            "ConsumerHarm",
            "MarketDominance",
            "RegulatoryIntervention",
        ])
    })

    it("has 2 constraint premises and 3 inference premises", () => {
        const premises = engine.listPremises()
        const constraints = premises.filter((p) => p.isConstraint())
        const inferences = premises.filter((p) => p.isInference())
        expect(constraints).toHaveLength(2)
        expect(inferences).toHaveLength(3)
    })

    it("assigns the correct conclusion", () => {
        const conclusion = engine.getConclusionPremise()
        expect(conclusion).not.toBeNull()
        expect(conclusion!.getExtras().title).toBe(
            "Market dominance without competition justifies regulation"
        )
    })

    it("is a valid argument", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.ok).toBe(true)
        expect(result.isValid).toBe(true)
        expect(result.numAssignmentsChecked).toBe(16) // 2^4
        // Only assignments where MarketDominance=true AND Competition=false
        // satisfy the constraint premises (4 of 16)
        expect(result.numAdmissibleAssignments).toBe(4)
        expect(result.counterexamples).toHaveLength(0)
    })

    it("evaluates the canonical scenario as truth-preserving", () => {
        const vars = variableMap(engine)
        const assignment = makeAssignment(vars, {
            MarketDominance: true,
            Competition: false,
            ConsumerHarm: true,
            RegulatoryIntervention: true,
        })
        const result = engine.evaluate(assignment)
        expect(result.ok).toBe(true)
        expect(result.allSupportingPremisesTrue).toBe(true)
        expect(result.conclusionTrue).toBe(true)
        expect(result.isCounterexample).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Education Reform (valid argument)
// ---------------------------------------------------------------------------

describe("education-reform.yaml", () => {
    const { engine } = importArgumentFromYaml(
        loadExample("education-reform.yaml")
    )

    it("has the correct title", () => {
        expect((engine.getArgument() as Record<string, unknown>).title).toBe(
            "Education Reform Through Funding"
        )
    })

    it("has 5 premises with 5 variables", () => {
        expect(engine.listPremises()).toHaveLength(5)
        const symbols = engine
            .listPremises()[0]
            .getVariables()
            .map((v) => v.symbol)
            .sort()
        expect(symbols).toEqual([
            "LackOfFunding",
            "Overcrowding",
            "PoorOutcomes",
            "ReformNeeded",
            "TeacherShortage",
        ])
    })

    it("has 1 constraint premise and 4 inference premises", () => {
        const premises = engine.listPremises()
        expect(premises.filter((p) => p.isConstraint())).toHaveLength(1)
        expect(premises.filter((p) => p.isInference())).toHaveLength(4)
    })

    it("is a valid argument", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.ok).toBe(true)
        expect(result.isValid).toBe(true)
        expect(result.numAssignmentsChecked).toBe(32) // 2^5
        expect(result.counterexamples).toHaveLength(0)
    })

    it("evaluates the canonical scenario as truth-preserving", () => {
        const vars = variableMap(engine)
        const assignment = makeAssignment(vars, {
            LackOfFunding: true,
            Overcrowding: true,
            TeacherShortage: true,
            PoorOutcomes: true,
            ReformNeeded: true,
        })
        const result = engine.evaluate(assignment)
        expect(result.ok).toBe(true)
        expect(result.allSupportingPremisesTrue).toBe(true)
        expect(result.conclusionTrue).toBe(true)
        expect(result.isCounterexample).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Exam Performance (invalid argument — non sequitur)
// ---------------------------------------------------------------------------

describe("exam-performance.yaml", () => {
    const { engine } = importArgumentFromYaml(
        loadExample("exam-performance.yaml")
    )

    it("has the correct title", () => {
        expect((engine.getArgument() as Record<string, unknown>).title).toBe(
            "Studying Guarantees Mastery"
        )
    })

    it("has 4 premises with 4 variables", () => {
        expect(engine.listPremises()).toHaveLength(4)
        const symbols = engine
            .listPremises()[0]
            .getVariables()
            .map((v) => v.symbol)
            .sort()
        expect(symbols).toEqual([
            "MasteredSubject",
            "PassedExam",
            "Prepared",
            "StudiedHard",
        ])
    })

    it("has 1 constraint premise and 3 inference premises", () => {
        const premises = engine.listPremises()
        expect(premises.filter((p) => p.isConstraint())).toHaveLength(1)
        expect(premises.filter((p) => p.isInference())).toHaveLength(3)
    })

    it("is an invalid argument", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.ok).toBe(true)
        expect(result.isValid).toBe(false)
        expect(result.numAssignmentsChecked).toBe(16) // 2^4
        expect(result.counterexamples!.length).toBeGreaterThan(0)
    })

    it("has exactly one counterexample", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.counterexamples).toHaveLength(1)
    })

    it("the counterexample has all supports true but conclusion false", () => {
        const result = engine.checkValidity({
            mode: "exhaustive",
            includeCounterexampleEvaluations: true,
        })
        const ce = result.counterexamples![0]
        expect(ce.result.ok).toBe(true)
        expect(ce.result.allSupportingPremisesTrue).toBe(true)
        expect(ce.result.conclusionTrue).toBe(false)
        expect(ce.result.isCounterexample).toBe(true)
    })

    it("the counterexample assigns PassedExam=true, MasteredSubject=false", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        const vars = variableMap(engine)
        const ce = result.counterexamples![0]
        expect(ce.assignment.variables[vars.get("PassedExam")!]).toBe(true)
        expect(ce.assignment.variables[vars.get("MasteredSubject")!]).toBe(
            false
        )
    })
})

// ---------------------------------------------------------------------------
// Free Speech / Misinformation (invalid argument — non sequitur)
// ---------------------------------------------------------------------------

describe("free-speech-misinformation.yaml", () => {
    const { engine } = importArgumentFromYaml(
        loadExample("free-speech-misinformation.yaml")
    )

    it("has the correct title", () => {
        expect((engine.getArgument() as Record<string, unknown>).title).toBe(
            "Free Speech Undermines Public Safety"
        )
    })

    it("has 5 premises with 4 variables", () => {
        expect(engine.listPremises()).toHaveLength(5)
        const symbols = engine
            .listPremises()[0]
            .getVariables()
            .map((v) => v.symbol)
            .sort()
        expect(symbols).toEqual([
            "FreeSpeech",
            "MisinformationSpreads",
            "PublicSafety",
            "UnrestrictedExpression",
        ])
    })

    it("has 2 constraint premises and 3 inference premises", () => {
        const premises = engine.listPremises()
        expect(premises.filter((p) => p.isConstraint())).toHaveLength(2)
        expect(premises.filter((p) => p.isInference())).toHaveLength(3)
    })

    it("is an invalid argument", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.ok).toBe(true)
        expect(result.isValid).toBe(false)
        expect(result.numAssignmentsChecked).toBe(16) // 2^4
        expect(result.counterexamples!.length).toBeGreaterThan(0)
    })

    it("has exactly one counterexample", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        expect(result.counterexamples).toHaveLength(1)
    })

    it("the counterexample has PublicSafety=true (not undermined)", () => {
        const result = engine.checkValidity({ mode: "exhaustive" })
        const vars = variableMap(engine)
        const ce = result.counterexamples![0]
        // The conclusion claims FreeSpeech → ¬PublicSafety, but the
        // counterexample shows PublicSafety can be true while all
        // supporting premises hold — the conclusion is a non sequitur.
        expect(ce.assignment.variables[vars.get("FreeSpeech")!]).toBe(true)
        expect(ce.assignment.variables[vars.get("PublicSafety")!]).toBe(true)
    })
})
