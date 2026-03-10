import { Command } from "commander"
import { printJson, printLine } from "../output.js"
import { readArgumentMeta } from "../storage/arguments.js"
import { readVersionMeta } from "../storage/arguments.js"

export function registerVersionShowCommand(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    versionedCmd
        .command("show")
        .description("Show metadata for this argument version")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const [argMeta, vMeta] = await Promise.all([
                readArgumentMeta(argumentId),
                readVersionMeta(argumentId, version),
            ])

            if (opts.json) {
                printJson({ ...argMeta, ...vMeta })
            } else {
                printLine(`id:          ${argMeta.id}`)
                printLine(`title:       ${argMeta.title}`)
                printLine(`description: ${argMeta.description ?? ""}`)
                printLine(`version:     ${vMeta.version}`)
                printLine(`created:     ${vMeta.createdAt.toLocaleString()}`)
                printLine(`published:   ${vMeta.published}`)
                if (vMeta.publishedAt !== undefined) {
                    printLine(
                        `publishedAt: ${vMeta.publishedAt.toLocaleString()}`
                    )
                }
            }
        })
}
