// `finalize-response-v2` — assembles the multi-stage ingestion pipeline's
// final `TParsedArgumentResponse`-shaped output from accumulated
// per-stage outputs.
//
// Behavior, including role derivation and the failure cases:
//
//   - When `claim-canonicalization.canonicalClaims` is empty:
//     `{ argument: null, failureText: "No claims could be extracted
//     from the input.", uncategorizedText: null,
//     selectionRationale: null, processingFailures: [] }`.
//
//   - When `formula-compilation.conclusionPremiseMiniId` is null
//     (conclusion-selection returned null, or the conclusion claim
//     wasn't resolvable to a symbol): `{ argument: null,
//     failureText: "Couldn't work out how these claims connect to a
//     conclusion.", ... }` (`FINALIZE_V2_FAILURE_TEXTS.noConclusion`).
//
//   - Otherwise: assemble the full argument from the canonical claims
//     (with per-claim role derived from `relation-extraction` +
//     `conclusion-selection`), the variables from `variable-assignment`,
//     and the premises from `formula-compilation`. The `selectionRationale`
//     field is `conclusion-selection.rationale` (or null when the
//     stage is missing).
//
// **`processingFailures` slot.** Finalize
// always emits an empty `processingFailures: []` array on the output.
// The full list of per-stage failures lives on `PipelineResult.failures`
// — consumers that want them read that field. The slot on the response
// object stays empty because the framework gives no way for `finalize.run` to consult the executor's accumulated failure
// list (which would require widening `TStageContext`).

import type { TParsedArgumentResponse } from "../../../../lib/parsing/index.js"
import type { TStageContext } from "../../../../lib/pipelines/index.js"
import {
    STAGE_IDS,
    type TClaimCanonicalizationOutput,
    type TClaimMentionExtractionOutput,
    type TClaimTypeClassificationEntry,
    type TClaimTypeClassificationOutput,
    type TConclusionSelectionOutput,
    type TFormulaCompilationOutput,
    type TRelationExtractionOutput,
    type TSegmentationOutput,
    type TVariableAssignmentOutput,
} from "../stages/schemas.js"
import { NO_ARGUMENT_STRUCTURE_FAILURE } from "../stages/conclusion-selection.js"
import type { TIngestionSourceAnchor } from "../source-anchors.js"
import type { TIngestionExtension } from "../types.js"
import { buildUnparsedCitation, firstNonEmptyString } from "./citation-type.js"
import {
    buildAnchorByMentionId,
    claimAnchors,
    readInputText,
    readMentionIds,
    resolveSegmentStarts,
    SOURCE_ANCHOR_NOTE_CODES,
} from "./source-anchor-resolution.js"
import {
    buildArgumentTitle,
    buildClaimTitleByMiniId,
    buildPremiseTitle,
    resolveAuthoredConclusionTitle,
    titleKey,
    type TTitleComposerMaps,
} from "./titles.js"

export const FINALIZE_V2_FAILURE_TEXTS = {
    noClaims: "No claims could be extracted from the input.",
    noConclusion: NO_ARGUMENT_STRUCTURE_FAILURE.message,
} as const

/**
 * Warning code for a premise whose title repeats an earlier premise's and
 * could not be replaced by a distinct composed one.
 */
const PREMISE_TITLE_DUPLICATE = "PREMISE_TITLE_DUPLICATE"

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
    // are "intermediate". The conclusion overrides.
    const claimsInRelations = new Set<string>()
    for (const rel of args.relations) {
        for (const antecedent of rel.antecedents)
            claimsInRelations.add(antecedent)
        claimsInRelations.add(rel.consequent)
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
    // schema. Strip them from the finalize output: the variable's
    // `symbol` carries the assigned identifier, and mention ids name an
    // id space the response never carries — the provenance they trace is
    // resolved into `sourceAnchors` instead, which a consumer can act on.
    const stripped: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(claim)) {
        if (key === "mentionIds" || key === "suggestedSymbol") continue
        stripped[key] = value
    }
    return stripped
}

