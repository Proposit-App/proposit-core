import { randomUUID } from "node:crypto"
import { Command } from "commander"
import {
    errorExit,
    printJson,
    printLine,
    requireConfirmation,
} from "../output.js"
import { readVersionMeta } from "../storage/arguments.js"
import { listPremiseIds, readPremiseData } from "../storage/premises.js"
import { readVariables, writeVariables } from "../storage/variables.js"

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

/** Collect the set of variable IDs referenced by any expression in any premise. */
async function referencedVariableIds(
    argumentId: string,
    version: number
): Promise<Set<string>> {
    const premiseIds = await listPremiseIds(argumentId, version)
    const referenced = new Set<string>()
    for (const premiseId of premiseIds) {
        const data = await readPremiseData(argumentId, version, premiseId)
        for (const id of data.variables) {
            referenced.add(id)
        }
    }
    return referenced
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
            const variables = await readVariables(argumentId, version)

            if (variables.some((v) => v.symbol === symbol)) {
                errorExit(`Symbol "${symbol}" is already in use.`)
            }
            const newId = opts.id ?? randomUUID()
            if (variables.some((v) => v.id === newId)) {
                errorExit(`Variable ID "${newId}" already exists.`)
            }

            variables.push({
                id: newId,
                argumentId,
                argumentVersion: version,
                symbol,
                metadata: {},
            })
            await writeVariables(argumentId, version, variables)
            printLine(newId)
        })

    vars.command("list")
        .description("List all variables")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const variables = await readVariables(argumentId, version)
            const sorted = [...variables].sort((a, b) =>
                a.id.localeCompare(b.id)
            )
            if (opts.json) {
                printJson(sorted)
            } else {
                for (const v of sorted) {
                    printLine(`${v.id} | ${v.symbol}`)
                }
            }
        })

    vars.command("show <variable_id>")
        .description("Show a single variable")
        .option("--json", "Output as JSON")
        .action(async (variableId: string, opts: { json?: boolean }) => {
            const variables = await readVariables(argumentId, version)
            const variable = variables.find((v) => v.id === variableId)
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
            const variables = await readVariables(argumentId, version)
            const idx = variables.findIndex((v) => v.id === variableId)
            if (idx === -1) errorExit(`Variable "${variableId}" not found.`)

            if (opts.symbol !== undefined) {
                if (
                    variables.some(
                        (v) => v.symbol === opts.symbol && v.id !== variableId
                    )
                ) {
                    errorExit(`Symbol "${opts.symbol}" is already in use.`)
                }
                variables[idx] = { ...variables[idx], symbol: opts.symbol }
            }

            await writeVariables(argumentId, version, variables)
            printLine("success")
        })

    vars.command("delete <variable_id>")
        .description(
            "Remove a variable (fails if any expression references it)"
        )
        .action(async (variableId: string) => {
            await assertNotPublished(argumentId, version)
            const variables = await readVariables(argumentId, version)
            if (!variables.some((v) => v.id === variableId)) {
                errorExit(`Variable "${variableId}" not found.`)
            }

            // Check references
            const premiseIds = await listPremiseIds(argumentId, version)
            for (const premiseId of premiseIds) {
                const data = await readPremiseData(
                    argumentId,
                    version,
                    premiseId
                )
                for (const expr of data.expressions) {
                    if (
                        expr.type === "variable" &&
                        expr.variableId === variableId
                    ) {
                        errorExit(
                            `Variable "${variableId}" is referenced by expression "${expr.id}" in premise "${premiseId}".`
                        )
                    }
                }
            }

            await writeVariables(
                argumentId,
                version,
                variables.filter((v) => v.id !== variableId)
            )
            printLine("success")
        })

    vars.command("list-unused")
        .description("List variables not referenced by any expression")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const variables = await readVariables(argumentId, version)
            const referenced = await referencedVariableIds(argumentId, version)
            const unused = variables
                .filter((v) => !referenced.has(v.id))
                .sort((a, b) => a.id.localeCompare(b.id))

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
            const variables = await readVariables(argumentId, version)
            const referenced = await referencedVariableIds(argumentId, version)
            const unused = variables.filter((v) => !referenced.has(v.id))

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

            const unusedIds = new Set(unused.map((v) => v.id))
            await writeVariables(
                argumentId,
                version,
                variables.filter((v) => !unusedIds.has(v.id))
            )

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
