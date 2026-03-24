import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { PremiseEngine } from "../../lib/core/premise-engine.js"
import { VariableManager } from "../../lib/core/variable-manager.js"
import type { TCoreArgument, TCorePremise } from "../../lib/schemata/index.js"
import type { TOptionalChecksum } from "../../lib/schemata/shared.js"
import {
    errorExit,
    printJson,
    printLine,
    requireConfirmation,
} from "../output.js"
import { readArgumentMeta, readVersionMeta } from "../storage/arguments.js"
import {
    deletePremiseDir,
    listPremiseIds,
    premiseExists,
    readPremiseData,
    readPremiseMeta,
    writePremiseData,
    writePremiseMeta,
} from "../storage/premises.js"
import { readRoles, writeRoles } from "../storage/roles.js"
import { readVariables } from "../storage/variables.js"

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

async function buildArgument(
    argumentId: string,
    version: number
): Promise<TOptionalChecksum<TCoreArgument>> {
    const [argMeta, vMeta] = await Promise.all([
        readArgumentMeta(argumentId),
        readVersionMeta(argumentId, version),
    ])
    return { ...argMeta, ...vMeta }
}

export function registerPremiseCommands(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    const premises = versionedCmd
        .command("premises")
        .description("Manage premises")

    premises
        .command("create")
        .description("Create a new premise")
        .option("--title <title>", "Optional title for the premise")
        .action(async (opts: { title?: string }) => {
            await assertNotPublished(argumentId, version)
            const id = randomUUID()
            await writePremiseMeta(argumentId, version, {
                id,
                ...(opts.title ? { title: opts.title } : {}),
            })
            await writePremiseData(argumentId, version, id, {
                variables: [],
                expressions: [],
            })
            printLine(id)
        })

    premises
        .command("list")
        .description("List all premises")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const argument = await buildArgument(argumentId, version)
            const allVariables = await readVariables(argumentId, version)
            const premiseIds = await listPremiseIds(argumentId, version)

            const results = await Promise.all(
                premiseIds.map(async (pid) => {
                    const [meta, data] = await Promise.all([
                        readPremiseMeta(argumentId, version, pid),
                        readPremiseData(argumentId, version, pid),
                    ])

                    // Hydrate a temporary PremiseEngine for display string
                    const { id: _id, ...premiseExtras } = meta
                    const vm = new VariableManager()
                    for (const v of allVariables) {
                        vm.addVariable({ ...v, argumentVersion: version })
                    }
                    const pm = new PremiseEngine(
                        {
                            id: pid,
                            argumentId: argument.id,
                            argumentVersion: version,
                            ...premiseExtras,
                        } as TCorePremise,
                        { argument, variables: vm }
                    )

                    // Add expressions BFS-order
                    const remaining = [...data.expressions]
                    const added = new Set<string>()
                    for (let i = remaining.length - 1; i >= 0; i--) {
                        const expr = remaining[i]
                        if (expr.parentId === null) {
                            pm.addExpression({
                                ...expr,
                                premiseId: pid,
                                argumentVersion: version,
                            })
                            added.add(expr.id)
                            remaining.splice(i, 1)
                        }
                    }
                    let progress = true
                    while (remaining.length > 0 && progress) {
                        progress = false
                        for (let i = remaining.length - 1; i >= 0; i--) {
                            const expr = remaining[i]
                            if (
                                expr.parentId !== null &&
                                added.has(expr.parentId)
                            ) {
                                pm.addExpression({
                                    ...expr,
                                    premiseId: pid,
                                    argumentVersion: version,
                                })
                                added.add(expr.id)
                                remaining.splice(i, 1)
                                progress = true
                            }
                        }
                    }

                    return { meta, data, pm }
                })
            )

            if (opts.json) {
                printJson(
                    results.map(({ meta, data }) => ({
                        ...meta,
                        ...data,
                    }))
                )
            } else {
                for (const { meta, pm } of results) {
                    const display = pm.toDisplayString() || "(empty)"
                    const title = meta.title ?? "(untitled)"
                    const premiseType = pm.isInference()
                        ? "inference"
                        : "constraint"
                    printLine(
                        `${meta.id} | ${premiseType} | ${display} | ${title}`
                    )
                }
            }
        })

    premises
        .command("delete <premise_id>")
        .description("Delete a premise")
        .option("--confirm", "Skip confirmation prompt")
        .action(async (premiseId: string, opts: { confirm?: boolean }) => {
            await assertNotPublished(argumentId, version)
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }
            if (!opts.confirm) {
                await requireConfirmation(`Delete premise "${premiseId}"?`)
            }

            // Clean up roles
            const roles = await readRoles(argumentId, version)
            if (roles.conclusionPremiseId === premiseId) {
                await writeRoles(argumentId, version, {
                    ...roles,
                    conclusionPremiseId: undefined,
                })
            }

            await deletePremiseDir(argumentId, version, premiseId)
            printLine("success")
        })

    premises
        .command("update <premise_id>")
        .description("Update premise metadata")
        .option("--title <new_title>", "New title")
        .option("--clear-title", "Remove the title")
        .action(
            async (
                premiseId: string,
                opts: { title?: string; clearTitle?: boolean }
            ) => {
                await assertNotPublished(argumentId, version)
                if (opts.title !== undefined && opts.clearTitle) {
                    errorExit(
                        "--title and --clear-title cannot both be specified."
                    )
                }
                if (!(await premiseExists(argumentId, version, premiseId))) {
                    errorExit(`Premise "${premiseId}" not found.`)
                }
                const meta = await readPremiseMeta(
                    argumentId,
                    version,
                    premiseId
                )
                if (opts.clearTitle) {
                    delete meta.title
                } else if (opts.title !== undefined) {
                    meta.title = opts.title
                }
                await writePremiseMeta(argumentId, version, meta)
                printLine("success")
            }
        )

    premises
        .command("show <premise_id>")
        .description("Show a single premise")
        .option("--json", "Output as JSON")
        .action(async (premiseId: string, opts: { json?: boolean }) => {
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }
            const [meta, data] = await Promise.all([
                readPremiseMeta(argumentId, version, premiseId),
                readPremiseData(argumentId, version, premiseId),
            ])
            if (opts.json) {
                printJson({ ...meta, ...data })
            } else {
                const rootExpr = data.rootExpressionId
                    ? data.expressions.find(
                          (e) => e.id === data.rootExpressionId
                      )
                    : undefined
                const premiseType =
                    rootExpr?.type === "operator" &&
                    (rootExpr.operator === "implies" ||
                        rootExpr.operator === "iff")
                        ? "inference"
                        : "constraint"
                printLine(`id:           ${meta.id}`)
                printLine(`title:        ${meta.title ?? "(untitled)"}`)
                printLine(`type:         ${premiseType}`)
                printLine(`root expr id: ${data.rootExpressionId ?? "(none)"}`)
                printLine(`variables:    ${data.variables.length}`)
                printLine(`expressions:  ${data.expressions.length}`)
            }
        })

    premises
        .command("render <premise_id>")
        .description("Render the premise as a logical expression string")
        .action(async (premiseId: string) => {
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }
            const argument = await buildArgument(argumentId, version)
            const allVariables = await readVariables(argumentId, version)
            const [meta, data] = await Promise.all([
                readPremiseMeta(argumentId, version, premiseId),
                readPremiseData(argumentId, version, premiseId),
            ])

            const { id: _id, ...renderPremiseExtras } = meta
            const renderVm = new VariableManager()
            for (const v of allVariables) {
                renderVm.addVariable({ ...v, argumentVersion: version })
            }
            const pm = new PremiseEngine(
                {
                    id: premiseId,
                    argumentId: argument.id,
                    argumentVersion: version,
                    ...renderPremiseExtras,
                } as TCorePremise,
                { argument, variables: renderVm }
            )

            const remaining = [...data.expressions]
            const added = new Set<string>()
            for (let i = remaining.length - 1; i >= 0; i--) {
                const expr = remaining[i]
                if (expr.parentId === null) {
                    pm.addExpression({
                        ...expr,
                        premiseId: premiseId,
                        argumentVersion: version,
                    })
                    added.add(expr.id)
                    remaining.splice(i, 1)
                }
            }
            let progress = true
            while (remaining.length > 0 && progress) {
                progress = false
                for (let i = remaining.length - 1; i >= 0; i--) {
                    const expr = remaining[i]
                    if (expr.parentId !== null && added.has(expr.parentId)) {
                        pm.addExpression({
                            ...expr,
                            premiseId: premiseId,
                            argumentVersion: version,
                        })
                        added.add(expr.id)
                        remaining.splice(i, 1)
                        progress = true
                    }
                }
            }

            printLine(pm.toDisplayString())
        })
}
