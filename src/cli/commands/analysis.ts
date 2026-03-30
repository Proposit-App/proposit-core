import { Command } from "commander"
import { hydrateEngine } from "../engine.js"
import {
    errorExit,
    printJson,
    printLine,
    requireConfirmation,
} from "../output.js"
import {
    analysisFileExists,
    deleteAnalysisFile,
    listAnalysisFiles,
    nextAnalysisFilename,
    readAnalysis,
    resolveAnalysisFilename,
    writeAnalysis,
} from "../storage/analysis.js"
import { listPremiseIds, readPremiseData } from "../storage/premises.js"
import { readVariables } from "../storage/variables.js"

export function registerAnalysisCommands(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    const analysis = versionedCmd
        .command("analysis")
        .description("Manage and run analyses")

    analysis
        .command("create [analysis_filename]")
        .description(
            "Create a new analysis file initialised with all variables"
        )
        .option(
            "--default <value>",
            "Default value for all assignments (true, false, or unset)",
            "unset"
        )
        .option(
            "--from <filename>",
            "Copy assignments and operator states from an existing analysis file"
        )
        .action(
            async (
                filenameArg: string | undefined,
                opts: { default: string; from?: string }
            ) => {
                const filename = filenameArg
                    ? await resolveAnalysisFilename(
                          filenameArg,
                          argumentId,
                          version
                      )
                    : await nextAnalysisFilename(argumentId, version)
                if (await analysisFileExists(argumentId, version, filename)) {
                    errorExit(`Analysis file "${filename}" already exists.`)
                }

                if (opts.from) {
                    const sourceFile = await resolveAnalysisFilename(
                        opts.from,
                        argumentId,
                        version
                    )
                    if (
                        !(await analysisFileExists(
                            argumentId,
                            version,
                            sourceFile
                        ))
                    ) {
                        errorExit(
                            `Source analysis file "${sourceFile}" does not exist.`
                        )
                    }
                    const source = await readAnalysis(
                        argumentId,
                        version,
                        sourceFile
                    )
                    await writeAnalysis(argumentId, version, filename, {
                        argumentId,
                        argumentVersion: version,
                        assignments: { ...source.assignments },
                        operatorAssignments: { ...source.operatorAssignments },
                    })
                    printLine(filename)
                    return
                }

                if (!["true", "false", "unset"].includes(opts.default)) {
                    errorExit(
                        `Default must be "true", "false", or "unset", got "${opts.default}".`
                    )
                }
                const defaultValue =
                    opts.default === "true"
                        ? true
                        : opts.default === "false"
                          ? false
                          : null
                const variables = await readVariables(argumentId, version)
                const assignments: Record<string, boolean | null> = {}
                for (const v of variables) {
                    assignments[v.symbol] = defaultValue
                }

                await writeAnalysis(argumentId, version, filename, {
                    argumentId,
                    argumentVersion: version,
                    assignments,
                    operatorAssignments: {},
                })
                printLine(filename)
            }
        )

    analysis
        .command("list")
        .description("List analysis files in this argument version")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const files = await listAnalysisFiles(argumentId, version)
            if (opts.json) {
                printJson(files)
            } else {
                for (const f of files) printLine(f)
            }
        })

    analysis
        .command("show")
        .description("Show variable assignments in an analysis file")
        .option("--file <filename>", "Analysis filename (default: latest)")
        .option("--json", "Output as JSON")
        .action(async (opts: { file?: string; json?: boolean }) => {
            const filename = await resolveAnalysisFilename(
                opts.file,
                argumentId,
                version
            )
            const data = await readAnalysis(argumentId, version, filename)
            if (opts.json) {
                printJson(data)
            } else {
                const sorted = Object.entries(data.assignments).sort(
                    ([a], [b]) => a.localeCompare(b)
                )
                for (const [symbol, value] of sorted) {
                    printLine(`${symbol} = ${value ?? "unset"}`)
                }
                const opEntries = Object.entries(data.operatorAssignments)
                if (opEntries.length > 0) {
                    printLine("")
                    printLine("Operator assignments:")
                    for (const [id, state] of opEntries) {
                        printLine(`  ${id} = ${state}`)
                    }
                }
            }
        })

    analysis
        .command("set <variable_symbol> <value>")
        .description(
            "Update a single variable assignment (value: true, false, or unset)"
        )
        .option("--file <filename>", "Analysis filename (default: latest)")
        .action(
            async (
                symbol: string,
                valueArg: string,
                opts: { file?: string }
            ) => {
                const filename = await resolveAnalysisFilename(
                    opts.file,
                    argumentId,
                    version
                )
                if (
                    !(await analysisFileExists(argumentId, version, filename))
                ) {
                    errorExit(`Analysis file "${filename}" does not exist.`)
                }

                const variables = await readVariables(argumentId, version)
                if (!variables.some((v) => v.symbol === symbol)) {
                    errorExit(
                        `Variable symbol "${symbol}" is not defined in this argument version.`
                    )
                }

                const parsedValue =
                    valueArg === "true"
                        ? true
                        : valueArg === "false"
                          ? false
                          : valueArg === "unset"
                            ? null
                            : errorExit(
                                  `Value must be "true", "false", or "unset", got "${valueArg}".`
                              )

                const data = await readAnalysis(argumentId, version, filename)
                data.assignments[symbol] = parsedValue
                await writeAnalysis(argumentId, version, filename, data)
                printLine("success")
            }
        )

    analysis
        .command("reset")
        .description("Reset all assignments in an analysis file to one value")
        .option("--file <filename>", "Analysis filename (default: latest)")
        .option(
            "--value <value>",
            "Value to reset to (default: unset)",
            "unset"
        )
        .action(async (opts: { file?: string; value: string }) => {
            const filename = await resolveAnalysisFilename(
                opts.file,
                argumentId,
                version
            )
            if (!["true", "false", "unset"].includes(opts.value)) {
                errorExit(
                    `Value must be "true", "false", or "unset", got "${opts.value}".`
                )
            }
            const resetValue =
                opts.value === "true"
                    ? true
                    : opts.value === "false"
                      ? false
                      : null
            const data = await readAnalysis(argumentId, version, filename)
            for (const symbol of Object.keys(data.assignments)) {
                data.assignments[symbol] = resetValue
            }
            await writeAnalysis(argumentId, version, filename, data)
            printLine("success")
        })

    analysis
        .command("set-operator <operator_expression_id> <state>")
        .description("Set an operator's state (accepted, rejected, or unset)")
        .option("--file <filename>", "Analysis filename (default: latest)")
        .action(
            async (
                operatorExpressionId: string,
                state: string,
                opts: { file?: string }
            ) => {
                if (!["accepted", "rejected", "unset"].includes(state)) {
                    errorExit(
                        `State must be "accepted", "rejected", or "unset", got "${state}".`
                    )
                }
                const filename = await resolveAnalysisFilename(
                    opts.file,
                    argumentId,
                    version
                )
                if (
                    !(await analysisFileExists(argumentId, version, filename))
                ) {
                    errorExit(`Analysis file "${filename}" does not exist.`)
                }
                const data = await readAnalysis(argumentId, version, filename)
                if (state === "unset") {
                    delete data.operatorAssignments[operatorExpressionId]
                } else {
                    data.operatorAssignments[operatorExpressionId] = state as
                        | "accepted"
                        | "rejected"
                }
                await writeAnalysis(argumentId, version, filename, data)
                printLine("success")
            }
        )

    analysis
        .command("set-all-operators <state>")
        .description(
            "Set all operator expressions to a state (accepted, rejected, or unset)"
        )
        .option("--file <filename>", "Analysis filename (default: latest)")
        .action(async (state: string, opts: { file?: string }) => {
            if (!["accepted", "rejected", "unset"].includes(state)) {
                errorExit(
                    `State must be "accepted", "rejected", or "unset", got "${state}".`
                )
            }
            const filename = await resolveAnalysisFilename(
                opts.file,
                argumentId,
                version
            )
            if (!(await analysisFileExists(argumentId, version, filename))) {
                errorExit(`Analysis file "${filename}" does not exist.`)
            }
            const data = await readAnalysis(argumentId, version, filename)
            if (state === "unset") {
                data.operatorAssignments = {}
            } else {
                const premiseIds = await listPremiseIds(argumentId, version)
                for (const pid of premiseIds) {
                    const premiseData = await readPremiseData(
                        argumentId,
                        version,
                        pid
                    )
                    for (const expr of premiseData.expressions) {
                        if (expr.type === "operator") {
                            data.operatorAssignments[expr.id] = state as
                                | "accepted"
                                | "rejected"
                        }
                    }
                }
            }
            await writeAnalysis(argumentId, version, filename, data)
            const count = Object.keys(data.operatorAssignments).length
            printLine(
                state === "unset"
                    ? "All operator assignments cleared"
                    : `${count} operator(s) set to ${state}`
            )
        })

    analysis
        .command("validate-assignments")
        .description("Validate an analysis file against the argument version")
        .option("--file <filename>", "Analysis filename (default: latest)")
        .option("--json", "Output as JSON")
        .action(async (opts: { file?: string; json?: boolean }) => {
            const filename = await resolveAnalysisFilename(
                opts.file,
                argumentId,
                version
            )
            const [data, variables] = await Promise.all([
                readAnalysis(argumentId, version, filename),
                readVariables(argumentId, version),
            ])

            const issues: { code: string; message: string }[] = []

            if (data.argumentId !== argumentId) {
                issues.push({
                    code: "ARGUMENT_ID_MISMATCH",
                    message: `File argumentId "${data.argumentId}" does not match "${argumentId}".`,
                })
            }
            if (data.argumentVersion !== version) {
                issues.push({
                    code: "ARGUMENT_VERSION_MISMATCH",
                    message: `File argumentVersion ${data.argumentVersion} does not match ${version}.`,
                })
            }

            const knownSymbols = new Set(variables.map((v) => v.symbol))
            const fileSymbols = new Set(Object.keys(data.assignments))

            for (const sym of knownSymbols) {
                if (!fileSymbols.has(sym)) {
                    issues.push({
                        code: "MISSING_SYMBOL",
                        message: `Variable symbol "${sym}" is missing from assignments.`,
                    })
                }
            }
            for (const sym of fileSymbols) {
                if (!knownSymbols.has(sym)) {
                    issues.push({
                        code: "UNKNOWN_SYMBOL",
                        message: `Assignment symbol "${sym}" is not defined in this argument version.`,
                    })
                }
            }

            // Validate operator assignment IDs
            const opAssignmentIds = Object.keys(data.operatorAssignments)
            if (opAssignmentIds.length > 0) {
                const engine = await hydrateEngine(argumentId, version)
                const allExpressionIds = new Set(
                    engine
                        .listPremises()
                        .flatMap((pm) => pm.getExpressions().map((e) => e.id))
                )
                for (const id of opAssignmentIds) {
                    if (!allExpressionIds.has(id)) {
                        issues.push({
                            code: "UNKNOWN_OPERATOR_ASSIGNMENT",
                            message: `Operator assignment ID "${id}" does not exist in any premise.`,
                        })
                    }
                }
            }

            const ok = issues.length === 0

            if (opts.json) {
                printJson({ ok, issues })
            } else {
                printLine(ok ? "ok" : "invalid")
                for (const issue of issues) {
                    printLine(`${issue.code}: ${issue.message}`)
                }
            }
        })

    analysis
        .command("delete")
        .description("Delete an analysis file")
        .option("--file <filename>", "Analysis filename (default: latest)")
        .option("--confirm", "Skip confirmation prompt")
        .action(async (opts: { file?: string; confirm?: boolean }) => {
            const filename = await resolveAnalysisFilename(
                opts.file,
                argumentId,
                version
            )
            if (!(await analysisFileExists(argumentId, version, filename))) {
                errorExit(`Analysis file "${filename}" does not exist.`)
            }
            if (!opts.confirm) {
                await requireConfirmation(`Delete analysis file "${filename}"?`)
            }
            await deleteAnalysisFile(argumentId, version, filename)
            printLine("success")
        })

    analysis
        .command("evaluate")
        .description(
            "Evaluate the argument using assignments from an analysis file"
        )
        .option("--file <filename>", "Analysis filename (default: latest)")
        .option(
            "--strict-unknown-assignment-keys",
            "Reject extra assignment keys"
        )
        .option("--no-expression-values", "Omit per-expression truth values")
        .option("--no-diagnostics", "Omit inference diagnostics")
        .option("--no-validate-first", "Skip evaluability validation")
        .option(
            "--skip-analysis-file-validation",
            "Skip analysis file validation"
        )
        .option("--json", "Output as JSON")
        .action(
            async (opts: {
                file?: string
                strictUnknownAssignmentKeys?: boolean
                noExpressionValues?: boolean
                noDiagnostics?: boolean
                noValidateFirst?: boolean
                skipAnalysisFileValidation?: boolean
                json?: boolean
            }) => {
                const filename = await resolveAnalysisFilename(
                    opts.file,
                    argumentId,
                    version
                )
                const [analysisData, variables] = await Promise.all([
                    readAnalysis(argumentId, version, filename),
                    readVariables(argumentId, version),
                ])

                // Validate analysis file unless skipped
                if (!opts.skipAnalysisFileValidation) {
                    const knownSymbols = new Set(variables.map((v) => v.symbol))
                    const fileSymbols = Object.keys(analysisData.assignments)
                    const missing = fileSymbols.filter(
                        (s) => !knownSymbols.has(s)
                    )
                    const extra = Array.from(knownSymbols).filter(
                        (s) => !analysisData.assignments.hasOwnProperty(s)
                    )
                    if (
                        analysisData.argumentId !== argumentId ||
                        analysisData.argumentVersion !== version ||
                        missing.length > 0 ||
                        extra.length > 0
                    ) {
                        errorExit(
                            "Analysis file validation failed. Use --skip-analysis-file-validation to bypass or run validate-assignments for details."
                        )
                    }
                }

                // Build symbol-to-ID map and resolve assignment
                const symbolToId = new Map(
                    variables.map((v) => [v.symbol, v.id])
                )
                const variableAssignment: Record<string, boolean | null> = {}
                for (const [sym, val] of Object.entries(
                    analysisData.assignments
                )) {
                    const id = symbolToId.get(sym)
                    if (id !== undefined) variableAssignment[id] = val
                }

                const engine = await hydrateEngine(argumentId, version)
                const result = engine.evaluate(
                    {
                        variables: variableAssignment,
                        operatorAssignments: {
                            ...analysisData.operatorAssignments,
                        },
                    },
                    {
                        strictUnknownAssignmentKeys:
                            opts.strictUnknownAssignmentKeys ?? false,
                        includeExpressionValues: !opts.noExpressionValues,
                        includeDiagnostics: !opts.noDiagnostics,
                        validateFirst: !opts.noValidateFirst,
                    }
                )

                if (opts.json) {
                    printJson(result)
                    return
                }

                if (!result.ok) {
                    printLine("Evaluation failed:")
                    for (const issue of result.validation?.issues ?? []) {
                        printLine(
                            `  ${issue.severity} ${issue.code}: ${issue.message}`
                        )
                    }
                    return
                }

                printLine(`admissible:        ${result.isAdmissibleAssignment}`)
                printLine(
                    `all supporting:    ${result.allSupportingPremisesTrue}`
                )
                printLine(`conclusion true:   ${result.conclusionTrue}`)
                printLine(`counterexample:    ${result.isCounterexample}`)
            }
        )

    analysis
        .command("check-validity")
        .description("Run truth-table validity checking")
        .option(
            "--mode <mode>",
            "first-counterexample or exhaustive",
            "first-counterexample"
        )
        .option("--max-variables <n>", "Maximum number of variables")
        .option("--max-assignments-checked <n>", "Maximum assignments to check")
        .option(
            "--include-counterexample-evaluations",
            "Include full evaluation payloads for counterexamples"
        )
        .option("--no-validate-first", "Skip evaluability validation")
        .option("--json", "Output as JSON")
        .action(
            async (opts: {
                mode: string
                maxVariables?: string
                maxAssignmentsChecked?: string
                includeCounterexampleEvaluations?: boolean
                noValidateFirst?: boolean
                json?: boolean
            }) => {
                const engine = await hydrateEngine(argumentId, version)
                const result = engine.checkValidity({
                    mode:
                        opts.mode === "exhaustive"
                            ? "exhaustive"
                            : "firstCounterexample",
                    maxVariables:
                        opts.maxVariables !== undefined
                            ? Number(opts.maxVariables)
                            : undefined,
                    maxAssignmentsChecked:
                        opts.maxAssignmentsChecked !== undefined
                            ? Number(opts.maxAssignmentsChecked)
                            : undefined,
                    includeCounterexampleEvaluations:
                        opts.includeCounterexampleEvaluations ?? false,
                    validateFirst: !opts.noValidateFirst,
                })

                if (opts.json) {
                    printJson(result)
                    return
                }

                if (!result.ok) {
                    printLine("Validity check failed:")
                    for (const issue of result.validation?.issues ?? []) {
                        printLine(
                            `  ${issue.severity} ${issue.code}: ${issue.message}`
                        )
                    }
                    return
                }

                const validity =
                    result.isValid === true
                        ? "valid"
                        : result.isValid === false
                          ? "invalid"
                          : "unknown (truncated)"

                printLine(`isValid:              ${validity}`)
                printLine(`truncated:            ${result.truncated}`)
                printLine(
                    `assignments checked:  ${result.numAssignmentsChecked}`
                )
                printLine(
                    `admissible:           ${result.numAdmissibleAssignments}`
                )
                printLine(
                    `counterexamples:      ${result.counterexamples?.length ?? 0}`
                )

                if ((result.counterexamples?.length ?? 0) > 0) {
                    printLine("counterexample assignments:")
                    for (const ce of result.counterexamples!) {
                        printLine("  " + JSON.stringify(ce.assignment))
                    }
                }
            }
        )

    analysis
        .command("validate-argument")
        .description("Validate the argument structure for evaluability")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const result = engine.validateEvaluability()

            if (opts.json) {
                printJson(result)
                return
            }

            printLine(result.ok ? "ok" : "invalid")
            for (const issue of result.issues) {
                printLine(`${issue.severity} ${issue.code}: ${issue.message}`)
            }
        })

    analysis
        .command("refs")
        .description("Show variables referenced across all premises")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const refs = engine.collectReferencedVariables()

            if (opts.json) {
                printJson(refs)
                return
            }

            for (const variableId of refs.variableIds) {
                const info = refs.byId[variableId]
                printLine(
                    `${variableId} | ${info.symbol} | premises: [${info.premiseIds.join(", ")}]`
                )
            }
        })

    analysis
        .command("operators")
        .description("List all operator expressions across all premises")
        .option("--json", "Output as JSON")
        .option(
            "--file <filename>",
            "Show operator states from an analysis file"
        )
        .action(async (opts: { json?: boolean; file?: string }) => {
            const engine = await hydrateEngine(argumentId, version)
            const premises = engine.listPremises()
            const operators: {
                expressionId: string
                operator: string
                premiseId: string
                formula: string
            }[] = []

            for (const pm of premises) {
                const premiseId = pm.getId()
                const formula = pm.toDisplayString() || "(empty)"
                for (const expr of pm.getExpressions()) {
                    if (expr.type === "operator") {
                        operators.push({
                            expressionId: expr.id,
                            operator: (
                                expr as { operator: string } & typeof expr
                            ).operator,
                            premiseId,
                            formula,
                        })
                    }
                }
            }

            let opAssignments: Record<string, string> = {}
            if (opts.file) {
                const filename = await resolveAnalysisFilename(
                    opts.file,
                    argumentId,
                    version
                )
                if (await analysisFileExists(argumentId, version, filename)) {
                    const analysisData = await readAnalysis(
                        argumentId,
                        version,
                        filename
                    )
                    opAssignments = analysisData.operatorAssignments
                }
            }

            if (opts.json) {
                printJson(
                    operators.map((op) => ({
                        ...op,
                        state: opAssignments[op.expressionId] ?? "unset",
                    }))
                )
                return
            }

            if (operators.length === 0) {
                printLine("No operator expressions found.")
                return
            }

            let currentPremise = ""
            for (const op of operators) {
                if (op.premiseId !== currentPremise) {
                    if (currentPremise !== "") printLine("")
                    currentPremise = op.premiseId
                    printLine(`Premise ${op.premiseId}:  ${op.formula}`)
                }
                const state = opAssignments[op.expressionId] ?? "unset"
                printLine(`  ${op.expressionId} | ${op.operator} | ${state}`)
            }
        })

    analysis
        .command("export")
        .description("Export the full argument engine state snapshot")
        .option("--json", "Output as JSON")
        .action(async (_opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            printJson(engine.snapshot())
        })
}
