// `finalize-response-v2` — assembles the v2 multi-stage pipeline's
// final `TParsedArgumentResponse`-shaped output from accumulated
// per-stage outputs.
//
// Behavior per spec §7.2 finalize row + §7.4 (role derivation) +
// §7.5 (failure model):
//
//   - When `claim-canonicalization.canonicalClaims` is empty:
//     `{ argument: null, failureText: "No claims could be extracted
//     from the input.", uncategorizedText: null,
//     selectionRationale: null, processingFailures: [] }`.
//
//   - When `formula-compilation.conclusionPremiseMiniId` is null
//     (conclusion-selection returned null, or the conclusion claim
//     wasn't resolvable to a symbol): `{ argument: null,
//     failureText: "No single conclusion could be selected.", ... }`.
//
//   - Otherwise: assemble the full argument from the canonical claims
//     (with per-claim role derived from `relation-extraction` +
//     `conclusion-selection`), the variables from `variable-assignment`,
//     and the premises from `formula-compilation`. The `selectionRationale`
//     field is `conclusion-selection.rationale` (or null when the
//     stage is missing).
//
// **`processingFailures` slot.** Mirroring v1's convention, finalize
// always emits an empty `processingFailures: []` array on the output.
// The full list of per-stage failures lives on `PipelineResult.failures`
// — consumers that want them read that field. The slot on the response
// object is a forward-compat hook; the framework doesn't have a clean
// way for `finalize.run` to consult the executor's accumulated failure
// list (which would require widening `TStageContext` — out of scope
// for slice 2A.late).

import type { TParsedArgumentResponse } from "../../../lib/parsing/index.js"
import type { TStageContext } from "../../../lib/pipelines/index.js"
import {
    STAGE_IDS,
    type TClaimCanonicalizationOutput,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TRelationExtractionOutput,
    type TVariableAssignmentOutput,
} from "../stages/schemas.js"
import type { TIngestionExtension } from "./types.js"

export const FINALIZE_V2_FAILURE_TEXTS = {
    noClaims: "No claims could be extracted from the input.",
    noConclusion: "No single conclusion could be selected.",
} as const

type TPremiseFinalForm = {
    miniId: string
    formula: string
    title: string
} & Record<string, unknown>

type TClaimFinalForm = {
    miniId: string
    role: "premise" | "conclusion" | "intermediate"
} & Record<string, unknown>

type TVariableFinalForm = {
    miniId: string
    symbol: string
    claimMiniId: string
} & Record<string, unknown>

type TArgumentFinalForm = {
    claims: TClaimFinalForm[]
    variables: TVariableFinalForm[]
    premises: TPremiseFinalForm[]
    conclusionPremiseMiniId: string
} & Record<string, unknown>

function buildClaimToRole(args: {
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"]
    /** Bare relations array (unwrapped from the stage's envelope). */
    relations: TRelationExtractionOutput["relations"]
    conclusionMiniId: string | null
}): Record<string, "premise" | "conclusion" | "intermediate"> {
    const out: Record<string, "premise" | "conclusion" | "intermediate"> = {}
    // Claims that participate in any relation (source or target) are
    // "premise" by default; claims that don't appear in any relation
    // are "intermediate" (per spec §7.4). The conclusion overrides.
    const claimsInRelations = new Set<string>()
    for (const rel of args.relations) {
        for (const s of rel.sources) claimsInRelations.add(s)
        claimsInRelations.add(rel.target)
    }
    for (const claim of args.canonicalClaims) {
        if (claim.miniId === args.conclusionMiniId) {
            out[claim.miniId] = "conclusion"
        } else if (claimsInRelations.has(claim.miniId)) {
            out[claim.miniId] = "premise"
        } else {
            out[claim.miniId] = "intermediate"
        }
    }
    return out
}

function stripCanonicalizerOnlyFields(
    claim: Record<string, unknown>
): Record<string, unknown> {
    // The canonicalizer's per-claim record carries `mentionIds` and
    // `suggestedSymbol` which are not part of the public response
    // schema. Strip them from the finalize output (the variable's
    // `symbol` carries the assigned identifier; mentionIds are an
    // internal trace).
    const stripped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(claim)) {
        if (key === "mentionIds" || key === "suggestedSymbol") continue
        stripped[key] = value
    }
    return stripped
}

function buildPremiseTitle(
    formula: string,
    roleHint: "support" | "joint-support" | "derivation" | "conclusion"
): string {
    const cap = 50
    const truncate = (s: string): string =>
        s.length <= cap ? s : s.slice(0, cap - 1) + "…"
    switch (roleHint) {
        case "conclusion":
            return truncate(`Conclusion: ${formula}`)
        case "joint-support":
            return truncate(`Joint support → ${formula}`)
        case "derivation":
            return truncate(`Derivation: ${formula}`)
        case "support":
            return truncate(`Support: ${formula}`)
    }
}

