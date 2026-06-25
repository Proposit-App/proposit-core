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
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TFormulaPremiseRoleHint,
    type TRelation,
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

// Claim types that may only back a derivation premise — never a freeform
// (support / joint-support) premise. A relation whose source carries one
// of these types is rerouted to a derivation premise; if it can't be, the
// relation is dropped.
const DERIVATION_ONLY_SOURCE_CLAIM_TYPES = new Set<
    TClaimTypeClassificationEntry["type"]
>(["citation", "axiomatic"])

export const RELATION_PLACEMENT_FAILURE_CODES = {
    droppedNoncompliantRelation: "RELATION_PLACEMENT_DROPPED_NONCOMPLIANT",
} as const

type TAddFailure = NonNullable<TCompileFormulasInput["addFailure"]>

/**
 * Resolve each claim's effective type into a `miniId → type` map,
 * preferring the `claim-type-classification` entry and falling back to
 * the canonicalizer's drafted `type` when the classifier omitted a
 * claim. This matches `finalizeResponseV2`'s `classification ?? c.type`
 * resolution so the relation pre-pass and finalize never disagree on
 * whether a claim is a citation/axiomatic — a disagreement would let a
 * citation slip into a freeform premise.
 */
export function resolveClaimTypes(input: {
    classifications: TClaimTypeClassificationEntry[]
    canonicalClaims: {
        miniId: string
        type: TClaimTypeClassificationEntry["type"]
    }[]
}): Map<string, TClaimTypeClassificationEntry["type"]> {
    const byMiniId = new Map<string, TClaimTypeClassificationEntry["type"]>()
    for (const claim of input.canonicalClaims) {
        byMiniId.set(claim.miniId, claim.type)
    }
    for (const entry of input.classifications) {
        byMiniId.set(entry.miniId, entry.type)
    }
    return byMiniId
}

/**
 * Keep citation/axiomatic claims out of freeform premises: a
 * `citation`/`axiomatic` claim may only sit in a derivation premise's
 * antecedent (grammar rules D-4 / D-5), never in a `support` /
 * `joint-support` (freeform) premise.
 *
 * A single-source freeform relation whose source is such a claim is
 * relabeled to `derivation-support` — its antecedent is the lone typed
 * claim, a valid derivation antecedent. A multi-source freeform relation
 * with a derivation-only source cannot be made compliant: a derivation
 * antecedent admits only a single claim variable (or an OR of
 * same-grounding variables), not an AND across mixed grounding, so there
 * is no compliant single premise to reroute it to. Such a relation is
 * dropped and recorded as a warning rather than emitted — a single bad
 * relation degrades to "premise omitted", never to a failed import.
 *
 * This runs as a deterministic pre-pass *before* `compileFormulas`,
 * which has no claim-type map. The claim-type map (`typeByClaimMiniId`)
 * is the input that lets this pass decide placement.
 */
export function rerouteDerivationOnlyRelations(input: {
    relations: TRelation[]
    typeByClaimMiniId: Map<string, TClaimTypeClassificationEntry["type"]>
    addFailure?: TAddFailure
}): TRelation[] {
    const emit = input.addFailure ?? (() => undefined)
    const compliant: TRelation[] = []
    for (const relation of input.relations) {
        const derivationOnlySources = relation.sources.filter((src) =>
            DERIVATION_ONLY_SOURCE_CLAIM_TYPES.has(
                input.typeByClaimMiniId.get(src) ?? "normal"
            )
        )
        if (derivationOnlySources.length === 0) {
            compliant.push(relation)
            continue
        }
        if (relation.type === "derivation-support") {
            // Already a derivation premise — compliant as-is.
            compliant.push(relation)
            continue
        }
        // A single-source freeform relation reroutes cleanly to a
        // derivation premise (antecedent = the typed claim, consequent =
        // the target).
        if (relation.sources.length === 1) {
            compliant.push({ ...relation, type: "derivation-support" })
            continue
        }
        // A multi-source freeform relation with a derivation-only source
        // can't become a compliant derivation premise: the antecedent
        // would be an AND across mixed grounding, which a derivation
        // antecedent does not admit. Drop it rather than emit a violation.
        emit({
            code: RELATION_PLACEMENT_FAILURE_CODES.droppedNoncompliantRelation,
            message: `Relation "${relation.relationId}" places a citation/axiomatic source in a freeform premise and cannot be rerouted; dropping the premise.`,
            severity: "warning",
            context: {
                relationId: relation.relationId,
                derivationOnlySources,
            },
        })
    }
    return compliant
}

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
            STAGE_IDS.claimCanonicalization,
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
            const typeEnvelope = ctx.get<TClaimTypeClassificationOutput>(
                STAGE_IDS.claimTypeClassification
            )
            const canon = ctx.get<TClaimCanonicalizationOutput>(
                STAGE_IDS.claimCanonicalization
            )
            // Pre-pass (claim-type-aware): keep citation/axiomatic claims
            // out of freeform premises before the type-blind compile.
            const placedRelations = rerouteDerivationOnlyRelations({
                relations,
                typeByClaimMiniId: resolveClaimTypes({
                    classifications: typeEnvelope?.classifications ?? [],
                    canonicalClaims: canon?.canonicalClaims ?? [],
                }),
                addFailure: ctx.addFailure,
            })
            return compileFormulas({
                relations: placedRelations,
                conclusion,
                variables,
                generateId: ctx.generateId,
                addFailure: ctx.addFailure,
            })
        },
    })
