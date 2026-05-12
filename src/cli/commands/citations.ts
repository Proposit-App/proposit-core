import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydratePropositCore, persistCore } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"

export function registerCitationCommands(program: Command): void {
    const citations = program
        .command("citations")
        .description("Manage global claim-citation library")

    citations
        .command("list")
        .description("List all citations")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            const all = core.citations.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const citation of all) {
                    printLine(
                        `${citation.id} | ${citation.claimId}@${citation.claimVersion} -> ${citation.supportingClaimId}@${citation.supportingClaimVersion}`
                    )
                }
            }
        })

    citations
        .command("show <citation_id>")
        .description("Show a single citation")
        .option("--json", "Output as JSON")
        .action(async (citationId: string, opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            const citation = core.citations.get(citationId)
            if (!citation) {
                errorExit(`Citation "${citationId}" not found.`)
            }
            if (opts.json) {
                printJson(citation)
            } else {
                printLine(`id:                     ${citation.id}`)
                printLine(`claimId:                ${citation.claimId}`)
                printLine(`claimVersion:           ${citation.claimVersion}`)
                printLine(
                    `supportingClaimId:      ${citation.supportingClaimId}`
                )
                printLine(
                    `supportingClaimVersion: ${citation.supportingClaimVersion}`
                )
            }
        })

    citations
        .command("add <claim_id> <supporting_claim_id>")
        .description(
            "Add a citation edge between two claims (supporting claim must be a citation-typed claim)"
        )
        .action(async (claimId: string, supportingClaimId: string) => {
            const core = await hydratePropositCore()
            const claim = core.claims.getCurrent(claimId)
            if (!claim) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            const supportingClaim = core.claims.getCurrent(supportingClaimId)
            if (!supportingClaim) {
                errorExit(`Claim "${supportingClaimId}" not found.`)
            }
            let citation
            try {
                citation = core.citations.add({
                    id: randomUUID(),
                    claimId: claim.id,
                    claimVersion: claim.version,
                    supportingClaimId: supportingClaim.id,
                    supportingClaimVersion: supportingClaim.version,
                })
            } catch (error) {
                errorExit(
                    error instanceof Error ? error.message : String(error)
                )
            }
            await persistCore(core)
            printLine(citation.id)
        })

    citations
        .command("unlink <citation_id>")
        .description("Remove a citation edge")
        .action(async (citationId: string) => {
            const core = await hydratePropositCore()
            const citation = core.citations.get(citationId)
            if (!citation) {
                errorExit(`Citation "${citationId}" not found.`)
            }
            core.citations.remove(citationId)
            await persistCore(core)
            printLine("success")
        })
}
