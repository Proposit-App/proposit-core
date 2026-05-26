// v2 multi-stage ingestion pipeline.
//
// Composes the 12 stages defined under `./stages/` into a single
// `TPipeline<TIngestionInput, TParsedArgumentResponse>` whose `finalize`
// assembles the same response shape v1 emits. Same output shape +
// extension parameterization as `createIngestionV1Pipeline` — consumers
// can swap the two factories without changing downstream parsing.
//
// DAG (spec §7.2):
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
    axiomIndicatorDetectionStage,
    citationSourceDetectionStage,
    claimMentionExtractionStage,
    claimReferenceValidationStage,
    claimTypeClassificationStage,
    conclusionSelectionStage,
    createClaimCanonicalizationStage,
    formulaCompilationStage,
    formulaValidationStage,
    relationExtractionStage,
    segmentationStage,
    variableAssignmentStage,
} from "./stages/index.js"
import { optional } from "../../lib/pipelines/index.js"
import type { TPipeline, TStage } from "../../lib/pipelines/index.js"
import type { TParsedArgumentResponse } from "../../lib/parsing/index.js"
import { finalizeResponseV2 } from "./shared/finalize-response-v2.js"
import type { TIngestionExtension, TIngestionInput } from "./shared/types.js"

const PIPELINE_ID = "argument-ingestion-v2"
const PIPELINE_VERSION = "1.0.0"

const INGESTION_INPUT_SCHEMA = Type.Object({
    text: Type.String({ minLength: 1 }),
})

/**
 * Build the v2 multi-stage ingestion pipeline for the supplied
 * extension. Returns a `TPipeline` whose stages match the 12-stage
 * DAG defined in spec §7.2 and whose `finalize` assembles the same
 * `TParsedArgumentResponse` shape `ArgumentParser.build()` consumes.
 *
 * The factory is pure: it constructs stage values + a pipeline
 * descriptor and returns immediately. Stage execution happens inside
 * `executePipeline`.
 */
export function createIngestionV2Pipeline(
    extension: TIngestionExtension
): TPipeline<TIngestionInput, TParsedArgumentResponse> {
    const canonicalizationStage = createClaimCanonicalizationStage(extension)
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
            ],
            run: (ctx) => finalizeResponseV2({ ctx, extension }),
        },
    }
}
