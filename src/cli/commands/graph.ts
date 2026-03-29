import { Command } from "commander"
import { hydrateEngine, hydratePropositCore } from "../engine.js"
import { isClaimBound, isPremiseBound } from "../../lib/schemata/index.js"
import type { TCorePropositionalVariable } from "../../lib/schemata/index.js"
import type {
    TCoreArgumentEvaluationResult,
    TCorePremiseEvaluationResult,
    TCoreTrivalentValue,
} from "../../lib/types/evaluation.js"
import type { ArgumentEngine } from "../../lib/core/argument-engine.js"
import type { PropositCore } from "../../lib/core/proposit-core.js"
import { printJson, printLine, errorExit } from "../output.js"
import {
    readAnalysis,
    resolveAnalysisFilename,
    analysisFileExists,
} from "../storage/analysis.js"
import { readVariables } from "../storage/variables.js"

function dotEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function shortId(id: string): string {
    return id.slice(0, 8)
}

function operatorLabel(op: string): string {
    switch (op) {
        case "not":
            return "NOT"
        case "and":
            return "AND"
        case "or":
            return "OR"
        case "implies":
            return "IMPLIES"
        case "iff":
            return "IFF"
        default:
            return op.toUpperCase()
    }
}

function truthColor(value: TCoreTrivalentValue): string {
    if (value === true) return "green3"
    if (value === false) return "red"
    return "gray70"
}

function truthFillColor(value: TCoreTrivalentValue): string {
    if (value === true) return '"#d4edda"'
    if (value === false) return '"#f8d7da"'
    return '"#e2e3e5"'
}

interface TEvaluationOverlay {
    result: TCoreArgumentEvaluationResult
    premiseResults: Map<string, TCorePremiseEvaluationResult>
    rejectedExpressionIds: Set<string>
}

