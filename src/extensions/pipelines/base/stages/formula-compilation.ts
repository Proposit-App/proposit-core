// `formula-compilation` — deterministic stage that turns each `inference`
// relation into a `parseFormula`-consumable formula string for a freeform
// premise, sorts citation/axiomatic antecedents out into derivation
// backing, and mints one dedicated "conclusion premise" whose formula is
// just the conclusion claim's variable symbol.
//
// Inference relations compile to:
//   antecedents a1..an → consequent c  ⇒  (a1 AND ... AND an) IMPLIES c
//   (a single antecedent drops the parentheses: a1 IMPLIES c)
//
// Citation/axiomatic claims may not sit in a freeform premise (grammar
// rules D-4 / D-5) — they ground a derivation premise instead.
// `sortInferenceRelations` extracts any citation/axiomatic antecedent into
// `derivationBacking` (consumed by the parser to build derivation premises)
// and keeps only the normal antecedents in the freeform implication. A
// relation left with no normal antecedents is fully captured by the backing
// and emits no freeform premise. A relation whose consequent is itself
// citation/axiomatic, or whose antecedent can't be resolved to a known
// claim type, is dropped with a recorded warning — a bad relation degrades
// to "premise omitted", never to a failed import.
//
// The conclusion-premise mapping rule:
//   - When `conclusion-selection.conclusionMiniId` is non-null AND the
//     claim resolves to a variable symbol: one premise is minted with
//     `roleHint: "conclusion"` and `formula: <the claim's symbol>`.
//   - Otherwise `conclusionPremiseMiniId` is null.

import {
    STAGE_IDS,
    FormulaCompilationOutputSchema,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TInferenceRelation,
    type TRelationExtractionOutput,
    type TVariableAssignmentOutput,
} from "./schemas.js"
import { deterministicStage } from "../../../../lib/pipelines/stage-helpers.js"
import type { TStage, TStageContext } from "../../../../lib/pipelines/types.js"

export const FORMULA_COMPILATION_FAILURE_CODES = {
    unresolvedAntecedent: "FORMULA_COMPILATION_ANTECEDENT_UNRESOLVED",
    unresolvedConsequent: "FORMULA_COMPILATION_CONSEQUENT_UNRESOLVED",
    unresolvedConclusion: "FORMULA_COMPILATION_CONCLUSION_UNRESOLVED",
    emptyAntecedents: "FORMULA_COMPILATION_ANTECEDENTS_EMPTY",
} as const

// Claim types that may only ground a derivation premise — never sit in a
// freeform premise. An inference antecedent of one of these types is
// extracted into derivation backing instead of the freeform formula.
const DERIVATION_ONLY_CLAIM_TYPES = new Set<
    TClaimTypeClassificationEntry["type"]
>(["citation", "axiomatic"])

export const RELATION_PLACEMENT_FAILURE_CODES = {
    droppedTypedConsequent: "RELATION_PLACEMENT_DROPPED_TYPED_CONSEQUENT",
    droppedUnresolvedClaim: "RELATION_PLACEMENT_DROPPED_UNRESOLVED_CLAIM",
    droppedEmptyAntecedents: "RELATION_PLACEMENT_DROPPED_EMPTY_ANTECEDENTS",
} as const

type TAddFailure = (failure: {
    code: string
    message: string
    severity: "warning" | "error"
    context?: Record<string, unknown>
}) => void

/**
 * Resolve each claim's effective type into a `miniId → type` map,
 * preferring the `claim-type-classification` entry and falling back to the
 * canonicalizer's drafted `type`. This is the SAME resolution
 * `finalizeResponseV2` uses, so the sort and finalize never disagree on
 * whether a claim is citation/axiomatic — a disagreement is exactly what
 * would let a citation slip into a freeform premise.
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
 * A freeform relation after the citation/axiomatic sort: only normal
 * antecedents remain.
 */
export type TFreeformRelation = {
    relationId: string
    antecedents: string[]
    consequent: string
}

