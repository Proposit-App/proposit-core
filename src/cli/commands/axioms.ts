import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydratePropositCore, persistCore } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"

export function registerAxiomCommands(program: Command): void {
    const axioms = program
        .command("axioms")
        .description("Manage global claim-axiom library")

    axioms
        .command("list")
        .description("List all axiom connections")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            const all = core.axioms.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const axiom of all) {
                    printLine(
                        `${axiom.id} | ${axiom.claimId}@${axiom.claimVersion} <- ${axiom.supportingClaimId}@${axiom.supportingClaimVersion}`
                    )
                }
            }
        })

    axioms
        .command("show <connection_id>")
        .description("Show a single axiom connection")
        .option("--json", "Output as JSON")
        .action(async (connectionId: string, opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            const axiom = core.axioms.get(connectionId)
            if (!axiom) {
                errorExit(`Axiom connection "${connectionId}" not found.`)
            }
            if (opts.json) {
                printJson(axiom)
            } else {
                printLine(`id:                     ${axiom.id}`)
                printLine(`claimId:                ${axiom.claimId}`)
                printLine(`claimVersion:           ${axiom.claimVersion}`)
                printLine(`supportingClaimId:      ${axiom.supportingClaimId}`)
                printLine(
                    `supportingClaimVersion: ${axiom.supportingClaimVersion}`
                )
            }
        })

    axioms
        .command("add")
        .description(
            "Add an axiom connection between two claims (supporting claim must be an axiomatic-typed claim, dependent claim must be a normal-typed claim)"
        )
        .requiredOption(
            "--claim-id <id>",
            "Claim ID being supported (must have type='normal')"
        )
        .requiredOption(
            "--axiom-id <id>",
            "Axiomatic claim ID providing support (must have type='axiomatic')"
        )
        .action(async (opts: { claimId: string; axiomId: string }) => {
            const core = await hydratePropositCore()
            const claim = core.claims.getCurrent(opts.claimId)
            if (!claim) {
                errorExit(`Claim "${opts.claimId}" not found.`)
            }
            const axiomClaim = core.claims.getCurrent(opts.axiomId)
            if (!axiomClaim) {
                errorExit(`Claim "${opts.axiomId}" not found.`)
            }
            let connection
            try {
                connection = core.axioms.add({
                    id: randomUUID(),
                    claimId: claim.id,
                    claimVersion: claim.version,
                    supportingClaimId: axiomClaim.id,
                    supportingClaimVersion: axiomClaim.version,
                })
            } catch (error) {
                errorExit(
                    error instanceof Error ? error.message : String(error)
                )
            }
            await persistCore(core)
            printLine(connection.id)
        })

    axioms
        .command("remove <connection_id>")
        .description("Remove an axiom connection")
        .action(async (connectionId: string) => {
            const core = await hydratePropositCore()
            const axiom = core.axioms.get(connectionId)
            if (!axiom) {
                errorExit(`Axiom connection "${connectionId}" not found.`)
            }
            core.axioms.remove(connectionId)
            await persistCore(core)
            printLine("success")
        })
}
