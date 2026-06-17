// Pins the load-bearing reuse invariant: scribe reuses scholar's four
// deterministic stage consts BY REFERENCE (not a reconstruction), and
// populates the six standard stage-output slots `finalizeResponseV2`
// reads. A future edit that makes scribe rebuild a deterministic stage
// (silently diverging the two pipelines) fails here.

import { describe, expect, it } from "vitest"
import { isLlmStage } from "../../../src/lib/index.js"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import {
    STAGE_IDS,
    claimReferenceValidationStage,
    variableAssignmentStage,
    formulaCompilationStage,
    formulaValidationStage,
} from "../../../src/extensions/pipelines/base/stages/index.js"

describe("scribe reuses scholar's deterministic stages (the reuse invariant)", () => {
    const scholar = createScholarPipeline(basicsExtension)
    const scribe = createScribePipeline(basicsExtension)
    const sharedStages = [
        claimReferenceValidationStage,
        variableAssignmentStage,
        formulaCompilationStage,
        formulaValidationStage,
    ]

    it.each(sharedStages.map((s) => [s.id, s] as const))(
        "both pipelines include the same %s stage const (reference equality)",
        (_id, stageConst) => {
            expect(scholar.stages).toContain(stageConst)
            expect(scribe.stages).toContain(stageConst)
        }
    )

    it("scribe populates the six finalize slots via its stage ids", () => {
        const ids = new Set(scribe.stages.map((s) => s.id))
        for (const id of [
            "claim-canonicalization",
            "claim-type-classification",
            "variable-assignment",
            "relation-extraction",
            "conclusion-selection",
            "formula-compilation",
        ]) {
            expect(ids.has(id)).toBe(true)
        }
    })
})

// `isLlmStage` is the public framework predicate an out-of-process
// orchestrator (e.g. the server's stage-routing) uses to classify a
// RESOLVED stage object as LLM-background vs deterministic. scribe makes
// this load-bearing: it reuses scholar's stage IDS
// (`claim-canonicalization`, `claim-type-classification`,
// `relation-extraction`, `conclusion-selection`) as DETERMINISTIC
// adapters, so a router keying on a flat id set would misroute them.
// `isLlmStage` keys on the resolved stage's LLM-config carrier, so it
// classifies correctly regardless of id. This pins that contract.
describe("isLlmStage classifies resolved scribe stages correctly", () => {
    const scribe = createScribePipeline(basicsExtension)
    const byId = (id: string) => {
        const stage = scribe.stages.find((s) => s.id === id)
        if (!stage) throw new Error(`scribe has no stage "${id}"`)
        return stage
    }

    it("scribe's two cheap LLM stages are LLM-classified", () => {
        expect(isLlmStage(byId(STAGE_IDS.extract))).toBe(true)
        expect(isLlmStage(byId(STAGE_IDS.scribeStructure))).toBe(true)
    })

    it("scribe's adapters reusing scholar's IDS are deterministic-classified", () => {
        // These ids are LLM stages in scholar but DETERMINISTIC adapters
        // in scribe — the exact case a flat-id router gets wrong.
        for (const id of [
            STAGE_IDS.claimCanonicalization,
            STAGE_IDS.claimTypeClassification,
            STAGE_IDS.relationExtraction,
            STAGE_IDS.conclusionSelection,
        ]) {
            expect(isLlmStage(byId(id))).toBe(false)
        }
    })

    it("scribe's reused deterministic backend stages are deterministic-classified", () => {
        for (const id of [
            STAGE_IDS.claimReferenceValidation,
            STAGE_IDS.variableAssignment,
            STAGE_IDS.formulaCompilation,
            STAGE_IDS.formulaValidation,
        ]) {
            expect(isLlmStage(byId(id))).toBe(false)
        }
    })
})
