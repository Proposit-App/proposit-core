import { Command } from "commander"
import { hydrateEngine, persistEngine } from "../engine.js"
import { errorExit, printLine } from "../output.js"
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
                "Source entity management has moved to global SourceLibrary. Not yet implemented in CLI."
            )
        })

    // ── remove ─────────────────────────────────────────────────────────────
    sources
        .command("remove <source_id>")
        .description("Remove a source and its associations")
        .action(async (_sourceId: string) => {
            await assertNotPublished(argumentId, version)
            errorExit(
                "Source entity management has moved to global SourceLibrary. Not yet implemented in CLI."
            )
        })

    // ── list ───────────────────────────────────────────────────────────────
    sources
        .command("list")
        .description("List all sources")
        .option("--json", "Output as JSON")
        .action(async (_opts: { json?: boolean }) => {
            errorExit(
                "Source entity management has moved to global SourceLibrary. Not yet implemented in CLI."
            )
        })

    // ── show ───────────────────────────────────────────────────────────────
    sources
        .command("show <source_id>")
        .description("Show a source and its associations")
        .option("--json", "Output as JSON")
        .action(async (_sourceId: string, _opts: { json?: boolean }) => {
            errorExit(
                "Source entity management has moved to global SourceLibrary. Not yet implemented in CLI."
            )
        })

    // ── link-variable ──────────────────────────────────────────────────────
    sources
        .command("link-variable <source_id> <variable_id>")
        .description("Link a source to a variable")
        .action(async (sourceId: string, variableId: string) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            try {
                // TODO: resolve actual source version from SourceLibrary
                engine.addVariableSourceAssociation(sourceId, 0, variableId)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
            printLine("success")
        })

    // ── link-expression ────────────────────────────────────────────────────
    sources
        .command("link-expression <source_id> <expression_id>")
        .description("Link a source to an expression")
        .action(async (sourceId: string, expressionId: string) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            // Find which premise owns this expression
            const premise = engine.findPremiseByExpressionId(expressionId)
            if (!premise) {
                errorExit(
                    `Expression "${expressionId}" not found in any premise.`
                )
            }

            try {
                // TODO: resolve actual source version from SourceLibrary
                engine.addExpressionSourceAssociation(
                    sourceId,
                    0,
                    expressionId,
                    premise.getId()
                )
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
            printLine("success")
        })

    // ── unlink ─────────────────────────────────────────────────────────────
    sources
        .command("unlink <association_id>")
        .description("Remove a source association")
        .action(async (associationId: string) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            // Check variable associations first
            const varAssoc = engine
                .getAllVariableSourceAssociations()
                .find((a) => a.id === associationId)
            if (varAssoc) {
                engine.removeVariableSourceAssociation(associationId)
                await persistEngine(engine)
                printLine("success")
                return
            }

            // Check expression associations
            const exprAssoc = engine
                .getAllExpressionSourceAssociations()
                .find((a) => a.id === associationId)
            if (exprAssoc) {
                engine.removeExpressionSourceAssociation(associationId)
                await persistEngine(engine)
                printLine("success")
                return
            }

            errorExit(`Association "${associationId}" not found.`)
        })
}
