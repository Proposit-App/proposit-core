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
            // The legacy no-arg `engine.validate()` overload was
            // renamed to `validateInvariants()` for unambiguous
            // contrast with the tier-aware `engine.validate(tier)`
            // grammar validator. The CLI surfaces the invariant sweep
            // (schema conformance, reference integrity, etc.); for
            // four-tier grammar validation use a separate command.
            const result = engine.validateInvariants()

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
