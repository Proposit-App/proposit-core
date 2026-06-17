// Pins the load-bearing reuse invariant: scribe reuses scholar's four
// deterministic stage consts BY REFERENCE (not a reconstruction), and
// populates the six standard stage-output slots `finalizeResponseV2`
// reads. A future edit that makes scribe rebuild a deterministic stage
// (silently diverging the two pipelines) fails here.

import { describe, expect, it } from "vitest"
import { createScholarPipeline } from "../../../src/extensions/pipelines/ingestion/scholar/index.js"
import { createScribePipeline } from "../../../src/extensions/pipelines/ingestion/scribe/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/index.js"
import {
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
