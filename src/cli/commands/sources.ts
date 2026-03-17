import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydrateLibraries, persistLibraries } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"

export function registerSourceCommands(program: Command): void {
    const sources = program
        .command("sources")
        .description("Manage global source library")

    sources
        .command("list")
        .description("List all sources")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const { sourceLibrary } = await hydrateLibraries()
            const all = sourceLibrary.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const source of all) {
                    const extras = source as Record<string, unknown>
                    const text = extras.text ? ` | ${extras.text}` : ""
                    printLine(`${source.id}@${source.version}${text}`)
                }
            }
        })

    sources
        .command("show <source_id>")
        .description("Show all versions of a source")
        .option("--json", "Output as JSON")
        .action(async (sourceId: string, opts: { json?: boolean }) => {
            const { sourceLibrary } = await hydrateLibraries()
            const versions = sourceLibrary.getVersions(sourceId)
            if (versions.length === 0) {
                errorExit(`Source "${sourceId}" not found.`)
            }
            if (opts.json) {
                printJson(versions)
            } else {
                for (const v of versions) {
                    const extras = v as Record<string, unknown>
                    const frozen = v.frozen ? " [frozen]" : ""
                    const text = extras.text ? ` | ${extras.text}` : ""
                    printLine(`v${v.version}${frozen}${text}`)
                }
            }
        })

    sources
        .command("add")
        .description("Create a new source")
        .requiredOption("--text <text>", "Source text")
        .action(async (opts: { text: string }) => {
            const libs = await hydrateLibraries()
            const source = libs.sourceLibrary.create({
                id: randomUUID(),
                text: opts.text,
            } as Parameters<typeof libs.sourceLibrary.create>[0])
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(source.id)
        })

    sources
        .command("link-claim <source_id> <claim_id>")
        .description("Link a source to a claim via a new association")
        .action(async (sourceId: string, claimId: string) => {
            const libs = await hydrateLibraries()
            const source = libs.sourceLibrary.getCurrent(sourceId)
            if (!source) {
                errorExit(`Source "${sourceId}" not found.`)
            }
            const claim = libs.claimLibrary.getCurrent(claimId)
            if (!claim) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            const assoc = libs.claimSourceLibrary.add({
                id: randomUUID(),
                claimId: claim.id,
                claimVersion: claim.version,
                sourceId: source.id,
                sourceVersion: source.version,
            })
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(assoc.id)
        })

    sources
        .command("unlink <association_id>")
        .description("Remove a claim-source association")
        .action(async (associationId: string) => {
            const libs = await hydrateLibraries()
            const assoc = libs.claimSourceLibrary.get(associationId)
            if (!assoc) {
                errorExit(`Association "${associationId}" not found.`)
            }
            libs.claimSourceLibrary.remove(associationId)
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine("success")
        })
}
