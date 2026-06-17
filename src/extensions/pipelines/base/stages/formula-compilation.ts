// `formula-compilation` — deterministic stage that compiles each
// `relation-extraction` output into a `parseFormula`-consumable
// formula string, and mints one dedicated "conclusion premise" whose
// formula is just the conclusion claim's variable symbol.
//
// Compilation rules (spec §7.3):
//   support           s         → t   ⇒  s_symbol IMPLIES t_symbol
//   joint-support     s1..sn    → t   ⇒  (s1 AND s2 AND ...) IMPLIES t_symbol
//   derivation-support s        → t   ⇒  s_symbol IMPLIES t_symbol
//
// The conclusion-premise mapping rule:
//   - When `conclusion-selection.conclusionMiniId` is non-null:
//     exactly one premise is minted with `roleHint: "conclusion"` and
//     `formula: <conclusion claim's variable symbol>`.
//   - When `conclusion-selection.conclusionMiniId` is null OR the
//     conclusion claim has no resolvable variable symbol:
//     `conclusionPremiseMiniId` is null and the conclusion premise is
//     not emitted. The relation premises are still emitted.
//
// We emit a `ProcessingFailure` (severity `error`) when a relation's
// `sources` or `target` cannot be resolved to a variable symbol. The
// failing relation's premise is dropped from the output (we can't
// compile it without symbols).

