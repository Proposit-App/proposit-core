// Pins the public import surface of the two ingestion subpaths
// (`@proposit/proposit-core/pipelines/base` and `.../ingestion`) — the
// paths consumers (e.g. the server) import from after the restructure
// moved ingestion off the root barrel.

import { describe, it, expect } from "vitest"
import * as base from "../../../src/extensions/pipelines/base/index.js"
import * as ingestion from "../../../src/extensions/pipelines/ingestion/index.js"

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

    it("ingestion exports the scholar factory", () => {
        expect(typeof ingestion.createScholarPipeline).toBe("function")
    })
})
