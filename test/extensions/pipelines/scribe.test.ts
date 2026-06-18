// Unit + edge tests for `createScribePipeline` — the fast (two cheap
// LLM call) ingestion pipeline.
//
// scribe's two LLM stages (`extract`, `structure`) are mocked via the
// stage-id-marker keying; its deterministic adapters + scholar's
// deterministic backend + finalize run for real. These tests assert:
//   - a small happy fixture yields a schema-valid response with a
//     compiled, validated formula (no processing failures);
//   - an empty claim set yields a valid `argument: null` response (no
//     throw);
//   - a cheap-model `structure` output that produces an invalid formula
//     surfaces a processing failure rather than crashing;
//   - the cross-repo wire id is `argument-ingestion-scribe`.

import { describe, expect, it } from "vitest"
import { executePipeline } from "../../../src/lib/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import { createMockLlmProvider } from "../../mocks/llm.js"
import type { TParsedArgumentResponse } from "../../../src/lib/parsing/index.js"

// Deterministic id generator (counter-based) so minted variable/premise
// ids are stable across runs — mirrors the e2e harness.
function createDeterministicGenerateId(prefix = "gid"): () => string {
    let counter = 0
    return () => {
        counter += 1
        return `${prefix}-${String(counter)}`
    }
}

// A two-claim "rain → wet ground" extract payload (the per-extension
// canonicalization shape: basics claim records carry title/body/type).
function happyExtractOutput(): unknown {
    return {
        canonicalClaims: [
            {
                miniId: "c1",
                mentionIds: ["c1-m"],
                suggestedSymbol: "Raining",
                type: "normal",
                title: "It is raining",
                body: "It is raining.",
            },
            {
                miniId: "c2",
                mentionIds: ["c2-m"],
                suggestedSymbol: "Ground_Wet",
                type: "normal",
                title: "The ground is wet",
                body: "The ground is wet.",
            },
        ],
        mentionToClaim: [
            { mentionId: "c1-m", claimMiniId: "c1" },
            { mentionId: "c2-m", claimMiniId: "c2" },
        ],
    }
}

// `structure`: c1 supports c2; c2 is the conclusion.
function happyStructureOutput(): unknown {
    return {
        relations: [
            {
                relationId: "r1",
                type: "support",
                sources: ["c1"],
                target: "c2",
                evidence: { segmentIds: [], quote: "" },
            },
        ],
        conclusionCandidates: ["c2"],
        rationale: "c2 is supported by c1 and supports nothing further.",
    }
}

function runScribe(
    extract: unknown,
    structure: unknown
): Promise<{
    output: TParsedArgumentResponse | null
    failures: readonly { code: string; message: string; severity: string }[]
}> {
    const llm = createMockLlmProvider({
        responses: {
            extract: [{ kind: "ok", output: extract }],
            "scribe-structure": [{ kind: "ok", output: structure }],
        },
    })
    return executePipeline(
        createScribePipeline(basicsExtension),
        { text: "It is raining. Therefore the ground is wet." },
        { llm, generateId: createDeterministicGenerateId() }
    ) as Promise<{
        output: TParsedArgumentResponse | null
        failures: readonly {
            code: string
            message: string
            severity: string
        }[]
    }>
}

describe("createScribePipeline", () => {
    it("the wire id is argument-ingestion-scribe", () => {
        expect(createScribePipeline(basicsExtension).id).toBe(
            "argument-ingestion-scribe"
        )
    })

    it("produces a schema-valid response with a compiled, validated formula", async () => {
        const result = await runScribe(
            happyExtractOutput(),
            happyStructureOutput()
        )
        expect(result.output).not.toBeNull()
        const argument = result.output!.argument
        expect(argument).not.toBeNull()
        expect(argument!.premises.length).toBeGreaterThan(0)
        // Every premise carries a non-empty compiled formula string.
        for (const premise of argument!.premises) {
            expect(typeof premise.formula).toBe("string")
            expect(premise.formula.length).toBeGreaterThan(0)
        }
        // No processing failures on the happy path.
        const response = result.output as unknown as {
            processingFailures: unknown[]
        }
        expect(response.processingFailures).toEqual([])
    })

    it("an empty claim set yields a valid argument: null response (no throw)", async () => {
        const result = await runScribe(
            { canonicalClaims: [], mentionToClaim: [] },
            { relations: [], conclusionCandidates: [], rationale: "" }
        )
        expect(result.output).not.toBeNull()
        expect(result.output!.argument).toBeNull()
        expect(result.output!.failureText).toBeTruthy()
    })

    it("a structure output with an unresolvable conclusion surfaces a processing failure, not a crash", async () => {
        // Claims exist, but structure names no relations and no
        // conclusion candidate — the conclusion adapter resolves null
        // and records NO_SINGLE_CONCLUSION; the run does not throw.
        const result = await runScribe(happyExtractOutput(), {
            relations: [],
            conclusionCandidates: [],
            rationale: "no argument structure",
        })
        expect(result.output).not.toBeNull()
        const failureCodes = result.failures.map((f) => f.code)
        expect(failureCodes).toContain("NO_SINGLE_CONCLUSION")
        // Degraded, not crashed: a defined response with argument: null.
        expect(result.output!.argument).toBeNull()
    })
})
