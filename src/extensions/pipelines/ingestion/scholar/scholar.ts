// scholar — the thorough, multi-stage ingestion pipeline.
//
// Composes the 12 stages defined under `../../base/stages/` into a single
// `TPipeline<TIngestionInput, TParsedArgumentResponse>` whose `finalize`
// assembles the parsed-argument response shape downstream parsing
// consumes. The sibling `scribe` pipeline emits the same output shape
// from a cheaper two-call front end, so consumers can swap the two
// factories without changing downstream parsing.
//
// DAG:
//
//   segmentation
//     ├── claim-mention-extraction ─→ claim-canonicalization ─┐
//     ├── citation-source-detection ─────────────────────────┤
//     ├── axiom-indicator-detection ─────────────────────────┤
//     │                                                      │
//     │   ┌─ claim-type-classification ─────────────────────┐│
//     │   ├─ claim-reference-validation                     ││
//     │   └─ variable-assignment                            ││
//     │                                                     ↓↓
//     │                                          relation-extraction
//     │                                                     │
//     │                                          conclusion-selection
//     │                                                     │
//     │                                          formula-compilation
//     │                                                     │
//     │                                          formula-validation
//     └──────────────────────────────────────────────── finalize
//
// 4 deterministic stages (claim-reference-validation, variable-assignment,
// formula-compilation, formula-validation) + 8 LLM stages.

import Type from "typebox"
import {
    STAGE_IDS,
    claimReferenceValidationStage,
    createAxiomIndicatorDetectionStage,
    createCitationSourceDetectionStage,
    createClaimCanonicalizationStage,
    createClaimMentionExtractionStage,
    createClaimTypeClassificationStage,
    createConclusionSelectionStage,
    createRelationExtractionStage,
    createSegmentationStage,
    formulaCompilationStage,
    formulaValidationStage,
    variableAssignmentStage,
    SEGMENTATION_STAGE_DEFAULTS,
    CLAIM_MENTION_EXTRACTION_STAGE_DEFAULTS,
    CITATION_SOURCE_DETECTION_STAGE_DEFAULTS,
    AXIOM_INDICATOR_DETECTION_STAGE_DEFAULTS,
    CLAIM_CANONICALIZATION_STAGE_DEFAULTS,
    CLAIM_TYPE_CLASSIFICATION_STAGE_DEFAULTS,
    RELATION_EXTRACTION_STAGE_DEFAULTS,
    CONCLUSION_SELECTION_STAGE_DEFAULTS,
    type TClaimMentionExtractionOutput,
    type TSegmentationOutput,
} from "../../base/stages/index.js"
import { optional } from "../../../../lib/pipelines/index.js"
import type { TPipeline, TStage } from "../../../../lib/pipelines/index.js"
import type { TParsedArgumentResponse } from "../../../../lib/parsing/index.js"
import { finalizeResponseV2 } from "../../base/finalize-response-v2.js"
import { resolveLlmStageOptions } from "../../base/resolve-llm-stage-options.js"
import type {
    TIngestionExtension,
    TIngestionInput,
    TIngestionLlmOptions,
} from "../../base/types.js"

const PIPELINE_ID = "argument-ingestion-scholar"
const PIPELINE_VERSION = "1.0.0"

/**
 * Input schema shared by every ingestion pipeline: a single non-empty
 * raw argument text. Exported so sibling pipelines (e.g. the fast
 * `scribe` pipeline) advertise the identical input contract.
 */
export const INGESTION_INPUT_SCHEMA = Type.Object({
    text: Type.String({ minLength: 1 }),
})

/**
 * Options for `createScholarPipeline`.
 *
 * `llm.defaults` applies to every LLM stage that doesn't have a
 * per-stage entry under `llm.overrides`; per-stage entries are keyed
 * by stage id (`STAGE_IDS.segmentation`, etc.). The effective knobs
 * compose stage-override > pipeline-default > internal stage default.
 *
 * @example
 * ```ts
 * createScholarPipeline(basicsExtension, {
 *     llm: {
 *         defaults: { maxOutputTokens: 16_384 },
 *         overrides: {
 *             [STAGE_IDS.segmentation]: { maxOutputTokens: 32_768 },
 *         },
 *     },
 * })
 * ```
 */
export type TCreateScholarPipelineOptions = {
    llm?: TIngestionLlmOptions
}

