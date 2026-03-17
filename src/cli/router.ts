import { listVersionNumbers, readVersionMeta } from "./storage/arguments.js"
import { errorExit } from "./output.js"

const NAMED_COMMANDS = new Set([
    "help",
    "--help",
    "-h",
    "version",
    "--version",
    "-V",
    "arguments",
    "claims",
    "diff",
    "sources",
])

/**
 * Returns true when argv[2] is a named top-level command (not a UUID).
 */
export function isNamedCommand(argv: string[]): boolean {
    const first = argv[2]
    if (first === undefined) return true
    return NAMED_COMMANDS.has(first)
}

/**
 * Resolves an argument_version string to a concrete version number.
 *
 * Accepts:
 *   - A non-negative integer string → validates existence, returns it
 *   - "latest"         → max version number found in the argument directory
 *   - "last-published" → highest published version; exits 1 if none
 */
export async function resolveVersion(
    argumentId: string,
    versionArg: string
): Promise<number> {
    const versions = await listVersionNumbers(argumentId)
    if (versions.length === 0) {
        errorExit(`No versions found for argument "${argumentId}".`)
    }

    if (versionArg === "latest") {
        return versions[versions.length - 1]
    }

    if (versionArg === "last-published") {
        // Check from highest to lowest
        for (let i = versions.length - 1; i >= 0; i--) {
            const v = versions[i]
            const meta = await readVersionMeta(argumentId, v)
            if (meta.published) return v
        }
        errorExit(`Argument "${argumentId}" has no published versions.`)
    }

    const parsed = Number(versionArg)
    if (!Number.isInteger(parsed) || parsed < 0) {
        errorExit(
            `Invalid version "${versionArg}". Use a non-negative integer, "latest", or "last-published".`
        )
    }
    if (!versions.includes(parsed)) {
        errorExit(
            `Version ${parsed} does not exist for argument "${argumentId}".`
        )
    }
    return parsed
}
