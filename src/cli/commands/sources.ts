import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydrateEngine, persistEngine } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"
import { readVersionMeta } from "../storage/arguments.js"
import { deleteSourceDir } from "../storage/sources.js"

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
        .action(async (opts: { url: string; id?: string }) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            const newId = opts.id ?? randomUUID()
            const source = {
                id: newId,
                argumentId,
                argumentVersion: version,
                url: opts.url,
            }

            try {
                engine.addSource(source)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
            printLine(newId)
        })

    // ── remove ─────────────────────────────────────────────────────────────
    sources
        .command("remove <source_id>")
        .description("Remove a source and its associations")
        .action(async (sourceId: string) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            if (!engine.getSource(sourceId)) {
                errorExit(`Source "${sourceId}" not found.`)
            }

            engine.removeSource(sourceId)
            await persistEngine(engine)
            await deleteSourceDir(argumentId, version, sourceId)
            printLine("success")
        })

    // ── list ───────────────────────────────────────────────────────────────
    sources
        .command("list")
        .description("List all sources")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const allSources = engine.getSources()

            if (opts.json) {
                printJson(allSources)
            } else {
                for (const s of allSources) {
                    const record = s as Record<string, unknown>
                    const url = typeof record.url === "string" ? record.url : ""
                    printLine(`${s.id} | ${url}`)
                }
            }
        })

    // ── show ───────────────────────────────────────────────────────────────
    sources
        .command("show <source_id>")
        .description("Show a source and its associations")
        .option("--json", "Output as JSON")
        .action(async (sourceId: string, opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const source = engine.getSource(sourceId)
            if (!source) errorExit(`Source "${sourceId}" not found.`)

            const associations = engine.getAssociationsForSource(sourceId)

            if (opts.json) {
                printJson({ source, associations })
            } else {
                const record = source as Record<string, unknown>
                const url = typeof record.url === "string" ? record.url : ""
                printLine(`${source.id} | ${url}`)
                if (associations.variable.length > 0) {
                    printLine("Variable associations:")
                    for (const a of associations.variable) {
                        printLine(`  ${a.id} → variable ${a.variableId}`)
                    }
                }
                if (associations.expression.length > 0) {
                    printLine("Expression associations:")
                    for (const a of associations.expression) {
                        printLine(
                            `  ${a.id} → expression ${a.expressionId} (premise ${a.premiseId})`
                        )
                    }
                }
            }
        })

    // ── link-variable ──────────────────────────────────────────────────────
    sources
        .command("link-variable <source_id> <variable_id>")
        .description("Link a source to a variable")
        .action(async (sourceId: string, variableId: string) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            try {
                engine.addVariableSourceAssociation(sourceId, variableId)
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
                engine.addExpressionSourceAssociation(
                    sourceId,
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