/**
 * Build the scholar (thorough) ingestion pipeline for the supplied
 * extension. Returns a `TPipeline` whose 12-stage DAG segments,
 * extracts, canonicalizes, classifies, relates, and compiles the raw
 * text, and whose `finalize` assembles the `TParsedArgumentResponse`
 * shape `ArgumentParser.build()` consumes.
 *
 * The factory is pure: it constructs stage values + a pipeline
 * descriptor and returns immediately. Stage execution happens inside
 * `executePipeline`.
 */
export function createScholarPipeline(
    extension: TIngestionExtension,
    options?: TCreateScholarPipelineOptions
): TPipeline<TIngestionInput, TParsedArgumentResponse> {
    const llm = options?.llm
    const segmentationStage = createSegmentationStage(
        resolveLlmStageOptions(
            STAGE_IDS.segmentation,
            SEGMENTATION_STAGE_DEFAULTS,
            llm
        )
    )
    const claimMentionExtractionStage = createClaimMentionExtractionStage(
        resolveLlmStageOptions(
            STAGE_IDS.claimMentionExtraction,
            CLAIM_MENTION_EXTRACTION_STAGE_DEFAULTS,
            llm
        )
    )
    const citationSourceDetectionStage = createCitationSourceDetectionStage(
        resolveLlmStageOptions(
            STAGE_IDS.citationSourceDetection,
            CITATION_SOURCE_DETECTION_STAGE_DEFAULTS,
            llm
        )
    )
    const axiomIndicatorDetectionStage = createAxiomIndicatorDetectionStage(
        resolveLlmStageOptions(
            STAGE_IDS.axiomIndicatorDetection,
            AXIOM_INDICATOR_DETECTION_STAGE_DEFAULTS,
            llm
        )
    )
    const canonicalizationStage = createClaimCanonicalizationStage(
        extension,
        resolveLlmStageOptions(
            STAGE_IDS.claimCanonicalization,
            CLAIM_CANONICALIZATION_STAGE_DEFAULTS,
            llm
        )
    )
    const claimTypeClassificationStage = createClaimTypeClassificationStage(
        resolveLlmStageOptions(
            STAGE_IDS.claimTypeClassification,
            CLAIM_TYPE_CLASSIFICATION_STAGE_DEFAULTS,
            llm
        )
    )
    const relationExtractionStage = createRelationExtractionStage(
        resolveLlmStageOptions(
            STAGE_IDS.relationExtraction,
            RELATION_EXTRACTION_STAGE_DEFAULTS,
            llm
        )
    )
    const conclusionSelectionStage = createConclusionSelectionStage(
        resolveLlmStageOptions(
            STAGE_IDS.conclusionSelection,
            CONCLUSION_SELECTION_STAGE_DEFAULTS,
            llm
        )
    )
    const stages: readonly TStage<unknown>[] = [
        segmentationStage,
        claimMentionExtractionStage,
        citationSourceDetectionStage,
        axiomIndicatorDetectionStage,
        canonicalizationStage,
        claimTypeClassificationStage,
        claimReferenceValidationStage,
        variableAssignmentStage,
        relationExtractionStage,
        conclusionSelectionStage,
        formulaCompilationStage,
        formulaValidationStage,
    ] as readonly TStage<unknown>[]

    return {
        id: PIPELINE_ID,
        version: PIPELINE_VERSION,
        inputSchema: INGESTION_INPUT_SCHEMA,
        // The pipeline's advertised `outputSchema` is the extension's
        // raw `responseSchema` (the LLM-shaped response). Finalize
        // also attaches a `processingFailures` slot at runtime; the
        // asymmetry mirrors v1's contract.
        outputSchema: extension.responseSchema,
        stages,
        finalize: {
            dependsOn: [
                STAGE_IDS.claimCanonicalization,
                STAGE_IDS.variableAssignment,
                STAGE_IDS.formulaCompilation,
                optional(STAGE_IDS.claimTypeClassification),
                optional(STAGE_IDS.relationExtraction),
                optional(STAGE_IDS.conclusionSelection),
                optional(STAGE_IDS.formulaValidation),
                optional(STAGE_IDS.claimReferenceValidation),
                // Read only for the source anchors finalize attaches to
                // claims; a missing segmentation or mention output costs
                // the anchors, never the argument.
                optional(STAGE_IDS.segmentation),
                optional(STAGE_IDS.claimMentionExtraction),
            ],
            run: (ctx) =>
                finalizeResponseV2({
                    ctx,
                    extension,
                    segmentation: ctx.get<TSegmentationOutput>(
                        STAGE_IDS.segmentation
                    ),
                    mentions: ctx.get<TClaimMentionExtractionOutput>(
                        STAGE_IDS.claimMentionExtraction
                    ),
                }),
        },
    }
}