export type TSortInferenceRelationsResult = {
    freeformRelations: TFreeformRelation[]
    /** consequent claim miniId → its citation/axiomatic supporting claim miniIds. */
    derivationBacking: Map<string, string[]>
}

/**
 * Deterministically sort inference relations into freeform premises and
 * derivation backing. For each relation:
 *  - drop (warn) if the consequent is citation/axiomatic — a typed claim
 *    cannot be the consequent of an implication;
 *  - dedupe antecedents and drop a self-referential antecedent;
 *  - drop (warn) the whole relation if any antecedent's type can't be
 *    resolved — never silently treat an unresolved id as `normal`;
 *  - route citation/axiomatic antecedents into `derivationBacking`;
 *  - keep the normal antecedents as the freeform implication; if none
 *    remain, the relation is fully captured by the backing and yields no
 *    freeform premise.
 */
export function sortInferenceRelations(input: {
    relations: TInferenceRelation[]
    typeByClaimMiniId: Map<string, TClaimTypeClassificationEntry["type"]>
    addFailure?: TAddFailure
}): TSortInferenceRelationsResult {
    const emit = input.addFailure ?? (() => undefined)
    const freeformRelations: TFreeformRelation[] = []
    const derivationBacking = new Map<string, string[]>()

    const addBacking = (consequent: string, supporter: string) => {
        const list = derivationBacking.get(consequent) ?? []
        if (!list.includes(supporter)) list.push(supporter)
        derivationBacking.set(consequent, list)
    }

    for (const relation of input.relations) {
        const consequentType = input.typeByClaimMiniId.get(relation.consequent)
        if (consequentType === undefined) {
            emit({
                code: RELATION_PLACEMENT_FAILURE_CODES.droppedUnresolvedClaim,
                message: `Relation "${relation.relationId}" consequent "${relation.consequent}" has no resolvable claim type; dropping.`,
                severity: "warning",
                context: {
                    relationId: relation.relationId,
                    claimMiniId: relation.consequent,
                },
            })
            continue
        }
        if (DERIVATION_ONLY_CLAIM_TYPES.has(consequentType)) {
            emit({
                code: RELATION_PLACEMENT_FAILURE_CODES.droppedTypedConsequent,
                message: `Relation "${relation.relationId}" has a ${consequentType} consequent; citation/axiomatic claims cannot be an implication's consequent. Dropping.`,
                severity: "warning",
                context: {
                    relationId: relation.relationId,
                    consequent: relation.consequent,
                    consequentType,
                },
            })
            continue
        }

        // Dedupe antecedents and drop any self-reference to the consequent.
        const antecedents = [...new Set(relation.antecedents)].filter(
            (a) => a !== relation.consequent
        )
        if (antecedents.length === 0) {
            emit({
                code: RELATION_PLACEMENT_FAILURE_CODES.droppedEmptyAntecedents,
                message: `Relation "${relation.relationId}" has no usable antecedents; dropping.`,
                severity: "warning",
                context: { relationId: relation.relationId },
            })
            continue
        }

        const normalAntecedents: string[] = []
        const typedAntecedents: string[] = []
        let unresolved = false
        for (const antecedent of antecedents) {
            const type = input.typeByClaimMiniId.get(antecedent)
            if (type === undefined) {
                emit({
                    code: RELATION_PLACEMENT_FAILURE_CODES.droppedUnresolvedClaim,
                    message: `Relation "${relation.relationId}" antecedent "${antecedent}" has no resolvable claim type; dropping the relation rather than treating it as normal.`,
                    severity: "warning",
                    context: {
                        relationId: relation.relationId,
                        claimMiniId: antecedent,
                    },
                })
                unresolved = true
                break
            }
            if (DERIVATION_ONLY_CLAIM_TYPES.has(type)) {
                typedAntecedents.push(antecedent)
            } else {
                normalAntecedents.push(antecedent)
            }
        }
        if (unresolved) continue

        for (const supporter of typedAntecedents) {
            addBacking(relation.consequent, supporter)
        }

        if (normalAntecedents.length === 0) {
            // Fully captured by derivation backing; no freeform premise.
            continue
        }
        freeformRelations.push({
            relationId: relation.relationId,
            antecedents: normalAntecedents,
            consequent: relation.consequent,
        })
    }

    return { freeformRelations, derivationBacking }
}

