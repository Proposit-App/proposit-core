// Pins the public import surface of the two ingestion subpaths
// (`@proposit/proposit-core/pipelines/base` and `.../ingestion`) — the
// paths consumers (e.g. the server) import from after the restructure
// moved ingestion off the root barrel.

import { describe, it, expect } from "vitest"
import * as base from "../../../src/extensions/pipelines/base/index.js"
import * as ingestion from "../../../src/extensions/pipelines/ingestion/index.js"
import { basicsExtension } from "../../../src/extensions/pipelines/base/basics-extension.js"

describe("pipelines subpath barrels", () => {
    it("base exports the contract + the newly-public helpers", () => {
        expect(typeof base.finalizeResponseV2).toBe("function")
        expect(typeof base.resolveLlmStageOptions).toBe("function")
        expect(typeof base.basicsExtension).toBe("object")
        expect(typeof base.selectFallbackConclusion).toBe("function")
        expect(typeof base.buildResponseSchema).toBe("function")
        expect(typeof base.buildClaimRecordSchema).toBe("function")
        expect(base.STAGE_IDS.extract).toBe("extract")
        expect(base.STAGE_IDS.scribeStructure).toBe("scribe-structure")
    })

    it("ingestion exports the scholar + scribe factories", () => {
        expect(typeof ingestion.createScholarPipeline).toBe("function")
        expect(typeof ingestion.createScribePipeline).toBe("function")
    })

    it("ingestion exports the canonical stage-id lists + lookup", () => {
        expect(Array.isArray(ingestion.INGESTION_SCHOLAR_STAGE_IDS)).toBe(true)
        expect(Array.isArray(ingestion.INGESTION_SCRIBE_STAGE_IDS)).toBe(true)
        expect(typeof ingestion.getCanonicalStageIds).toBe("function")
    })
})

describe("canonical ingestion stage-id lists", () => {
    it("scholar list matches the factory's stage order (drift guard)", () => {
        const pipeline = ingestion.createScholarPipeline(basicsExtension)
        expect(ingestion.INGESTION_SCHOLAR_STAGE_IDS).toEqual(
            pipeline.stages.map((s) => s.id)
        )
    })

    it("scribe list matches the factory's stage order (drift guard)", () => {
        const pipeline = ingestion.createScribePipeline(basicsExtension)
        expect(ingestion.INGESTION_SCRIBE_STAGE_IDS).toEqual(
            pipeline.stages.map((s) => s.id)
        )
    })

    it("getCanonicalStageIds resolves each pipeline id to its list", () => {
        const scholar = ingestion.createScholarPipeline(basicsExtension)
        const scribe = ingestion.createScribePipeline(basicsExtension)
        expect(ingestion.getCanonicalStageIds(scholar.id)).toBe(
            ingestion.INGESTION_SCHOLAR_STAGE_IDS
        )
        expect(ingestion.getCanonicalStageIds(scribe.id)).toBe(
            ingestion.INGESTION_SCRIBE_STAGE_IDS
        )
    })

    it("getCanonicalStageIds returns an empty list for an unknown pipeline id", () => {
        expect(ingestion.getCanonicalStageIds("nope")).toEqual([])
        expect(ingestion.getCanonicalStageIds(undefined)).toEqual([])
    })
})
