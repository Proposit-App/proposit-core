// Records the checksums an installed copy of the package computes for the
// arguments built in `cases.mjs`, and writes them to a JSON fixture that
// `test/core/checksum-stability.test.ts` compares the local source against.
//
// Usage:
//   node scripts/checksum-fixtures/capture.mjs <install-folder> <output.json> [scenario-set]
//
// <install-folder>  A folder whose node_modules holds the package to capture
//                   from, i.e. one containing
//                   node_modules/@proposit/proposit-core. Create one with
//                   `pnpm add @proposit/proposit-core@<version>` in an empty
//                   folder.
// <output.json>     Where to write the fixture.
// [scenario-set]    "standard" (the default) or "fork-external".
//                   "fork-external" forks an argument holding a binding into
//                   another argument, which only 5.4.3 and later can do.
//
// The fixtures in test/core/fixtures/ were captured with:
//   capture.mjs <folder with 5.4.2> test/core/fixtures/checksums-5.4.2.json standard
//   capture.mjs <folder with 5.4.3> test/core/fixtures/checksums-5.4.3-fork-external.json fork-external
// and then formatted with `pnpm run prettify`.

import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
    buildChecksumCases,
    FORK_EXTERNAL_SCENARIOS,
    STANDARD_SCENARIOS,
} from "./cases.mjs"

const [installFolder, outputPath, scenarioSet = "standard"] =
    process.argv.slice(2)
if (!installFolder || !outputPath) {
    console.error(
        "Usage: node scripts/checksum-fixtures/capture.mjs <install-folder> <output.json> [standard|fork-external]"
    )
    process.exit(1)
}

const scenarioSets = {
    standard: STANDARD_SCENARIOS,
    "fork-external": FORK_EXTERNAL_SCENARIOS,
}
const scenarios = scenarioSets[scenarioSet]
if (!scenarios) {
    console.error(`Unknown scenario set "${scenarioSet}".`)
    process.exit(1)
}

const packageFolder = path.resolve(
    installFolder,
    "node_modules/@proposit/proposit-core"
)
const packageJson = JSON.parse(
    readFileSync(path.join(packageFolder, "package.json"), "utf8")
)
const lib = await import(
    pathToFileURL(path.join(packageFolder, packageJson.exports["."].import))
        .href
)

const fixture = {
    capturedFrom: `${packageJson.name}@${packageJson.version}`,
    cases: buildChecksumCases(lib, scenarios),
}
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 4)}\n`)
console.log(
    `Wrote ${Object.keys(fixture.cases).length} cases from ${fixture.capturedFrom} to ${outputPath}`
)
