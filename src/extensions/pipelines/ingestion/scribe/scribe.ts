// scribe — the fast, low-cost ingestion pipeline.
//
// Two cheap LLM calls (`extract` → `structure`) feed scholar's
// deterministic backend, producing the same `TParsedArgumentResponse`
// shape scholar emits. Each combined LLM stage is paired with
// deterministic adapter stages that republish its parts under the six
// standard stage-output slots scholar's 4 deterministic stages +
// `finalizeResponseV2` read — so that backend + finalize are reused
// verbatim (the deterministic stage consts are shared by reference).
//
// DAG:
//
//   extract ──┬─ (adapter) claim-canonicalization ─┬─ claim-reference-validation
//             └─ (adapter) claim-type-classification ┤
//                                                    └─ variable-assignment
//   structure ─┬─ (adapter) relation-extraction
//              └─ (adapter) conclusion-selection
//                                          formula-compilation
//                                          formula-validation
//                                          finalize
//
// `structure` depends on the canonicalization + classification slots,
// so `extract` (+ its adapters) runs first.

import { optional } from "../../../../lib/pipelines/index.js"
import type { TPipeline, TStage } from "../../../../lib/pipelines/index.js"
import type { TParsedArgumentResponse } from "../../../../lib/parsing/index.js"
import {
    STAGE_IDS,
    claimReferenceValidationStage,
    variableAssignmentStage,
    formulaCompilationStage,
    formulaValidationStage,
} from "../../base/stages/index.js"
import { finalizeResponseV2 } from "../../base/finalize-response-v2.js"
import { resolveLlmStageOptions } from "../../base/resolve-llm-stage-options.js"
import type {
    TIngestionExtension,
    TIngestionInput,
    TIngestionLlmOptions,
} from "../../base/types.js"
import { INGESTION_INPUT_SCHEMA } from "../scholar/scholar.js"
import {
    createExtractStage,
    createExtractCanonicalizationAdapterStage,
    extractClassificationAdapterStage,
    EXTRACT_STAGE_DEFAULTS,
} from "./extract-stage.js"
import {
    createStructureStage,
    structureRelationAdapterStage,
    structureConclusionAdapterStage,
    STRUCTURE_STAGE_DEFAULTS,
} from "./structure-stage.js"

const PIPELINE_ID = "argument-ingestion-scribe"
const PIPELINE_VERSION = "1.0.0"

/**
 * Options for `createScribePipeline`. Same `{ llm }` surface as scholar:
 * `llm.defaults` applies to both cheap LLM stages; per-stage
 * `llm.overrides` are keyed by `STAGE_IDS.extract` / `.scribeStructure`.
 */
export type TCreateScribePipelineOptions = {
    llm?: TIngestionLlmOptions
}

/**
 * Build the scribe (fast) ingestion pipeline for the supplied
 * extension: `extract` + `structure` cheap LLM calls, their
 * deterministic adapters, then scholar's 4 deterministic stages +
 * `finalizeResponseV2`. Emits the same `TParsedArgumentResponse` as
 * scholar.
 */
export function createScribePipeline(
    extension: TIngestionExtension,
    options?: TCreateScribePipelineOptions
): TPipeline<TIngestionInput, TParsedArgumentResponse> {
    const llm = options?.llm
    const extractStage = createExtractStage(
        extension,
        resolveLlmStageOptions(STAGE_IDS.extract, EXTRACT_STAGE_DEFAULTS, llm)
    )
    const extractCanonicalizationAdapterStage =
        createExtractCanonicalizationAdapterStage(extension)
    const structureStage = createStructureStage(
        resolveLlmStageOptions(
            STAGE_IDS.scribeStructure,
            STRUCTURE_STAGE_DEFAULTS,
            llm
        )
    )

    const stages: readonly TStage<unknown>[] = [
        extractStage,
        extractCanonicalizationAdapterStage,
        extractClassificationAdapterStage,
        claimReferenceValidationStage,
        variableAssignmentStage,
        structureStage,
        structureRelationAdapterStage,
        structureConclusionAdapterStage,
        formulaCompilationStage,
        formulaValidationStage,
    ] as readonly TStage<unknown>[]

    return {
        id: PIPELINE_ID,
        version: PIPELINE_VERSION,
        inputSchema: INGESTION_INPUT_SCHEMA,
        // Mirrors scholar: the advertised outputSchema is the
        // extension's response schema; finalize attaches a
        // `processingFailures` slot at runtime.
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
