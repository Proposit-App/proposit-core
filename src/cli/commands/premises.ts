import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { PremiseEngine } from "../../lib/core/premise-engine.js"
import { VariableManager } from "../../lib/core/variable-manager.js"
import { ManagedDerivationPremiseEngine } from "../../lib/core/managed-derivation-premise-engine.js"
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
} from "../storage/premises.js"
import { hydrateEngine, hydratePropositCore, persistEngine } from "../engine.js"
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
        .option(
            "--symbol <symbol>",
            "Symbol for the auto-created premise-bound variable"
        )
        .option(
            "--type <type>",
            "Premise type: 'freeform' or 'derivation' (default: freeform)"
        )
        .option(
            "--derived-claim <claimId>",
            "Required when --type=derivation; the id of the derived claim"
        )
        .action(
            async (opts: {
                title?: string
                symbol?: string
                type?: string
                derivedClaim?: string
            }) => {
                const premiseType = opts.type ?? "freeform"
                if (
                    premiseType !== "freeform" &&
                    premiseType !== "derivation"
                ) {
                    errorExit(
                        `--type must be 'freeform' or 'derivation' (got '${premiseType}')`
                    )
                }
                if (premiseType === "derivation" && !opts.derivedClaim) {
                    errorExit(
                        "premises create --type=derivation requires --derived-claim <claimId>"
                    )
                }

                await assertNotPublished(argumentId, version)
                const engine = await hydrateEngine(argumentId, version)

                const id = randomUUID()
                const extras: Record<string, unknown> = {}
                if (opts.title) extras.title = opts.title

                try {
                    if (premiseType === "derivation") {
                        engine.createPremiseWithId(id, {
                            type: "derivation",
                            derivedClaimId: opts.derivedClaim,
                            extras,
                            symbol: opts.symbol,
                        })
                    } else {
                        engine.createPremiseWithId(id, extras, opts.symbol)
                    }
                } catch (err) {
                    errorExit(err instanceof Error ? err.message : String(err))
                }

                await persistEngine(engine)
                printLine(
                    id +
                        (premiseType === "derivation"
                            ? ` (derivation for claim ${opts.derivedClaim})`
                            : "")
                )
            }
        )

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
                    const metaRecord = meta as Record<string, unknown>
                    const typeBadge =
                        metaRecord.type === "derivation" ? " [derivation]" : ""
                    printLine(
                        `${meta.id}${typeBadge} | ${premiseType} | ${display} | ${title}`
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

            const engine = await hydrateEngine(argumentId, version)
            try {
                engine.removePremise(premiseId)
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            await persistEngine(engine)
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

                const engine = await hydrateEngine(argumentId, version)
                const pm = engine.getPremise(premiseId)
                if (!pm) {
                    errorExit(`Premise "${premiseId}" not found.`)
                }

                try {
                    if (opts.clearTitle) {
                        const extras = pm.getExtras()
                        delete extras.title
                        pm.setExtras(extras)
                    } else if (opts.title !== undefined) {
                        pm.updateExtras({ title: opts.title })
                    } else {
                        errorExit(
                            "No updates specified. Use --title or --clear-title."
                        )
                    }
                } catch (err) {
                    errorExit(err instanceof Error ? err.message : String(err))
                }

                await persistEngine(engine)
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
                const metaRecord = meta as Record<string, unknown>
                const derivationBadge =
                    metaRecord.type === "derivation" ? " [derivation]" : ""
                printLine(`id:           ${meta.id}`)
                printLine(`title:        ${meta.title ?? "(untitled)"}`)
                printLine(`type:         ${premiseType}${derivationBadge}`)
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

    premises
        .command("populate-citations <premiseId>")
        .description(
            "Populate a derivation premise's antecedent from current citations of its derived claim"
        )
        .action(async (premiseId: string) => {
            await assertNotPublished(argumentId, version)

            const propositCore = await hydratePropositCore()
            const engine = await hydrateEngine(
                argumentId,
                version,
                propositCore
            )

            const livePremise = engine.getPremise(premiseId)
            if (!livePremise) {
                errorExit(
                    `Premise "${premiseId}" not found in active argument.`
                )
            }

            const premiseData = livePremise.toPremiseData()
            if (premiseData.type !== "derivation") {
                errorExit(
                    `Premise "${premiseId}" is not a derivation premise (type=${premiseData.type ?? "freeform"}).`
                )
            }

            // Build a VariableManager populated with the live engine's current
            // variables. The managed engine needs at least the consequent
            // variable (bound to derivedClaimId) for structural validation.
            const variableManager = new VariableManager()
            for (const v of engine.getVariables()) {
                variableManager.addVariable(v)
            }

            // Take a snapshot of the live premise and restore it into a
            // ManagedDerivationPremiseEngine (independent copy).
            const premiseSnapshot = livePremise.snapshot()

            let managed: ManagedDerivationPremiseEngine
            try {
                managed = ManagedDerivationPremiseEngine.fromSnapshot(
                    premiseSnapshot,
                    engine.getArgument(),
                    variableManager
                )
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            // populateFromSupports mutates the managed engine's expression tree
            // and calls engine.ensureClaimBoundVariable for each supporting
            // claim (citations + axioms), which adds new claim-bound variables
            // to the live engine.
            try {
                managed.populateFromSupports(
                    propositCore.claimCitations,
                    propositCore.axioms,
                    engine
                )
            } catch (err) {
                errorExit(err instanceof Error ? err.message : String(err))
            }

            // Reflow: push the managed engine's updated expression tree into the
            // live premise engine. The live premise (a plain PremiseEngine) uses
            // loadExpressions without derivation validation — that already ran
            // inside populateFromSupports via assertWellFormed().
            livePremise.loadExpressions(managed.getExpressions())

            await persistEngine(engine)
            printLine(`Populated derivation premise "${premiseId}".`)
        })
}
