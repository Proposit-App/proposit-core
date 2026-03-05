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
    readAnalysis,
    resolveAnalysisFilename,
    writeAnalysis,
} from "../storage/analysis.js"
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
        .action(
            async (
                filenameArg: string | undefined,
                opts: { default: string }
            ) => {
                const filename = resolveAnalysisFilename(filenameArg)
                if (await analysisFileExists(argumentId, version, filename)) {
                    errorExit(`Analysis file "${filename}" already exists.`)
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
                    rejectedExpressionIds: [],
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
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .option("--json", "Output as JSON")
        .action(async (opts: { file?: string; json?: boolean }) => {
            const filename = resolveAnalysisFilename(opts.file)
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
                if (data.rejectedExpressionIds.length > 0) {
                    printLine("")
                    printLine("Rejected expressions:")
                    for (const id of data.rejectedExpressionIds) {
                        printLine(`  ${id}`)
                    }
                }
            }
        })

    analysis
        .command("set <variable_symbol> <value>")
        .description(
            "Update a single variable assignment (value: true, false, or unset)"
        )
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .action(
            async (
                symbol: string,
                valueArg: string,
                opts: { file?: string }
            ) => {
                const filename = resolveAnalysisFilename(opts.file)
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
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .option(
            "--value <value>",
            "Value to reset to (default: unset)",
            "unset"
        )
        .action(async (opts: { file?: string; value: string }) => {
            const filename = resolveAnalysisFilename(opts.file)
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
        .command("reject <expression_id>")
        .description("Reject an expression (it will evaluate to false)")
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .action(async (expressionId: string, opts: { file?: string }) => {
            const filename = resolveAnalysisFilename(opts.file)
            if (!(await analysisFileExists(argumentId, version, filename))) {
                errorExit(`Analysis file "${filename}" does not exist.`)
            }
            const data = await readAnalysis(argumentId, version, filename)
            if (!data.rejectedExpressionIds.includes(expressionId)) {
                data.rejectedExpressionIds.push(expressionId)
            }
            await writeAnalysis(argumentId, version, filename, data)
            printLine("success")
        })

    analysis
        .command("accept <expression_id>")
        .description("Accept an expression (restore normal computation)")
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .action(async (expressionId: string, opts: { file?: string }) => {
            const filename = resolveAnalysisFilename(opts.file)
            if (!(await analysisFileExists(argumentId, version, filename))) {
                errorExit(`Analysis file "${filename}" does not exist.`)
            }
            const data = await readAnalysis(argumentId, version, filename)
            data.rejectedExpressionIds = data.rejectedExpressionIds.filter(
                (id) => id !== expressionId
            )
            await writeAnalysis(argumentId, version, filename, data)
            printLine("success")
        })

    analysis
        .command("validate-assignments")
        .description("Validate an analysis file against the argument version")
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .option("--json", "Output as JSON")
        .action(async (opts: { file?: string; json?: boolean }) => {
            const filename = resolveAnalysisFilename(opts.file)
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

            // Validate rejected expression IDs
            if (data.rejectedExpressionIds.length > 0) {
                const engine = await hydrateEngine(argumentId, version)
                const allExpressionIds = new Set(
                    engine
                        .listPremises()
                        .flatMap((pm) => pm.getExpressions().map((e) => e.id))
                )
                for (const id of data.rejectedExpressionIds) {
                    if (!allExpressionIds.has(id)) {
                        issues.push({
                            code: "UNKNOWN_REJECTED_EXPRESSION",
                            message: `Rejected expression ID "${id}" does not exist in any premise.`,
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
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
        .option("--confirm", "Skip confirmation prompt")
        .action(async (opts: { file?: string; confirm?: boolean }) => {
            const filename = resolveAnalysisFilename(opts.file)
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
        .option(
            "--file <filename>",
            "Analysis filename (default: analysis.json)"
        )
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
                const filename = resolveAnalysisFilename(opts.file)
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
                        rejectedExpressionIds: [
                            ...analysisData.rejectedExpressionIds,
                        ],
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
        .command("export")
        .description("Export the full argument engine state snapshot")
        .option("--json", "Output as JSON")
        .action(async (_opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            printJson(engine.snapshot())
        })
}