export function buildDotGraph(
    engine: ArgumentEngine,
    core: PropositCore,
    overlay?: TEvaluationOverlay
): string {
    const lines: string[] = []
    const arg = engine.getArgument() as Record<string, unknown>
    const roles = engine.getRoleState()
    const conclusionId = roles.conclusionPremiseId
    const variables = engine.getVariables()

    const varMap = new Map<string, TCorePropositionalVariable>()
    for (const v of variables) {
        varMap.set(v.id, v as unknown as TCorePropositionalVariable)
    }

    const argTitle = typeof arg.title === "string" ? arg.title : "(untitled)"

    lines.push("digraph argument {")
    lines.push("  compound=true;")
    lines.push("  rankdir=TB;")

    // Build graph label with optional evaluation summary
    if (overlay) {
        const r = overlay.result
        const summaryParts: string[] = []
        if (r.isAdmissibleAssignment !== undefined)
            summaryParts.push(
                `admissible: ${r.isAdmissibleAssignment ?? "unknown"}`
            )
        if (r.isCounterexample !== undefined)
            summaryParts.push(
                `counterexample: ${r.isCounterexample ?? "unknown"}`
            )
        if (r.preservesTruthUnderAssignment !== undefined)
            summaryParts.push(
                `preserves truth: ${r.preservesTruthUnderAssignment ?? "unknown"}`
            )
        const subtitle = summaryParts.join(" | ")
        lines.push(`  label="${dotEscape(argTitle)}\\n${dotEscape(subtitle)}";`)
    } else {
        lines.push(`  label="${dotEscape(argTitle)}";`)
    }

    lines.push("  labelloc=t;")
    lines.push("  fontsize=16;")
    lines.push("")

    const premises = engine.listPremises()
    for (const pm of premises) {
        const pid = pm.getId()
        const isConclusion = pid === conclusionId
        const clusterName = `cluster_${shortId(pid)}`
        const displayStr = pm.toDisplayString() || "(empty)"
        const premiseData = pm.toPremiseData() as Record<string, unknown>
        const premiseTitle =
            typeof premiseData.title === "string" ? premiseData.title : ""
        const clusterLabel = premiseTitle
            ? `${dotEscape(premiseTitle)}\\n${dotEscape(displayStr)}`
            : dotEscape(displayStr)

        const premResult = overlay?.premiseResults.get(pid)

        lines.push(`  subgraph ${clusterName} {`)

        if (overlay && premResult?.rootValue !== undefined) {
            const borderColor = truthColor(premResult.rootValue)
            lines.push(`    label="${clusterLabel}";`)
            lines.push(`    style=bold;`)
            lines.push(`    color=${borderColor};`)
            lines.push(`    penwidth=2;`)
        } else if (isConclusion) {
            lines.push(`    label="${clusterLabel}  [CONCLUSION]";`)
            lines.push("    style=bold;")
            lines.push("    color=red;")
            lines.push("    penwidth=2;")
        } else {
            lines.push(`    label="${clusterLabel}";`)
            lines.push("    style=dashed;")
            lines.push("    color=gray40;")
        }

        const expressions = pm.getExpressions()

        if (expressions.length === 0) {
            lines.push(
                `    "${shortId(pid)}_empty" [label="(empty)" shape=plaintext];`
            )
        }

        for (const expr of expressions) {
            const nid = shortId(expr.id)
            let label: string
            let shape: string
            const attrs: string[] = []

            if (expr.type === "variable") {
                const v = varMap.get(expr.variableId)
                label = v ? v.symbol : "?"
                shape = "box"
            } else if (expr.type === "operator") {
                label = operatorLabel(expr.operator)
                shape = "diamond"
            } else {
                label = "()"
                shape = "ellipse"
            }

            attrs.push(`label="${dotEscape(label)}"`)
            attrs.push(`shape=${shape}`)

            // Evaluation overlay: color nodes by truth value
            if (overlay && premResult) {
                const exprValue = premResult.expressionValues[expr.id]
                if (exprValue !== undefined) {
                    attrs.push(`style=filled`)
                    attrs.push(`fillcolor=${truthFillColor(exprValue)}`)
                }
                if (overlay.rejectedExpressionIds.has(expr.id)) {
                    attrs.push(`peripheries=2`)
                    attrs.push(`color=red`)
                }
            }

            lines.push(`    "${nid}" [${attrs.join(" ")}];`)
        }

        // Parent-child edges within expression tree
        for (const expr of expressions) {
            if (expr.parentId !== null) {
                lines.push(
                    `    "${shortId(expr.parentId)}" -> "${shortId(expr.id)}";`
                )
            }
        }

        // Anchor node for cross-premise edge targeting
        lines.push(
            `    "${shortId(pid)}_anchor" [shape=point style=invis width=0];`
        )

        lines.push("  }")
        lines.push("")
    }

    // Variable definition nodes (outside clusters)
    for (const v of variables) {
        const typed = v as unknown as TCorePropositionalVariable
        let bindingLabel: string
        let fillColor: string

        if (isClaimBound(typed)) {
            const claim = core.claims.get(typed.claimId, typed.claimVersion)
            const claimTitle =
                claim &&
                typeof (claim as Record<string, unknown>).title === "string"
                    ? ((claim as Record<string, unknown>).title as string)
                    : `${typed.claimId.slice(0, 8)}@${typed.claimVersion}`
            bindingLabel = `${typed.symbol}\\n(claim: ${dotEscape(claimTitle)})`
            fillColor = "lightyellow"
        } else {
            bindingLabel = `${typed.symbol}\\n(premise-bound)`
            fillColor = "lightblue"
        }

        // Overlay: color variable node by assignment value
        if (overlay) {
            // Find variable value from any premise result
            let varValue: TCoreTrivalentValue | undefined
            for (const pr of overlay.premiseResults.values()) {
                if (pr.variableValues[v.id] !== undefined) {
                    varValue = pr.variableValues[v.id]
                    break
                }
            }
            if (varValue !== undefined) {
                fillColor = truthFillColor(varValue).replace(/"/g, "")
                bindingLabel += `\\n= ${varValue ?? "unknown"}`
            }
        }

        lines.push(
            `  "var_${shortId(v.id)}" [label="${bindingLabel}" shape=box style=filled fillcolor="${fillColor}"];`
        )
    }
    lines.push("")

    // Edges from variable expression nodes to variable definition nodes
    for (const pm of premises) {
        for (const expr of pm.getExpressions()) {
            if (expr.type === "variable") {
                lines.push(
                    `  "${shortId(expr.id)}" -> "var_${shortId(expr.variableId)}" [style=dotted arrowhead=none];`
                )
            }
        }
    }
    lines.push("")

    // Cross-premise edges for premise-bound variables
    const emittedPremiseBindings = new Set<string>()
    for (const v of variables) {
        const typed = v as unknown as TCorePropositionalVariable
        if (isPremiseBound(typed)) {
            const key = `${v.id}:${typed.boundPremiseId}`
            if (!emittedPremiseBindings.has(key)) {
                emittedPremiseBindings.add(key)
                lines.push(
                    `  "var_${shortId(v.id)}" -> "${shortId(typed.boundPremiseId)}_anchor" [style=bold color=blue label="${dotEscape(typed.symbol)}" lhead=cluster_${shortId(typed.boundPremiseId)}];`
                )
            }
        }
    }

    lines.push("}")
    return lines.join("\n")
}

export function registerGraphCommand(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    versionedCmd
        .command("graph")
        .description("Output a DOT (Graphviz) directed graph of the argument")
        .option("--json", "Output the DOT string as JSON")
        .option(
            "--analysis <filename>",
            "Overlay evaluation results from an analysis file"
        )
        .action(async (opts: { json?: boolean; analysis?: string }) => {
            const core = await hydratePropositCore()
            const engine = await hydrateEngine(argumentId, version, core)

            let overlay: TEvaluationOverlay | undefined

            if (opts.analysis) {
                const filename = resolveAnalysisFilename(opts.analysis)
                if (
                    !(await analysisFileExists(argumentId, version, filename))
                ) {
                    errorExit(`Analysis file "${filename}" does not exist.`)
                }

                const [analysisData, allVariables] = await Promise.all([
                    readAnalysis(argumentId, version, filename),
                    readVariables(argumentId, version),
                ])

                const symbolToId = new Map(
                    allVariables.map((v) => [v.symbol, v.id])
                )
                const variableAssignment: Record<string, boolean | null> = {}
                for (const [sym, val] of Object.entries(
                    analysisData.assignments
                )) {
                    const id = symbolToId.get(sym)
                    if (id !== undefined) variableAssignment[id] = val
                }

                const result = engine.evaluate(
                    {
                        variables: variableAssignment,
                        rejectedExpressionIds: [
                            ...analysisData.rejectedExpressionIds,
                        ],
                    },
                    {
                        includeExpressionValues: true,
                        includeDiagnostics: false,
                        validateFirst: false,
                    }
                )

                if (!result.ok) {
                    errorExit(
                        "Evaluation failed. Run 'analysis validate-argument' for details."
                    )
                }

                const premiseResults = new Map<
                    string,
                    TCorePremiseEvaluationResult
                >()
                if (result.conclusion)
                    premiseResults.set(
                        result.conclusion.premiseId,
                        result.conclusion
                    )
                for (const pr of result.supportingPremises ?? [])
                    premiseResults.set(pr.premiseId, pr)
                for (const pr of result.constraintPremises ?? [])
                    premiseResults.set(pr.premiseId, pr)

                overlay = {
                    result,
                    premiseResults,
                    rejectedExpressionIds: new Set(
                        analysisData.rejectedExpressionIds
                    ),
                }
            }

            const dot = buildDotGraph(engine, core, overlay)

            if (opts.json) {
                printJson({ dot })
            } else {
                printLine(dot)
            }
        })
}
