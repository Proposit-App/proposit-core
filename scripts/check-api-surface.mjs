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
    // Fields written inline in a type (an object type inside a union or
    // intersection, on a property, or as a constant's type) are reflections
    // too, reached through the type rather than through `children`.
    const walkType = (type, path) => {
        if (!type) return
        if (type.declaration) walk(type.declaration, path)
        for (const member of type.types ?? []) walkType(member, path)
        walkType(type.elementType, path)
    }
    const walk = (node, path) => {
        for (const child of node.children ?? []) {
            const childPath = path ? `${path}.${child.name}` : child.name
            const signatures = child.signatures?.length
            const accessor = [
                child.getSignature ? "get" : undefined,
                child.setSignature ? "set" : undefined,
            ].filter(Boolean)
            lines.push(
                `${ReflectionKind[child.kind]} ${childPath}` +
                    (signatures === undefined ? "" : ` (${signatures})`) +
                    (accessor.length === 0 ? "" : ` (${accessor.join(", ")})`)
            )
            walk(child, childPath)
            walkType(child.type, childPath)
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
// Compared as counts, not sets: fields of different union variants can share
// a line, and hiding one of them must still show up as a missing line.
const counts = new Map()
for (const line of expected) counts.set(line, (counts.get(line) ?? 0) + 1)
for (const line of current) counts.set(line, (counts.get(line) ?? 0) - 1)
const removed = []
const added = []
for (const [line, count] of counts) {
    for (let i = 0; i < count; i++) removed.push(line)
    for (let i = 0; i < -count; i++) added.push(line)
}

if (removed.length === 0 && added.length === 0) process.exit(0)

console.error(`The documented API differs from ${LIST_PATH}.`)
for (const line of removed) console.error(`  missing from the docs: ${line}`)
for (const line of added) console.error(`  new in the docs:       ${line}`)
if (removed.length > 0) {
    console.error(
        "A declaration that disappeared may have an @internal comment attached to it by mistake."
    )
}
console.error(
    "If the change is intended, run `pnpm run api-surface:update` and commit the list."
)
process.exit(1)
