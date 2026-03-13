import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydrateEngine, persistEngine } from "../engine.js"
import {
    errorExit,
    printJson,
    printLine,
    requireConfirmation,
} from "../output.js"
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

export function registerVariableCommands(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    const vars = versionedCmd
        .command("variables")
        .description("Manage argument-level variables")

    vars.command("create <symbol>")
        .description("Register a new propositional variable")
        .option(
            "--id <variable_id>",
            "Explicit variable ID (default: generated UUID)"
        )
        .action(async (symbol: string, opts: { id?: string }) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            const newId = opts.id ?? randomUUID()
            const variable = {
                id: newId,
                argumentId,
                argumentVersion: version,
                symbol,
                // TODO: resolve actual assertionId from AssertionLibrary
                assertionId: "",
                assertionVersion: 0,
            }

            try {
                engine.addVariable(variable)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
            printLine(newId)
        })

    vars.command("list")
        .description("List all variables")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const variables = engine.getVariables()

            if (opts.json) {
                printJson(variables)
            } else {
                for (const v of variables) {
                    printLine(`${v.id} | ${v.symbol}`)
                }
            }
        })

    vars.command("show <variable_id>")
        .description("Show a single variable")
        .option("--json", "Output as JSON")
        .action(async (variableId: string, opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const variable = engine
                .getVariables()
                .find((v) => v.id === variableId)
            if (!variable) errorExit(`Variable "${variableId}" not found.`)
            if (opts.json) {
                printJson(variable)
            } else {
                printLine(`${variable.id} | ${variable.symbol}`)
            }
        })

    vars.command("update <variable_id>")
        .description("Update a variable symbol")
        .option("--symbol <new_symbol>", "New symbol")
        .action(async (variableId: string, opts: { symbol?: string }) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            if (!engine.getVariables().some((v) => v.id === variableId)) {
                errorExit(`Variable "${variableId}" not found.`)
            }

            if (opts.symbol !== undefined) {
                try {
                    engine.updateVariable(variableId, {
                        symbol: opts.symbol,
                    })
                } catch (err) {
                    errorExit(err instanceof Error ? err.message : String(err))
                }
            }

            await persistEngine(engine)
            printLine("success")
        })

    vars.command("delete <variable_id>")
        .description(
            "Remove a variable (cascade-deletes referencing expressions)"
        )
        .action(async (variableId: string) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)

            if (!engine.getVariables().some((v) => v.id === variableId)) {
                errorExit(`Variable "${variableId}" not found.`)
            }

            engine.removeVariable(variableId)
            await persistEngine(engine)
            printLine("success")
        })

    vars.command("list-unused")
        .description("List variables not referenced by any expression")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const variables = engine.getVariables()
            const referenced = engine.collectReferencedVariables()
            const referencedIds = new Set(referenced.variableIds)
            const unused = variables.filter((v) => !referencedIds.has(v.id))

            if (opts.json) {
                printJson(unused)
            } else {
                for (const v of unused) {
                    printLine(`${v.id} | ${v.symbol}`)
                }
            }
        })

    vars.command("delete-unused")
        .description("Delete all variables not referenced by any expression")
        .option("--confirm", "Skip confirmation prompt")
        .option("--json", "Output as JSON")
        .action(async (opts: { confirm?: boolean; json?: boolean }) => {
            await assertNotPublished(argumentId, version)
            const engine = await hydrateEngine(argumentId, version)
            const variables = engine.getVariables()
            const referenced = engine.collectReferencedVariables()
            const referencedIds = new Set(referenced.variableIds)
            const unused = variables.filter((v) => !referencedIds.has(v.id))

            if (unused.length === 0) {
                if (opts.json) {
                    printJson({ deleted: 0, deletedIds: [] })
                } else {
                    printLine("0 variable(s) deleted")
                }
                return
            }

            if (!opts.confirm) {
                await requireConfirmation(
                    `Delete ${unused.length} unused variable(s)?`
                )
            }

            for (const v of unused) {
                engine.removeVariable(v.id)
            }
            await persistEngine(engine)

            if (opts.json) {
                printJson({
                    deleted: unused.length,
                    deletedIds: unused.map((v) => v.id),
                })
            } else {
                printLine(`${unused.length} variable(s) deleted`)
            }
        })
}
