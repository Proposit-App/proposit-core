// Every checksum the engine computes for a fixed set of arguments must equal
// the value a published release computed for the same arguments. The
// arguments are built by `scripts/checksum-fixtures/cases.mjs`, which this
// test runs against the local source and `capture.mjs` ran against the
// published package to write the fixtures. A stored checksum that moves
// makes every consumer's persisted data look modified, so any difference
// here is a breaking change, not a fixture to refresh.

import { describe, expect, it } from "vitest"
import * as lib from "../../src/lib/index"
import {
    buildChecksumCases,
    FORK_EXTERNAL_SCENARIOS,
    STANDARD_SCENARIOS,
} from "../../scripts/checksum-fixtures/cases.mjs"
import type { TChecksumFixture } from "../../scripts/checksum-fixtures/cases.mjs"
import fixture542 from "./fixtures/checksums-5.4.2.json"
import fixture543ForkExternal from "./fixtures/checksums-5.4.3-fork-external.json"

const fixtures: {
    fixture: TChecksumFixture
    scenarios: readonly string[]
}[] = [
    { fixture: fixture542 as TChecksumFixture, scenarios: STANDARD_SCENARIOS },
    {
        fixture: fixture543ForkExternal as TChecksumFixture,
        scenarios: FORK_EXTERNAL_SCENARIOS,
    },
]

for (const { fixture, scenarios } of fixtures) {
    describe(`checksums match those captured from ${fixture.capturedFrom}`, () => {
        const rebuilt = buildChecksumCases(lib, scenarios)

        it("covers the same cases as the fixture", () => {
            expect(Object.keys(rebuilt).sort()).toEqual(
                Object.keys(fixture.cases).sort()
            )
        })

        it.each(Object.keys(fixture.cases))("%s", (caseName) => {
            expect(rebuilt[caseName]).toEqual(fixture.cases[caseName])
        })
    })
}
