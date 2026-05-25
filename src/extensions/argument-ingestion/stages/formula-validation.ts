// `formula-validation` — deterministic stage that re-parses every
// compiled formula via `parseFormula` and verifies each referenced atom
// resolves to a known variable symbol (from `variable-assignment`).
//
// Emits:
//   - FORMULA_PARSE_ERROR — `parseFormula(formula)` threw.
//   - FORMULA_SYMBOL_UNRESOLVED — a parsed atom is not among the known
//     variable symbols.
//
// Doesn't gate downstream — `finalize` consumes `formula-compilation`'s
// premises directly. This stage is observational.

import { parseFormula } from "../../../lib/core/parser/formula.js"
import type { TFormulaAST } from "../../../lib/core/parser/formula.js"
import {
    STAGE_IDS,
    ValidationStageOutputSchema,
    type TFormulaCompilationOutput,
    type TValidationStageOutput,
    type TVariableAssignmentOutput,
} from "./schemas.js"
import { deterministicStage } from "../../../lib/pipelines/stage-helpers.js"
import type { TStage } from "../../../lib/pipelines/types.js"

export const FORMULA_VALIDATION_FAILURE_CODES = {
    parseError: "FORMULA_PARSE_ERROR",
    symbolUnresolved: "FORMULA_SYMBOL_UNRESOLVED",
} as const

function collectAtoms(ast: TFormulaAST, out: Set<string>): void {
    switch (ast.type) {
        case "variable":
            out.add(ast.name)
            return
        case "not":
            collectAtoms(ast.operand, out)
            return
        case "and":
        case "or":
            for (const child of ast.operands) collectAtoms(child, out)
            return
        case "implies":
        case "iff":
            collectAtoms(ast.left, out)
            collectAtoms(ast.right, out)
            return
    }
}

export type TValidateFormulasInput = {
    compilation: TFormulaCompilationOutput | undefined
    variables: TVariableAssignmentOutput
}

export function validateFormulas(input: TValidateFormulasInput): {
    failures: Array<{
        code: string
        message: string
        context: Record<string, unknown>
    }>
} {
    const failures: Array<{
        code: string
        message: string
        context: Record<string, unknown>
    }> = []
    const knownSymbols = new Set(input.variables.map((v) => v.symbol))
    if (!input.compilation) return { failures }

    for (const premise of input.compilation.premises) {
        let ast: TFormulaAST
        try {
            ast = parseFormula(premise.formula)
        } catch (err) {
            failures.push({
                code: FORMULA_VALIDATION_FAILURE_CODES.parseError,
                message: `parseFormula failed on premise "${premise.premiseMiniId}": ${
                    err instanceof Error ? err.message : String(err)
                }`,
                context: {
                    premiseMiniId: premise.premiseMiniId,
                    formula: premise.formula,
                },
            })
            continue
        }
        const atoms = new Set<string>()
        collectAtoms(ast, atoms)
        for (const atom of atoms) {
            if (!knownSymbols.has(atom)) {
                failures.push({
                    code: FORMULA_VALIDATION_FAILURE_CODES.symbolUnresolved,
                    message: `Premise "${premise.premiseMiniId}" references symbol "${atom}" which is not in variable-assignment.`,
                    context: {
                        premiseMiniId: premise.premiseMiniId,
                        formula: premise.formula,
                        unresolvedSymbol: atom,
                    },
                })
            }
        }
    }
    return { failures }
}

export const formulaValidationStage: TStage<TValidationStageOutput> =
    deterministicStage<TValidationStageOutput>({
        id: STAGE_IDS.formulaValidation,
        dependsOn: [
            STAGE_IDS.formulaCompilation,
            STAGE_IDS.variableAssignment,
        ],
        outputSchema: ValidationStageOutputSchema,
        fn: (ctx) => {
            const compilation = ctx.get<TFormulaCompilationOutput>(
                STAGE_IDS.formulaCompilation
            )
            const variables =
                ctx.get<TVariableAssignmentOutput>(
                    STAGE_IDS.variableAssignment
                ) ?? []
            const { failures } = validateFormulas({ compilation, variables })
            for (const f of failures) {
                ctx.addFailure({
                    code: f.code,
                    message: f.message,
                    severity: "warning",
                    context: f.context,
                })
            }
            return failures.map((f) => ({
                code: f.code,
                message: f.message,
                context: f.context,
            }))
        },
    })