export type TFinalizeResponseV2Input = {
    ctx: TStageContext
    extension: TIngestionExtension
    /**
     * Segmentation + mention outputs, supplied by the caller rather than
     * read from `ctx`, because not every pipeline has these stages —
     * `ctx.get` on a stage outside `finalize.dependsOn` is a
     * configuration error, and declaring a dep on a stage the pipeline
     * does not contain is another. Passing them keeps the declaration
     * and the read in the same file, per pipeline. Omit both and claims
     * carry no source anchors; premises are unaffected either way.
     */
    segmentation?: TSegmentationOutput
    mentions?: TClaimMentionExtractionOutput
}

/**
 * Assembles the ingestion pipeline's final response from the
 * `TStageContext`'s accumulated upstream outputs.
 */
export function finalizeResponseV2(
    input: TFinalizeResponseV2Input
): TParsedArgumentResponse {
    void input.extension // accepted but not read by the assembly
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
    const typeEnvelope = ctx.get<TClaimTypeClassificationOutput>(
        STAGE_IDS.claimTypeClassification
    )
    const typeByMiniId = new Map<string, TClaimTypeClassificationEntry>()
    for (const entry of typeEnvelope?.classifications ?? []) {
        typeByMiniId.set(entry.miniId, entry)
    }

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
            // `processingFailures` is an extra slot outside the parsed
            // response type; the response schema permits additional
            // properties.

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
    const inputText = readInputText(ctx.input)
    // Nothing resolves against an empty input, so resolution is skipped
    // wholesale rather than run to produce one "quote not found" note per
    // mention. N notes blaming the model for a fault in the
    // caller's input shape is worse than no notes; one note naming the
    // real cause is better than either. It also keeps every extracted
    // quote out of `failures`.
    const inputAvailable = inputText.length > 0
    if (!inputAvailable) {
        ctx.addFailure({
            code: SOURCE_ANCHOR_NOTE_CODES.inputUnavailable,
            message:
                "The pipeline input carries no text, so no source anchors were resolved. This is a property of the input, not of the model's output.",
            severity: "warning",
        })
    }
    const segmentStartById = resolveSegmentStarts(inputText, input.segmentation)
    const anchorByMentionId = inputAvailable
        ? buildAnchorByMentionId({
              ctx,
              inputText,
              segmentStartById,
              segments: input.segmentation?.segments,
              mentions: input.mentions,
          })
        : new Map<string, TIngestionSourceAnchor>()
    // Only a pipeline whose mention stage ran, over an input it could read,
    // was expected to look each claim up; without either, the missing
    // anchors are a property of the pipeline or of the input, and the
    // input case is already reported once above.
    const producedMentionIds =
        inputAvailable && input.mentions
            ? new Set(input.mentions.mentions.map((m) => m.mentionId))
            : undefined
    // Every mention the mention stage produced should belong to some claim's
    // `mentionIds`. One that does not is linked to no claim — whether or not
    // its quote resolved, which is reported separately — so say so, once per
    // mention id.
    if (producedMentionIds && input.mentions) {
        const namedMentionIds = new Set(
            canon.canonicalClaims.flatMap((c) =>
                readMentionIds(c as unknown as Record<string, unknown>)
            )
        )
        const reported = new Set<string>()
        for (const mention of input.mentions.mentions) {
            if (namedMentionIds.has(mention.mentionId)) continue
            if (reported.has(mention.mentionId)) continue
            reported.add(mention.mentionId)
            ctx.addFailure({
                code: SOURCE_ANCHOR_NOTE_CODES.mentionUnclaimed,
                message: `No claim references mention ${mention.mentionId}, so its passage is linked to no claim.`,
                severity: "warning",
                context: { mentionId: mention.mentionId, quote: mention.text },
            })
        }
    }
    const conclusionMiniId = conclusion?.conclusionMiniId ?? null
    const roles = buildClaimToRole({
        canonicalClaims: canon.canonicalClaims,
        relations,
        conclusionMiniId,
    })

    const claims: TClaimFinalForm[] = canon.canonicalClaims.map((c) => {
        const role = roles[c.miniId]
        const classifiedType = typeByMiniId.get(c.miniId)?.type ?? c.type
        const record = c as unknown as Record<string, unknown>
        const stripped = stripCanonicalizerOnlyFields(record)
        // An entity with no resolvable provenance carries no key at all
        // rather than an empty array — "we found nothing" and "we did not
        // look" read the same to a consumer, and neither is a claim about
        // the text.
        const mentionIds = readMentionIds(record)
        if (
            producedMentionIds &&
            !mentionIds.some((id) => producedMentionIds.has(id))
        ) {
            ctx.addFailure({
                code: SOURCE_ANCHOR_NOTE_CODES.notAttempted,
                message: `None of claim ${c.miniId}'s mentions is one the mention stage produced, so no source anchor was looked for.`,
                severity: "warning",
                context: { claimMiniId: c.miniId },
            })
        }
        const anchors = claimAnchors(mentionIds, anchorByMentionId)
        if (anchors.length > 0) {
            stripped.sourceAnchors = anchors
        }
        // A claim classified `citation` stays `citation` and carries an
        // explicit `UnparsedCitation` (its `text` is the display text, so
        // a reference without a url still renders its text). Premise
        // placement is handled upstream by the deterministic relation
        // sort, which keeps citation claims out of freeform premises — so a
        // citation never lands as a freeform antecedent here, and there is
        // no url-presence demotion to do.
        if (classifiedType === "citation") {
            const unparsedCitation = buildUnparsedCitation({
                title: firstNonEmptyString(stripped.title),
                sourceString: typeByMiniId.get(c.miniId)?.sourceString,
                rawGuess: record.citationTypeGuess,
                url: record.url,
                fallbackText: c.miniId,
            })
            // The raw `citationTypeGuess` field rides into finalize on the
            // canonical claim; it is folded into the `citation` object's
            // `citationTypeGuess`, so drop the loose copy from the output.
            const { citationTypeGuess: _rawGuess, ...withoutRawGuess } =
                stripped
            void _rawGuess
            return {
                ...withoutRawGuess,
                type: classifiedType,
                role,
                citation: unparsedCitation,
            } as unknown as TClaimFinalForm
        }
        return {
            ...stripped,
            type: classifiedType,
            role,
        } as unknown as TClaimFinalForm
    })

    const finalVariables: TVariableFinalForm[] = variables.map((v) => ({
        ...v,
    }))

    const titleComposerMaps: TTitleComposerMaps = {
        claimTitleByMiniId: buildClaimTitleByMiniId(canon.canonicalClaims),
        claimMiniIdBySymbol: new Map(
            variables.map((v) => [v.symbol, v.claimMiniId])
        ),
        symbolByClaimMiniId: new Map(
            variables.map((v) => [v.claimMiniId, v.symbol])
        ),
        relationById: new Map(relations.map((r) => [r.relationId, r])),
    }

    const authoredConclusionTitle = resolveAuthoredConclusionTitle(
        conclusion,
        relations
    )

    const takenTitles = new Set<string>()
    const finalPremises: TPremiseFinalForm[] = compilation.premises.map((p) => {
        const title = buildPremiseTitle(
            p,
            titleComposerMaps,
            authoredConclusionTitle,
            takenTitles
        )
        if (takenTitles.has(titleKey(title))) {
            ctx.addFailure({
                code: PREMISE_TITLE_DUPLICATE,
                message: `Premise ${p.premiseMiniId} has the same title as an earlier premise, and no distinct title could be composed for it.`,
                severity: "warning",
                context: { premiseMiniId: p.premiseMiniId, title },
            })
        }
        takenTitles.add(titleKey(title))
        return { miniId: p.premiseMiniId, formula: p.formula, title }
    })

    const argument: TArgumentFinalForm = {
        claims,
        variables: finalVariables,
        premises: finalPremises,
        conclusionPremiseMiniId: compilation.conclusionPremiseMiniId,
        // Citation/axiomatic backing the sort extracted from inference
        // antecedents; the parser materializes it into derivation edges.
        derivationBacking: compilation.derivationBacking,
        title: buildArgumentTitle(canon.canonicalClaims, conclusionMiniId),
    }

    return {
        argument: argument as unknown as TParsedArgumentResponse["argument"],
        failureText: null,
        ...baseResponse,

        processingFailures,
    } as TParsedArgumentResponse
}
