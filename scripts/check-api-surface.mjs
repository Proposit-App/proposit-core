// Compares what typedoc documented with the checked-in list in
// docs/api-surface.txt, and fails on any difference.
//
// A stray `@internal` comment attached to the wrong declaration removes a
// public member from the docs (typedoc runs with `excludeInternal`) while
// typecheck and tests stay green. This check makes that visible. Additions
// fail too, so the list never goes stale; an intended API change is recorded
// with `pnpm run api-surface:update` and reviewed as a diff of the list.
//
// Usage: node scripts/check-api-surface.mjs [--update]
// Reads .typedoc/api.json, which `pnpm run docs` writes.

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { ReflectionKind } from "typedoc"

const JSON_PATH = ".typedoc/api.json"
const LIST_PATH = "docs/api-surface.txt"
const update = process.argv.includes("--update")

function surfaceLines(project) {
    const lines = []
    const walk = (node, path) => {
        for (const child of node.children ?? []) {
            const childPath = path ? `${path}.${child.name}` : child.name
            const signatures = child.signatures?.length
            lines.push(
                `${ReflectionKind[child.kind]} ${childPath}` +
                    (signatures === undefined ? "" : ` (${signatures})`)
            )
            walk(child, childPath)
        }
    }
    walk(project, "")
    return lines.sort()
}

const current = surfaceLines(JSON.parse(readFileSync(JSON_PATH, "utf8")))

if (update) {
    writeFileSync(LIST_PATH, current.join("\n") + "\n")
    console.log(`Wrote ${current.length} lines to ${LIST_PATH}.`)
    process.exit(0)
}

const expected = existsSync(LIST_PATH)
    ? readFileSync(LIST_PATH, "utf8").split("\n").filter(Boolean)
    : []
const expectedSet = new Set(expected)
const currentSet = new Set(current)
const removed = expected.filter((line) => !currentSet.has(line))
const added = current.filter((line) => !expectedSet.has(line))

if (
    removed.length === 0 &&
    added.length === 0 &&
    current.length === expected.length
) {
    process.exit(0)
}

console.error(`The documented API differs from ${LIST_PATH}.`)
for (const line of removed) console.error(`  missing from the docs: ${line}`)
for (const line of added) console.error(`  new in the docs:       ${line}`)
console.error(
    "If a member disappeared, look for an @internal comment attached to it by mistake. " +
        "If the change is intended, run `pnpm run api-surface:update` and commit the list."
)
process.exit(1)
