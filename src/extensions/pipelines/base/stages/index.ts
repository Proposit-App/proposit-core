// Barrel for the 12 shared ingestion stages + the per-extension
// canonicalization schema builders and the fallback-conclusion helper
// (reused by alternate pipelines that produce the same stage slots).

export { STAGE_IDS } from "./schemas.js"
export * from "./schemas.js"

export {
    segmentationStage,
    createSegmentationStage,
    SEGMENTATION_MAX_OUTPUT_TOKENS,
    SEGMENTATION_STAGE_DEFAULTS,
} from "./segmentation.js"
export {
    claimMentionExtractionStage,
    createClaimMentionExtractionStage,
    CLAIM_MENTION_EXTRACTION_STAGE_DEFAULTS,
} from "./claim-mention-extraction.js"
export {
    citationSourceDetectionStage,
    createCitationSourceDetectionStage,
    CITATION_SOURCE_DETECTION_STAGE_DEFAULTS,
} from "./citation-source-detection.js"
export {
    axiomIndicatorDetectionStage,
    createAxiomIndicatorDetectionStage,
    AXIOM_INDICATOR_DETECTION_STAGE_DEFAULTS,
} from "./axiom-indicator-detection.js"
export {
    createClaimCanonicalizationStage,
    CLAIM_CANONICALIZATION_STAGE_DEFAULTS,
    buildResponseSchema,
    buildClaimRecordSchema,
} from "./claim-canonicalization.js"
export {
    claimTypeClassificationStage,
    createClaimTypeClassificationStage,
    CLAIM_TYPE_CLASSIFICATION_STAGE_DEFAULTS,
} from "./claim-type-classification.js"
export {
    claimReferenceValidationStage,
    validateClaimReferences,
    CLAIM_REFERENCE_FAILURE_CODES,
} from "./claim-reference-validation.js"
export {
    variableAssignmentStage,
    assignVariables,
    isValidVariableSymbol,
} from "./variable-assignment.js"
export type { TAssignVariablesInput } from "./variable-assignment.js"
export {
    relationExtractionStage,
    createRelationExtractionStage,
    RELATION_EXTRACTION_STAGE_DEFAULTS,
} from "./relation-extraction.js"
export {
    conclusionSelectionStage,
    createConclusionSelectionStage,
    selectFallbackConclusion,
    CONCLUSION_SELECTION_STAGE_DEFAULTS,
    CONCLUSION_SELECTION_NO_CONCLUSION_FAILURE_CODE,
} from "./conclusion-selection.js"
export {
    formulaCompilationStage,
    compileFormulas,
    FORMULA_COMPILATION_FAILURE_CODES,
} from "./formula-compilation.js"
export type {
    TCompileFormulasInput,
    TFreeformRelation,
} from "./formula-compilation.js"
export {
    formulaValidationStage,
    validateFormulas,
    FORMULA_VALIDATION_FAILURE_CODES,
} from "./formula-validation.js"
export type { TValidateFormulasInput } from "./formula-validation.js"
