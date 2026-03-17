import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydrateLibraries, persistLibraries } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"

export function registerClaimCommands(program: Command): void {
    const claims = program
        .command("claims")
        .description("Manage global claim library")

    claims
        .command("list")
        .description("List all claims")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const { claimLibrary } = await hydrateLibraries()
            const all = claimLibrary.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const claim of all) {
                    const extras = claim as Record<string, unknown>
                    const frozen = claim.frozen ? " [frozen]" : ""
                    const title =
                        typeof extras.title === "string"
                            ? ` | ${extras.title}`
                            : ""
                    printLine(`${claim.id}@${claim.version}${frozen}${title}`)
                }
            }
        })

    claims
        .command("show <claim_id>")
        .description("Show all versions of a claim")
        .option("--json", "Output as JSON")
        .action(async (claimId: string, opts: { json?: boolean }) => {
            const { claimLibrary } = await hydrateLibraries()
            const versions = claimLibrary.getVersions(claimId)
            if (versions.length === 0) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            if (opts.json) {
                printJson(versions)
            } else {
                for (const v of versions) {
                    const extras = v as Record<string, unknown>
                    const frozen = v.frozen ? " [frozen]" : ""
                    printLine(`v${v.version}${frozen}`)
                    if (typeof extras.title === "string") {
                        printLine(`  title: ${extras.title}`)
                    }
                    if (typeof extras.body === "string") {
                        printLine(`  body:  ${extras.body}`)
                    }
                }
            }
        })

    claims
        .command("add")
        .description("Create a new claim")
        .option("--title <title>", "Short title summarizing the claim")
        .option("--body <body>", "Detailed description of the claim")
        .action(async (opts: { title?: string; body?: string }) => {
            const libs = await hydrateLibraries()
            const claim = libs.claimLibrary.create({
                id: randomUUID(),
                ...(opts.title !== undefined ? { title: opts.title } : {}),
                ...(opts.body !== undefined ? { body: opts.body } : {}),
            } as Parameters<typeof libs.claimLibrary.create>[0])
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(claim.id)
        })

    claims
        .command("update <claim_id>")
        .description("Update claim metadata")
        .option("--title <title>", "New title")
        .option("--body <body>", "New body")
        .action(
            async (
                claimId: string,
                opts: { title?: string; body?: string }
            ) => {
                const libs = await hydrateLibraries()
                const current = libs.claimLibrary.getCurrent(claimId)
                if (!current) {
                    errorExit(`Claim "${claimId}" not found.`)
                }
                if (current.frozen) {
                    errorExit(
                        `Claim "${claimId}" version ${current.version} is frozen and cannot be updated.`
                    )
                }
                const updates: Record<string, unknown> = {}
                if (opts.title !== undefined) updates.title = opts.title
                if (opts.body !== undefined) updates.body = opts.body
                if (Object.keys(updates).length === 0) {
                    errorExit("No updates specified. Use --title or --body.")
                }
                libs.claimLibrary.update(
                    claimId,
                    updates as Parameters<typeof libs.claimLibrary.update>[1]
                )
                await persistLibraries(
                    libs.claimLibrary,
                    libs.sourceLibrary,
                    libs.claimSourceLibrary
                )
                printLine("success")
            }
        )

    claims
        .command("freeze <claim_id>")
        .description(
            "Freeze the current version and create a new mutable version"
        )
        .action(async (claimId: string) => {
            const libs = await hydrateLibraries()
            const current = libs.claimLibrary.getCurrent(claimId)
            if (!current) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            let frozen, newVersion
            try {
                const result = libs.claimLibrary.freeze(claimId)
                frozen = result.frozen
                newVersion = result.current
            } catch (error) {
                errorExit(
                    error instanceof Error ? error.message : String(error)
                )
            }
            await persistLibraries(
                libs.claimLibrary,
                libs.sourceLibrary,
                libs.claimSourceLibrary
            )
            printLine(
                `Frozen v${frozen.version}, new mutable v${newVersion.version}`
            )
        })
}
