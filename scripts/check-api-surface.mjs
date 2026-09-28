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

// Keys that hold no declarations, only metadata about them.
const METADATA_KEYS = new Set([
    "sources",
    "comment",
    "groups",
    "categories",
    "symbolIdMap",
    "files",
])

function lineFor(reflection, path) {
    const signatures = reflection.signatures?.length
    const accessor = [
        reflection.getSignature ? "get" : undefined,
        reflection.setSignature ? "set" : undefined,
    ].filter(Boolean)
    return (
        `${ReflectionKind[reflection.kind]} ${path}` +
        (signatures === undefined ? "" : ` (${signatures})`) +
        (accessor.length === 0 ? "" : ` (${accessor.join(", ")})`)
    )
}

function surfaceLines(project) {
    const lines = []
    // Every key is followed, so a declaration is recorded wherever typedoc
    // puts it: in `children`, in an object type written inline (a union, a
    // generic's type argument, a tuple, a conditional or mapped type), or
    // inside a signature's parameter and return types or a type parameter's
    // constraint. Type parameters' defaults are skipped: they repeat
    // declarations recorded elsewhere, expanded at every use.
    const visit = (value, path) => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item, path)
            return
        }
        if (value === null || typeof value !== "object") return
        let next = path
        const named =
            value !== project &&
            value.name !== undefined &&
            value.name !== "__type"
        if (named && value.variant === "declaration") {
            next = path ? `${path}.${value.name}` : value.name
            lines.push(lineFor(value, next))
        } else if (
            named &&
            (value.variant === "param" || value.variant === "typeParam")
        ) {
            // Named in the path so a field inside one reads as belonging to
            // it; parameters and type parameters are not listed themselves.
            next = `${path}.${value.name}`
        }
        for (const [key, child] of Object.entries(value)) {
            if (METADATA_KEYS.has(key)) continue
            if (key === "default" && value.variant === "typeParam") continue
            visit(child, next)
        }
    }
    visit(project, "")
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
