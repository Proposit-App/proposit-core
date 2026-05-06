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
            const all = core.claimCitations.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const citation of all) {
                    printLine(
                        `${citation.id} | ${citation.citingClaimId}@${citation.citingClaimVersion} -> ${citation.sourceClaimId}@${citation.sourceClaimVersion}`
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
            const citation = core.claimCitations.get(citationId)
            if (!citation) {
                errorExit(`Citation "${citationId}" not found.`)
            }
            if (opts.json) {
                printJson(citation)
            } else {
                printLine(`id:                  ${citation.id}`)
                printLine(`citingClaimId:       ${citation.citingClaimId}`)
                printLine(
                    `citingClaimVersion:  ${citation.citingClaimVersion}`
                )
                printLine(`sourceClaimId:       ${citation.sourceClaimId}`)
                printLine(
                    `sourceClaimVersion:  ${citation.sourceClaimVersion}`
                )
            }
        })

    citations
        .command("add <citing_claim_id> <source_claim_id>")
        .description(
            "Add a citation edge between two claims (source must be a citation-typed claim)"
        )
        .action(async (citingClaimId: string, sourceClaimId: string) => {
            const core = await hydratePropositCore()
            const citingClaim = core.claims.getCurrent(citingClaimId)
            if (!citingClaim) {
                errorExit(`Claim "${citingClaimId}" not found.`)
            }
            const sourceClaim = core.claims.getCurrent(sourceClaimId)
            if (!sourceClaim) {
                errorExit(`Claim "${sourceClaimId}" not found.`)
            }
            const citation = core.claimCitations.add({
                id: randomUUID(),
                citingClaimId: citingClaim.id,
                citingClaimVersion: citingClaim.version,
                sourceClaimId: sourceClaim.id,
                sourceClaimVersion: sourceClaim.version,
            })
            await persistCore(core)
            printLine(citation.id)
        })

    citations
        .command("unlink <citation_id>")
        .description("Remove a citation edge")
        .action(async (citationId: string) => {
            const core = await hydratePropositCore()
            const citation = core.claimCitations.get(citationId)
            if (!citation) {
                errorExit(`Citation "${citationId}" not found.`)
            }
            core.claimCitations.remove(citationId)
            await persistCore(core)
            printLine("success")
        })
}
