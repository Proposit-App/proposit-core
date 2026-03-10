import { randomUUID } from "node:crypto"
import { Command } from "commander"
import type { TCoreLogicalOperatorType } from "../../lib/schemata/index.js"
import type { TExpressionInput } from "../../lib/core/expression-manager.js"
import { POSITION_INITIAL } from "../../lib/utils/position.js"
import { hydrateEngine } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"
import { readVersionMeta } from "../storage/arguments.js"
import {
    premiseExists,
    readPremiseData,
    writePremiseData,
} from "../storage/premises.js"

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

function typeSpecificInfo(expr: {
    type: string
    variableId?: string
    operator?: string
}): string {
    if (expr.type === "variable") return `variableId=${expr.variableId}`
    if (expr.type === "operator") return `operator=${expr.operator}`
    return ""
}

export function registerExpressionCommands(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    const exprs = versionedCmd
        .command("expressions")
        .description("Manage premise expressions")

    exprs
        .command("create <premise_id>")
        .description("Add an expression to a premise")
        .requiredOption(
            "--type <type>",
            "Expression type: variable, operator, formula"
        )
        .option("--id <id>", "Expression ID (default: generated UUID)")
        .option(
            "--parent-id <parent_id>",
            "Parent expression ID (omit for root)"
        )
        .option("--position <n>", "Position among siblings")
        .option(
            "--before <sibling_id>",
            "Insert before this sibling expression"
        )
        .option("--after <sibling_id>", "Insert after this sibling expression")
        .option(
            "--variable-id <variable_id>",
            "Variable ID (for type=variable)"
        )
        .option(
            "--operator <op>",
            "Operator (for type=operator): not,and,or,implies,iff"
        )
        .action(
            async (
                premiseId: string,
                opts: {
                    type: string
                    id?: string
                    parentId?: string
                    position?: string
                    before?: string
                    after?: string
                    variableId?: string
                    operator?: string
                }
            ) => {
                await assertNotPublished(argumentId, version)
                if (!(await premiseExists(argumentId, version, premiseId))) {
                    errorExit(`Premise "${premiseId}" not found.`)
                }

                const engine = await hydrateEngine(argumentId, version)
                const pm = engine.getPremise(premiseId)
                if (!pm)
                    errorExit(`Premise "${premiseId}" not found in engine.`)

                const id = opts.id ?? randomUUID()
                const parentId = opts.parentId ?? null
                const position =
                    opts.position !== undefined
                        ? Number(opts.position)
                        : POSITION_INITIAL

                let expression: TExpressionInput
                if (opts.type === "variable") {
                    if (!opts.variableId)
                        errorExit("--variable-id is required for type=variable")
                    expression = {
                        id,
                        argumentId,
                        argumentVersion: version,
                        premiseId,
                        parentId,
                        position,
                        type: "variable",
                        variableId: opts.variableId,
                    }
                } else if (opts.type === "operator") {
                    if (!opts.operator)
                        errorExit("--operator is required for type=operator")
                    expression = {
                        id,
                        argumentId,
                        argumentVersion: version,
                        premiseId,
                        parentId,
                        position,
                        type: "operator",
                        operator: opts.operator as TCoreLogicalOperatorType,
                    }
                } else if (opts.type === "formula") {
                    expression = {
                        id,
                        argumentId,
                        argumentVersion: version,
                        premiseId,
                        parentId,
                        position,
                        type: "formula",
                    }
                } else {
                    errorExit(
                        `Unknown type "${opts.type}". Use variable, operator, or formula.`
                    )
                }

                const hasBefore = opts.before !== undefined
                const hasAfter = opts.after !== undefined
                const hasPosition = opts.position !== undefined

                if ((hasBefore || hasAfter) && hasPosition) {
                    errorExit(
                        "Cannot combine --before/--after with --position."
                    )
                }
                if (hasBefore && hasAfter) {
                    errorExit("Cannot combine --before and --after.")
                }

                try {
                    if (hasBefore) {
                        const { position: _p, ...exprWithoutPosition } =
                            expression
                        pm.addExpressionRelative(
                            opts.before!,
                            "before",
                            exprWithoutPosition
                        )
                    } else if (hasAfter) {
                        const { position: _p, ...exprWithoutPosition } =
                            expression
                        pm.addExpressionRelative(
                            opts.after!,
                            "after",
                            exprWithoutPosition
                        )
                    } else if (hasPosition) {
                        pm.addExpression(expression)
                    } else {
                        const { position: _p, ...exprWithoutPosition } =
                            expression
                        pm.appendExpression(parentId, exprWithoutPosition)
                    }
                } catch (e) {
                    errorExit(
                        e instanceof Error
                            ? e.message
                            : "Failed to add expression."
                    )
                }

                await writePremiseData(argumentId, version, premiseId, {
                    rootExpressionId: pm.getRootExpressionId(),
                    variables: [...pm.getReferencedVariableIds()].sort(),
                    expressions: pm.getExpressions(),
                })
                printLine(id)
            }
        )

    exprs
        .command("insert <premise_id>")
        .description("Insert an expression, wrapping existing nodes")
        .requiredOption(
            "--type <type>",
            "Expression type: variable, operator, formula"
        )
        .option("--id <id>", "Expression ID (default: generated UUID)")
        .option("--parent-id <parent_id>", "Parent expression ID")
        .option("--position <n>", "Position among siblings")
        .option(
            "--variable-id <variable_id>",
            "Variable ID (for type=variable)"
        )
        .option("--operator <op>", "Operator (for type=operator)")
        .option("--left-node-id <id>", "Left node to wrap")
        .option("--right-node-id <id>", "Right node to wrap")
        .action(
            async (
                premiseId: string,
                opts: {
                    type: string
                    id?: string
                    parentId?: string
                    position?: string
                    variableId?: string
                    operator?: string
                    leftNodeId?: string
                    rightNodeId?: string
                }
            ) => {
                await assertNotPublished(argumentId, version)
                if (!opts.leftNodeId && !opts.rightNodeId) {
                    errorExit(
                        "At least one of --left-node-id or --right-node-id is required."
                    )
                }
                if (!(await premiseExists(argumentId, version, premiseId))) {
                    errorExit(`Premise "${premiseId}" not found.`)
                }

                const engine = await hydrateEngine(argumentId, version)
                const pm = engine.getPremise(premiseId)
                if (!pm)
                    errorExit(`Premise "${premiseId}" not found in engine.`)

                const id = opts.id ?? randomUUID()
                const parentId = opts.parentId ?? null
                const position =
                    opts.position !== undefined
                        ? Number(opts.position)
                        : POSITION_INITIAL

                let expression: TExpressionInput
                if (opts.type === "variable") {
                    if (!opts.variableId)
                        errorExit("--variable-id is required for type=variable")
                    expression = {
                        id,
                        argumentId,
                        argumentVersion: version,
                        premiseId,
                        parentId,
                        position,
                        type: "variable",
                        variableId: opts.variableId,
                    }
                } else if (opts.type === "operator") {
                    if (!opts.operator)
                        errorExit("--operator is required for type=operator")
                    expression = {
                        id,
                        argumentId,
                        argumentVersion: version,
                        premiseId,
                        parentId,
                        position,
                        type: "operator",
                        operator: opts.operator as TCoreLogicalOperatorType,
                    }
                } else if (opts.type === "formula") {
                    expression = {
                        id,
                        argumentId,
                        argumentVersion: version,
                        premiseId,
                        parentId,
                        position,
                        type: "formula",
                    }
                } else {
                    errorExit(`Unknown type "${opts.type}".`)
                }

                try {
                    pm.insertExpression(
                        expression,
                        opts.leftNodeId,
                        opts.rightNodeId
                    )
                } catch (e) {
                    errorExit(
                        e instanceof Error
                            ? e.message
                            : "Failed to insert expression."
                    )
                }

                await writePremiseData(argumentId, version, premiseId, {
                    rootExpressionId: pm.getRootExpressionId(),
                    variables: [...pm.getReferencedVariableIds()].sort(),
                    expressions: pm.getExpressions(),
                })
                printLine(id)
            }
        )

    exprs
        .command("delete <premise_id> <expression_id>")
        .description("Remove an expression and its subtree")
        .action(async (premiseId: string, expressionId: string) => {
            await assertNotPublished(argumentId, version)
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }

            const engine = await hydrateEngine(argumentId, version)
            const pm = engine.getPremise(premiseId)
            if (!pm) errorExit(`Premise "${premiseId}" not found in engine.`)

            const { result: removed } = pm.removeExpression(expressionId, true)
            if (!removed) errorExit(`Expression "${expressionId}" not found.`)

            await writePremiseData(argumentId, version, premiseId, {
                rootExpressionId: pm.getRootExpressionId(),
                variables: [...pm.getReferencedVariableIds()].sort(),
                expressions: pm.getExpressions(),
            })
            printLine("success")
        })

    exprs
        .command("list <premise_id>")
        .description("List all expressions in a premise")
        .option("--json", "Output as JSON")
        .action(async (premiseId: string, opts: { json?: boolean }) => {
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" not found.`)
            }
            const data = await readPremiseData(argumentId, version, premiseId)
            const sorted = [...data.expressions].sort((a, b) =>
                a.id.localeCompare(b.id)
            )
            if (opts.json) {
                printJson(sorted)
            } else {
                for (const expr of sorted) {
                    const extra = typeSpecificInfo(expr)
                    printLine(
                        `${expr.id} | ${expr.type} | parent=${expr.parentId ?? "null"} | position=${expr.position}${extra ? ` | ${extra}` : ""}`
                    )
                }
            }
        })

    exprs
        .command("show <premise_id> <expression_id>")
        .description("Show a single expression")
        .option("--json", "Output as JSON")
        .action(
            async (
                premiseId: string,
                expressionId: string,
                opts: { json?: boolean }
            ) => {
                if (!(await premiseExists(argumentId, version, premiseId))) {
                    errorExit(`Premise "${premiseId}" not found.`)
                }
                const data = await readPremiseData(
                    argumentId,
                    version,
                    premiseId
                )
                const expr = data.expressions.find((e) => e.id === expressionId)
                if (!expr) errorExit(`Expression "${expressionId}" not found.`)
                if (opts.json) {
                    printJson(expr)
                } else {
                    printLine(`id:         ${expr.id}`)
                    printLine(`type:       ${expr.type}`)
                    printLine(`parentId:   ${expr.parentId ?? "null"}`)
                    printLine(`position:   ${expr.position}`)
                    if (expr.type === "variable") {
                        printLine(`variableId: ${expr.variableId}`)
                    }
                    if (expr.type === "operator") {
                        printLine(`operator:   ${expr.operator}`)
                    }
                }
            }
        )
}
