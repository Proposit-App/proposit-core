// Fails when a published subpath would not reach the API docs.
//
// Each `exports` key in package.json must either name a typedoc entry point
// (its `types` file, mapped from dist/ back to src/) or be listed below as
// covered through the root index. Otherwise a new subpath ships with no
// generated reference and nothing in docs/api-surface.txt guards it.
//
// Usage: node scripts/check-exports-documented.mjs [--package <path>]

import { readFileSync } from "node:fs"

// Subpaths whose whole API is documented through `src/lib/index.ts`, with why.
const COVERED_BY_ROOT = new Map([
    [".", "src/index.ts only re-exports src/lib/index.ts"],
    ["./conversation", "src/lib/index.ts re-exports all of it"],
])

const packageIndex = process.argv.indexOf("--package")
const packagePath =
    packageIndex === -1 ? "package.json" : process.argv[packageIndex + 1]
const pkg = JSON.parse(readFileSync(packagePath, "utf8"))
const entryPoints = new Set(
    JSON.parse(readFileSync("typedoc.json", "utf8")).entryPoints
)

const missing = []
for (const [key, target] of Object.entries(pkg.exports ?? {})) {
    if (COVERED_BY_ROOT.has(key)) continue
    const types = typeof target === "string" ? target : target.types
    const source = types
        ?.replace(/^\.\/dist\//, "src/")
        .replace(/\.d\.ts$/, ".ts")
    if (source === undefined || !entryPoints.has(source)) {
        missing.push(`  ${key} (${source ?? "no types file"})`)
    }
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