import {
    STAGE_IDS,
    FormulaCompilationOutputSchema,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TFormulaPremiseRoleHint,
    type TRelationExtractionOutput,
    type TVariableAssignmentOutput,
} from "./schemas.js"
import { deterministicStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"

export const FORMULA_COMPILATION_FAILURE_CODES = {
    unresolvedSource: "FORMULA_COMPILATION_SOURCE_UNRESOLVED",
    unresolvedTarget: "FORMULA_COMPILATION_TARGET_UNRESOLVED",
    unresolvedConclusion: "FORMULA_COMPILATION_CONCLUSION_UNRESOLVED",
    emptySources: "FORMULA_COMPILATION_SOURCES_EMPTY",
} as const

export type TCompileFormulasInput = {
    /** Bare relations array (unwrapped from the stage's envelope). */
    relations: TRelationExtractionOutput["relations"]
    conclusion: TConclusionSelectionOutput | undefined
    variables: TVariableAssignmentOutput
    generateId: () => string
    addFailure?: (failure: {
        code: string
        message: string
        severity: "warning" | "error"
        context?: Record<string, unknown>
    }) => void
}

function buildClaimToSymbol(
    variables: TVariableAssignmentOutput
): Map<string, string> {
    const m = new Map<string, string>()
    for (const v of variables) {
        m.set(v.claimMiniId, v.symbol)
    }
    return m
}

function relationToRoleHint(
    type: "support" | "joint-support" | "derivation-support"
): TFormulaPremiseRoleHint {
    switch (type) {
        case "support":
            return "support"
        case "joint-support":
            return "joint-support"
        case "derivation-support":
            return "derivation"
    }
}

/**
 * Pure helper exposed for direct testing.
 */
export function compileFormulas(
    input: TCompileFormulasInput
): TFormulaCompilationOutput {
    const claimToSymbol = buildClaimToSymbol(input.variables)
    const noopEmit: NonNullable<TCompileFormulasInput["addFailure"]> = () => {
        // intentionally empty — tests can supply addFailure to capture emits
    }
    const emit = input.addFailure ?? noopEmit

    const premises: TFormulaCompilationOutput["premises"] = []

    // Compile each relation into a premise.
    for (const relation of input.relations) {
        if (relation.sources.length === 0) {
            emit({
                code: FORMULA_COMPILATION_FAILURE_CODES.emptySources,
                message: `Relation "${relation.relationId}" has no sources; cannot compile.`,
                severity: "warning",
                context: { relationId: relation.relationId },
            })
            continue
        }
        const targetSymbol = claimToSymbol.get(relation.target)
        if (!targetSymbol) {
            emit({
                code: FORMULA_COMPILATION_FAILURE_CODES.unresolvedTarget,
                message: `Relation "${relation.relationId}" target claim "${relation.target}" has no variable assignment; dropping.`,
                severity: "error",
                context: {
                    relationId: relation.relationId,
                    targetClaimMiniId: relation.target,
                },
            })
            continue
        }
        const sourceSymbols: string[] = []
        let sourcesOk = true
        for (const src of relation.sources) {
            const sym = claimToSymbol.get(src)
            if (!sym) {
                emit({
                    code: FORMULA_COMPILATION_FAILURE_CODES.unresolvedSource,
                    message: `Relation "${relation.relationId}" source claim "${src}" has no variable assignment; dropping.`,
                    severity: "error",
                    context: {
                        relationId: relation.relationId,
                        sourceClaimMiniId: src,
                    },
                })
                sourcesOk = false
                break
            }
            sourceSymbols.push(sym)
        }
        if (!sourcesOk) continue

        let formula: string
        if (relation.type === "joint-support" && sourceSymbols.length > 1) {
            formula = `(${sourceSymbols.join(" and ")}) implies ${targetSymbol}`
        } else if (sourceSymbols.length === 1) {
            formula = `${sourceSymbols[0]} implies ${targetSymbol}`
        } else {
            // joint-support with exactly one source — degenerate; still
            // compile as a plain support implication (the parens would
            // be redundant). joint-support with zero sources is caught
            // by the emptySources guard above.
            formula = `${sourceSymbols.join(" and ")} implies ${targetSymbol}`
        }

        premises.push({
            premiseMiniId: input.generateId(),
            formula,
            roleHint: relationToRoleHint(relation.type),
            sourceRelationId: relation.relationId,
        })
    }

    // Mint the conclusion premise iff conclusion-selection chose a
    // claim AND the claim resolves to a known variable symbol.
    let conclusionPremiseMiniId: string | null = null
    const conclusionClaimMiniId = input.conclusion?.conclusionMiniId ?? null
    if (conclusionClaimMiniId !== null) {
        const conclusionSymbol = claimToSymbol.get(conclusionClaimMiniId)
        if (!conclusionSymbol) {
            emit({
                code: FORMULA_COMPILATION_FAILURE_CODES.unresolvedConclusion,
                message: `Conclusion claim "${conclusionClaimMiniId}" has no variable assignment; cannot mint conclusion premise.`,
                severity: "error",
                context: { conclusionClaimMiniId },
            })
        } else {
            const id = input.generateId()
            premises.push({
                premiseMiniId: id,
                formula: conclusionSymbol,
                roleHint: "conclusion",
                sourceRelationId: null,
            })
            conclusionPremiseMiniId = id
        }
    }

    return { premises, conclusionPremiseMiniId }
}

export const formulaCompilationStage: TStage<TFormulaCompilationOutput> =
    deterministicStage<TFormulaCompilationOutput>({
        id: STAGE_IDS.formulaCompilation,
        dependsOn: [
            STAGE_IDS.relationExtraction,
            STAGE_IDS.conclusionSelection,
            STAGE_IDS.variableAssignment,
            STAGE_IDS.claimTypeClassification,
        ],
        outputSchema: FormulaCompilationOutputSchema,
        fn: (ctx: TStageContext) => {
            const relationEnvelope = ctx.get<TRelationExtractionOutput>(
                STAGE_IDS.relationExtraction
            )
            const relations = relationEnvelope?.relations ?? []
            const conclusion = ctx.get<TConclusionSelectionOutput>(
                STAGE_IDS.conclusionSelection
            )
            const variables =
                ctx.get<TVariableAssignmentOutput>(
                    STAGE_IDS.variableAssignment
                ) ?? []
            return compileFormulas({
                relations,
                conclusion,
                variables,
                generateId: ctx.generateId,
                addFailure: ctx.addFailure,
            })
        },
    })
