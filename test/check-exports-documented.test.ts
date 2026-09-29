// Every published subpath must reach the API docs, either as a typedoc entry
// point or through the root index, or `pnpm run docs` fails.

import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const SCRIPT = join(ROOT, "scripts/check-exports-documented.mjs")

function run(packageJson: unknown): { ok: boolean; output: string } {
    const dir = mkdtempSync(join(tmpdir(), "exports-check-"))
    const path = join(dir, "package.json")
    writeFileSync(path, JSON.stringify(packageJson))
    try {
        const output = execFileSync("node", [SCRIPT, "--package", path], {
            encoding: "utf8",
            stdio: "pipe",
        })
        return { ok: true, output }
    } catch (error) {
        const failure = error as { stdout: string; stderr: string }
        return { ok: false, output: failure.stdout + failure.stderr }
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

const PACKAGE = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8")
) as {
    exports: Record<string, unknown>
}

describe("check-exports-documented", () => {
    it("passes for this package's exports", () => {
        expect(run(PACKAGE)).toMatchObject({ ok: true })
    })

    it("fails on a subpath with no entry point, naming it", () => {
        const result = run({
            ...PACKAGE,
            exports: {
                ...PACKAGE.exports,
                "./extensions/unlisted": {
                    types: "./dist/extensions/unlisted/index.d.ts",
                    import: "./dist/extensions/unlisted/index.js",
                },
            },
        })
        expect(result.ok).toBe(false)
        expect(result.output).toContain("./extensions/unlisted")
    })

    it("fails, naming the key, on a target with no types file", () => {
        for (const target of [null, "./dist/x.js", { import: "./dist/x.js" }]) {
            const result = run({
                ...PACKAGE,
                exports: { ...PACKAGE.exports, "./odd": target },
            })
            expect(result.ok, JSON.stringify(target)).toBe(false)
            expect(result.output).toContain("./odd (no types file")
        }
    })
})
