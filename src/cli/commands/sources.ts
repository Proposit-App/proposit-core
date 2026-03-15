import { Command } from "commander"
import { errorExit } from "../output.js"
import { readVersionMeta } from "../storage/arguments.js"

async function assertNotPublished(
    argumentId: string,
    version: number
): Promise<void> {
    const meta = await readVersionMeta(argumentId, version)
    if (meta.published) {
        errorExit(
            `Version ${version} of argument "${argumentId}" is published and cannot be modified.`
        )
    }
}

export function registerSourceCommands(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    const sources = versionedCmd
        .command("sources")
        .description("Manage sources and associations")

    // ── add ────────────────────────────────────────────────────────────────
    sources
        .command("add")
        .description("Add a new source")
        .requiredOption("--url <url>", "Source URL")
        .option(
            "--id <source_id>",
            "Explicit source ID (default: generated UUID)"
        )
        .action(async (_opts: { url: string; id?: string }) => {
            await assertNotPublished(argumentId, version)
            errorExit(
                "Source entity management has moved to global libraries. Not yet implemented in CLI."
            )
        })

    // ── remove ─────────────────────────────────────────────────────────────
    sources
        .command("remove <source_id>")
        .description("Remove a source and its associations")
        .action(async (_sourceId: string) => {
            await assertNotPublished(argumentId, version)
            errorExit(
                "Source entity management has moved to global libraries. Not yet implemented in CLI."
            )
        })

    // ── list ───────────────────────────────────────────────────────────────
    sources
        .command("list")
        .description("List all sources")
        .option("--json", "Output as JSON")
        .action(async (_opts: { json?: boolean }) => {
            errorExit(
                "Source entity management has moved to global libraries. Not yet implemented in CLI."
            )
        })

    // ── show ───────────────────────────────────────────────────────────────
    sources
        .command("show <source_id>")
        .description("Show a source and its associations")
        .option("--json", "Output as JSON")
        .action(async (_sourceId: string, _opts: { json?: boolean }) => {
            errorExit(
                "Source entity management has moved to global libraries. Not yet implemented in CLI."
            )
        })

    // ── link-claim ─────────────────────────────────────────────────────────
    sources
        .command("link-claim <source_id> <claim_id>")
        .description("Link a source to a claim")
        .action(async (_sourceId: string, _claimId: string) => {
            await assertNotPublished(argumentId, version)
            errorExit(
                "Claim-source association management via CLI is not yet implemented. Use the library API directly."
            )
        })

    // ── unlink ─────────────────────────────────────────────────────────────
    sources
        .command("unlink <association_id>")
        .description("Remove a claim-source association")
        .action(async (_associationId: string) => {
            await assertNotPublished(argumentId, version)
            errorExit(
                "Claim-source association management via CLI is not yet implemented. Use the library API directly."
            )
        })
}