export type TCompileFormulasInput = {
    freeformRelations: TFreeformRelation[]
    conclusion: TConclusionSelectionOutput | undefined
    variables: TVariableAssignmentOutput
    generateId: () => string
    addFailure?: TAddFailure
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

/**
 * Compile freeform relations into premise formulas, and mint the
 * conclusion premise. Pure helper exposed for direct testing. The stage's
 * `derivationBacking` is added by the stage wrapper, not here.
 */
export function compileFormulas(
    input: TCompileFormulasInput
): Omit<TFormulaCompilationOutput, "derivationBacking"> {
    const claimToSymbol = buildClaimToSymbol(input.variables)
    const emit = input.addFailure ?? (() => undefined)

    const premises: TFormulaCompilationOutput["premises"] = []

    for (const relation of input.freeformRelations) {
        if (relation.antecedents.length === 0) {
            emit({
                code: FORMULA_COMPILATION_FAILURE_CODES.emptyAntecedents,
                message: `Relation "${relation.relationId}" has no antecedents; cannot compile.`,
                severity: "warning",
                context: { relationId: relation.relationId },
            })
            continue
        }
        const consequentSymbol = claimToSymbol.get(relation.consequent)
        if (!consequentSymbol) {
            emit({
                code: FORMULA_COMPILATION_FAILURE_CODES.unresolvedConsequent,
                message: `Relation "${relation.relationId}" consequent claim "${relation.consequent}" has no variable assignment; dropping.`,
                severity: "error",
                context: {
                    relationId: relation.relationId,
                    consequentClaimMiniId: relation.consequent,
                },
            })
            continue
        }
        const antecedentSymbols: string[] = []
        let antecedentsOk = true
        for (const antecedent of relation.antecedents) {
            const sym = claimToSymbol.get(antecedent)
            if (!sym) {
                emit({
                    code: FORMULA_COMPILATION_FAILURE_CODES.unresolvedAntecedent,
                    message: `Relation "${relation.relationId}" antecedent claim "${antecedent}" has no variable assignment; dropping.`,
                    severity: "error",
                    context: {
                        relationId: relation.relationId,
                        antecedentClaimMiniId: antecedent,
                    },
                })
                antecedentsOk = false
                break
            }
            antecedentSymbols.push(sym)
        }
        if (!antecedentsOk) continue

        const formula =
            antecedentSymbols.length > 1
                ? `(${antecedentSymbols.join(" and ")}) implies ${consequentSymbol}`
                : `${antecedentSymbols[0]} implies ${consequentSymbol}`

        premises.push({
            premiseMiniId: input.generateId(),
            formula,
            roleHint: "freeform",
            sourceRelationId: relation.relationId,
        })
    }

    // Mint the conclusion premise iff conclusion-selection chose a claim
    // AND the claim resolves to a known variable symbol.
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
            const { freeformRelations, derivationBacking } =
                sortInferenceRelations({
                    relations,
                    typeByClaimMiniId: resolveClaimTypes({
                        classifications: typeEnvelope?.classifications ?? [],
                        canonicalClaims: canon?.canonicalClaims ?? [],
                    }),
                    addFailure: ctx.addFailure,
                })
            const compiled = compileFormulas({
                freeformRelations,
                conclusion,
                variables,
                generateId: ctx.generateId,
                addFailure: ctx.addFailure,
            })
            return {
                ...compiled,
                derivationBacking: [...derivationBacking.entries()].map(
                    ([derivedClaimMiniId, supportingClaimMiniIds]) => ({
                        derivedClaimMiniId,
                        supportingClaimMiniIds,
                    })
                ),
            }
        },
    })
