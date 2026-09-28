// Fails when a published subpath would not reach the API docs.
//
// Each `exports` key in package.json must either name a typedoc entry point
// (its `types` file, mapped from dist/ back to src/) or be listed below as
// covered through the root index. Otherwise a new subpath ships with no
// generated reference and nothing in docs/api-surface.txt guards it.
//
// Usage: node scripts/check-exports-documented.mjs [--package <path>]

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

// Subpaths whose whole API is documented through `src/lib/index.ts`, with why.
const COVERED_BY_ROOT = new Map([
    [".", "src/index.ts only re-exports src/lib/index.ts"],
    [
        "./conversation",
        'src/lib/index.ts has `export * from "./conversation/index.js"`',
    ],
])

/** The `types` file of an exports target, searching nested conditions. */
function typesOf(target) {
    if (typeof target === "string") {
        return target.endsWith(".d.ts") ? target : undefined
    }
    if (target === null || typeof target !== "object") return undefined
    if (typeof target.types === "string") return target.types
    for (const nested of Object.values(target)) {
        const found = typesOf(nested)
        if (found !== undefined) return found
    }
    return undefined
}

const packageIndex = process.argv.indexOf("--package")
const packagePath =
    packageIndex === -1
        ? join(ROOT, "package.json")
        : process.argv[packageIndex + 1]
const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
const entryPoints = new Set(
    JSON.parse(readFileSync(join(ROOT, "typedoc.json"), "utf8")).entryPoints
)

const missing = []
for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    if (COVERED_BY_ROOT.has(key)) continue
    const types = typesOf(target)
    if (types === undefined) {
        missing.push(`  ${key} (no types file in its exports target)`)
        continue
    }
    const source = types
        .replace(/^\.\/dist\//, "src/")
        .replace(/\.d\.ts$/, ".ts")
    if (!entryPoints.has(source)) missing.push(`  ${key} (${source})`)
}

if (missing.length > 0) {
    console.error(
        "These published subpaths have no typedoc entry point:\n" +
            missing.join("\n") +
            "\nAdd each source to typedoc.json entryPoints, or to" +
            " COVERED_BY_ROOT in scripts/check-exports-documented.mjs if" +
            " the root index re-exports all of it."
    )
    process.exit(1)
}