function buildArgumentTitle(
    canonicalClaims: TClaimCanonicalizationOutput["canonicalClaims"],
    conclusionMiniId: string | null
): string {
    const cap = 50
    const conclusionClaim = canonicalClaims.find(
        (c) => c.miniId === conclusionMiniId
    ) as Record<string, unknown> | undefined
    const candidateTitle =
        (conclusionClaim?.title as string | undefined) ??
        (conclusionClaim?.axiom as string | undefined) ??
        "Argument"
    return candidateTitle.length <= cap
        ? candidateTitle
        : candidateTitle.slice(0, cap - 1) + "…"
}

export type TFinalizeResponseV2Input = {
    ctx: TStageContext
    extension: TIngestionExtension
}

/**
 * Assembles the v2 pipeline's final response from the
 * `TStageContext`'s accumulated upstream outputs.
 */
export function finalizeResponseV2(
    input: TFinalizeResponseV2Input
): TParsedArgumentResponse {
    void input.extension // forward-compat (extension-specific assembly hooks)
    const { ctx } = input
    const canon = ctx.get<TClaimCanonicalizationOutput>(
        STAGE_IDS.claimCanonicalization
    )
    const variables =
        ctx.get<TVariableAssignmentOutput>(STAGE_IDS.variableAssignment) ?? []
    const compilation = ctx.get<TFormulaCompilationOutput>(
        STAGE_IDS.formulaCompilation
    )
    const conclusion = ctx.get<TConclusionSelectionOutput>(
        STAGE_IDS.conclusionSelection
    )
    const relationEnvelope = ctx.get<TRelationExtractionOutput>(
        STAGE_IDS.relationExtraction
    )
    const relations = relationEnvelope?.relations ?? []
    const typeMap =
        ctx.get<TClaimTypeClassificationOutput>(
            STAGE_IDS.claimTypeClassification
        ) ?? {}

    const processingFailures: never[] = []
    const baseResponse = {
        uncategorizedText: null,
        selectionRationale: conclusion?.rationale ?? null,
    }

    // Failure path 1: no canonical claims at all.
    if (!canon || canon.canonicalClaims.length === 0) {
        return {
            argument: null,
            failureText: FINALIZE_V2_FAILURE_TEXTS.noClaims,
            ...baseResponse,
            // `processingFailures` is a side-channel slot the v1
            // finalize also attaches; the response schema permits
            // additional properties.

            processingFailures,
        } as TParsedArgumentResponse
    }

    // Failure path 2: no single conclusion could be selected (or the
    // conclusion claim has no resolvable variable, in which case
    // formula-compilation already emitted an unresolved-conclusion
    // failure and left conclusionPremiseMiniId null).
    if (compilation?.conclusionPremiseMiniId === null || !compilation) {
        return {
            argument: null,
            failureText: FINALIZE_V2_FAILURE_TEXTS.noConclusion,
            ...baseResponse,

            processingFailures,
        } as TParsedArgumentResponse
    }

    // Happy path: assemble the argument.
    const conclusionMiniId = conclusion?.conclusionMiniId ?? null
    const roles = buildClaimToRole({
        canonicalClaims: canon.canonicalClaims,
        relations,
        conclusionMiniId,
    })

    const claims: TClaimFinalForm[] = canon.canonicalClaims.map((c) => {
        const refinedType = typeMap[c.miniId]?.type ?? c.type
        const stripped = stripCanonicalizerOnlyFields(
            c as unknown as Record<string, unknown>
        )
        return {
            ...stripped,
            type: refinedType,
            role: roles[c.miniId],
        } as unknown as TClaimFinalForm
    })

    const finalVariables: TVariableFinalForm[] = variables.map((v) => ({
        ...v,
    }))

    const finalPremises: TPremiseFinalForm[] = compilation.premises.map(
        (p) => ({
            miniId: p.premiseMiniId,
            formula: p.formula,
            title: buildPremiseTitle(p.formula, p.roleHint),
        })
    )

    const argument: TArgumentFinalForm = {
        claims,
        variables: finalVariables,
        premises: finalPremises,
        conclusionPremiseMiniId: compilation.conclusionPremiseMiniId,
        title: buildArgumentTitle(canon.canonicalClaims, conclusionMiniId),
    }

    return {
        argument: argument as unknown as TParsedArgumentResponse["argument"],
        failureText: null,
        ...baseResponse,

        processingFailures,
    } as TParsedArgumentResponse
}
