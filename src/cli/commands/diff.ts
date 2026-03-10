import { Command } from "commander"
import { diffArguments } from "../../lib/core/diff.js"
import { hydrateEngine } from "../engine.js"
import { errorExit, printJson } from "../output.js"
import { renderDiff } from "../output/diff-renderer.js"
import { resolveVersion } from "../router.js"

/**
 * Parses diff positional args into two (argumentId, versionArg) pairs.
 *
 * 3 args: <id> <verA> <verB>       → same argument, two versions
 * 4 args: <idA> <verA> <idB> <verB> → cross-argument
 */
function parseDiffArgs(
    args: string[]
): [idA: string, verA: string, idB: string, verB: string] {
    if (args.length === 3) {
        return [args[0], args[1], args[0], args[2]]
    }
    if (args.length === 4) {
        return [args[0], args[1], args[2], args[3]]
    }
    return errorExit(
        "Usage: proposit-core diff <id> <verA> <verB>\n       proposit-core diff <idA> <verA> <idB> <verB>"
    )
}

export function registerDiffCommand(program: Command): void {
    program
        .command("diff <args...>")
        .description("Compare two argument versions and show their differences")
        .option("--json", "Output as JSON")
        .action(async (args: string[], opts: { json?: boolean }) => {
            const [idA, verArgA, idB, verArgB] = parseDiffArgs(args)

            const [versionA, versionB] = await Promise.all([
                resolveVersion(idA, verArgA),
                resolveVersion(idB, verArgB),
            ])

            const [engineA, engineB] = await Promise.all([
                hydrateEngine(idA, versionA),
                hydrateEngine(idB, versionB),
            ])

            const diff = diffArguments(engineA, engineB)

            if (opts.json) {
                printJson(diff)
            } else {
                renderDiff(diff)
            }
        })
}
