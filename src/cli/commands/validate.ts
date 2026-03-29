import { Command } from "commander"
import { hydrateEngine } from "../engine.js"
import { printJson, printLine } from "../output.js"

export function registerValidateCommand(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    versionedCmd
        .command("validate")
        .description("Run invariant validation on the argument structure")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const result = engine.validate()

            if (opts.json) {
                printJson(result)
                return
            }

            if (result.ok) {
                printLine("ok")
            } else {
                printLine("invalid")
                for (const v of result.violations) {
                    printLine(
                        `${v.entityType} ${v.entityId}: ${v.code} — ${v.message}`
                    )
                }
            }
        })
}
