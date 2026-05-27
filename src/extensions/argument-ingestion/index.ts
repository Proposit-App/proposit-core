// Barrel for the argument-ingestion extension.
//
// Exposes the v1 single-shot pipeline factory + the v2 multi-stage
// pipeline factory + the default `basicsExtension`. The shared
// `TIngestionExtension` descriptor is forward-compatible across both
// pipelines.

export {
    createIngestionV1Pipeline,
    V1_PARSE_STAGE_ID,
} from "./v1-single-shot.js"
export type { TCreateIngestionV1PipelineOptions } from "./v1-single-shot.js"
export { createIngestionV2Pipeline } from "./v2-multi-stage.js"
export type { TCreateIngestionV2PipelineOptions } from "./v2-multi-stage.js"
export { resolveLlmStageOptions } from "./shared/resolve-llm-stage-options.js"
export { basicsExtension } from "./shared/basics-extension.js"
export type {
    TIngestionExtension,
    TIngestionInput,
    TIngestionLlmOptions,
    TLlmStageOptionsOverride,
} from "./shared/types.js"
export { finalizeResponse } from "./shared/finalize-response.js"
export type { TFinalizeResponseInput } from "./shared/finalize-response.js"
export {
    finalizeResponseV2,
    FINALIZE_V2_FAILURE_TEXTS,
} from "./shared/finalize-response-v2.js"
export type { TFinalizeResponseV2Input } from "./shared/finalize-response-v2.js"
export { deriveRoles } from "./shared/role-derivation.js"
export type { TClaimRole, TDeriveRolesInput } from "./shared/role-derivation.js"
// Per-stage exports — surfaced for consumers (e.g. observability
// bridges) that want to key on stage ids without re-stringifying.
export * from "./stages/index.js"
