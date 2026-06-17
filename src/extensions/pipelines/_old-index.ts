// Barrel for the argument-ingestion extension.
//
// Exposes the v1 single-shot pipeline factory + the v2 multi-stage
// pipeline factory + the default `basicsExtension`. The shared
// `TIngestionExtension` descriptor is forward-compatible across both
// pipelines.

export {
    createIngestionV1Pipeline,
    V1_PARSE_STAGE_ID,
} from "./ingestion/_v1-single-shot.js"
export type { TCreateIngestionV1PipelineOptions } from "./ingestion/_v1-single-shot.js"
export { createIngestionV2Pipeline } from "./ingestion/scholar/scholar.js"
export type { TCreateIngestionV2PipelineOptions } from "./ingestion/scholar/scholar.js"
export { resolveLlmStageOptions } from "./base/resolve-llm-stage-options.js"
export { basicsExtension } from "./base/basics-extension.js"
export type {
    TIngestionExtension,
    TIngestionInput,
    TIngestionLlmOptions,
    TLlmStageOptionsOverride,
} from "./base/types.js"
export { finalizeResponse } from "./base/finalize-response.js"
export type { TFinalizeResponseInput } from "./base/finalize-response.js"
export {
    finalizeResponseV2,
    FINALIZE_V2_FAILURE_TEXTS,
} from "./base/finalize-response-v2.js"
export type { TFinalizeResponseV2Input } from "./base/finalize-response-v2.js"
export { deriveRoles } from "./base/role-derivation.js"
export type { TClaimRole, TDeriveRolesInput } from "./base/role-derivation.js"
// Per-stage exports — surfaced for consumers (e.g. observability
// bridges) that want to key on stage ids without re-stringifying.
export * from "./base/stages/index.js"
