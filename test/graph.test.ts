import { describe, it, expect } from "vitest"
import { PropositCore } from "../src/lib/core/proposit-core"
import { buildDotGraph } from "../src/cli/commands/graph"

describe("buildDotGraph", () => {
    describe("newline handling in DOT labels", () => {
        it("should produce DOT \\n (not \\\\n) in cluster labels for premises with titles", () => {
            const core = new PropositCore()
            const argData = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(argData)
            const engine = core.arguments.get(argData.id)!

            // Create a premise with a title (uses additionalProperties)
            engine.createPremise({ title: "My Premise Title" })

            // The premise should have a display string (even if empty)
            const dot = buildDotGraph(engine, core)

            // In the DOT output, find the cluster label for this premise.
            // It should contain the title followed by \n (DOT newline),
            // NOT \\n (escaped backslash + n, which renders literally).
            //
            // Correct:   label="My Premise Title\n(empty)"
            // Bug:       label="My Premise Title\\n(empty)"
            expect(dot).toContain('label="My Premise Title\\n')
            expect(dot).not.toContain('label="My Premise Title\\\\n')
        })

        it("should produce DOT \\n in conclusion cluster labels with [CONCLUSION] suffix", () => {
            const core = new PropositCore()
            const argData = { id: crypto.randomUUID(), version: 0 }
            core.arguments.create(argData)
            const engine = core.arguments.get(argData.id)!

            // Create a premise with a title
            engine.createPremise({ title: "Conclusion Title" })

            const dot = buildDotGraph(engine, core)

            // Conclusion labels should also have proper \n
            expect(dot).toContain("Conclusion Title\\n")
            expect(dot).not.toContain("Conclusion Title\\\\n")
        })
    })
})

describe("buildDotGraph — operator node labels", () => {
    it("labels an exclusive-disjunction node XOR", () => {
        const core = new PropositCore()
        const argData = { id: crypto.randomUUID(), version: 0 }
        core.arguments.create(argData)
        const engine = core.arguments.get(argData.id)!
        // Assistive behavior runs AN-3 after every mutation, which collapses
        // an operator that has no children yet — the node under test.
        engine.setBehavior("permissive")
        engine.createPremise({ title: "Exclusive" })
        const premise = engine.listPremises()[0]

        premise.addExpression({
            id: crypto.randomUUID(),
            argumentId: argData.id,
            argumentVersion: 0,
            premiseId: premise.getId(),
            type: "operator",
            operator: "xor",
            parentId: null,
            position: 0,
        })

        const dot = buildDotGraph(engine, core)
        expect(dot).toContain('label="XOR"')
    })
})
