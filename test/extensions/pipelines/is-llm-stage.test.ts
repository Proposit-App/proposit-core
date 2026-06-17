// Unit tests for the public `isLlmStage` predicate — the routing
// primitive an out-of-process orchestrator uses to decide, per stage,
// whether to drive it with `launchStage` / `completeStage` (LLM-background)
// or `executeStage` (deterministic / sub-pipeline). The predicate must
// agree, stage-for-stage, with the guard `launchStage` applies internally.

import { describe, expect, it } from "vitest"
import {
    createIngestionV2Pipeline,
    basicsExtension,
    isLlmStage,
    launchStage,
    PipelineConfigurationError,
} from "../../../src/lib/index.js"
import type { TExecuteStageDeps } from "../../../src/lib/index.js"
import { STAGE_IDS } from "../../../src/extensions/pipelines/base/stages/index.js"
import { createMockLlmProvider } from "../../mocks/llm.js"

// Deps that get `launchStage` past its submit-capability check so it
// reaches the `requireLlmStage` guard. The mock provider and stub submit
// are only exercised for genuine LLM stages; deterministic stages throw at
// the guard, before either is touched.
const launchDeps: TExecuteStageDeps = {
    llm: createMockLlmProvider({ responses: {} }),
    submitBackgroundResponse: () =>
        Promise.resolve({ responseId: "resp_test", status: "completed" }),
}

// True iff `launchStage` rejects this stage specifically because it carries
// no LLM config (the deterministic-stage guard). Any other outcome — a
// resolved launch, or a later failure such as a missing upstream dep —
// means the stage got PAST the guard, i.e. core treats it as an LLM stage.
async function launchRejectsAsNonLlm(
    pipeline: ReturnType<typeof createIngestionV2Pipeline>,
    stageId: string
): Promise<boolean> {
    try {
        await launchStage(pipeline, stageId, {}, { text: "x" }, launchDeps)
        return false
    } catch (err) {
        return (
            err instanceof PipelineConfigurationError &&
            err.message.includes("carries no LLM config")
        )
    }
}

describe("isLlmStage", () => {
    const pipeline = createIngestionV2Pipeline(basicsExtension)
    const stageById = (id: string) => {
        const stage = pipeline.stages.find((s) => s.id === id)
        if (!stage) throw new Error(`no stage "${id}" in pipeline`)
        return stage
    }

    it("is true for a genuine LLM-background stage", () => {
        expect(isLlmStage(stageById(STAGE_IDS.segmentation))).toBe(true)
    })

    it("is false for deterministic stages", () => {
        for (const id of [
            STAGE_IDS.claimReferenceValidation,
            STAGE_IDS.variableAssignment,
            STAGE_IDS.formulaCompilation,
            STAGE_IDS.formulaValidation,
        ]) {
            expect(isLlmStage(stageById(id))).toBe(false)
        }
    })

    it("is false for conclusion-selection — keys on the returned stage's carrier, not on whether the stage runs an LLM internally", () => {
        // Its factory builds an inner `llmStage` and calls its `run`, but
        // returns a plain literal with no carrier — so it must be driven by
        // `executeStage`, and the predicate must agree with that.
        expect(isLlmStage(stageById(STAGE_IDS.conclusionSelection))).toBe(false)
    })

    it("agrees with the launchStage guard for every stage", async () => {
        for (const stage of pipeline.stages) {
            const rejectsAsNonLlm = await launchRejectsAsNonLlm(
                pipeline,
                stage.id
            )
            // The predicate and the guard can never disagree: a stage is an
            // LLM stage iff launchStage does NOT reject it as carrying no
            // LLM config.
            expect(isLlmStage(stage)).toBe(!rejectsAsNonLlm)
        }
    })
})
