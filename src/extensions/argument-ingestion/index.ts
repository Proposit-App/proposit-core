// Barrel for the argument-ingestion extension.
//
// Exposes the v1 single-shot pipeline factory + the default
// `basicsExtension`. v2 (Phase 2 / slice 2A) will add
// `createIngestionV2Pipeline` alongside the v1 entry-point; the
// `TIngestionExtension` descriptor is forward-compatible across both.

export { createIngestionV1Pipeline } from "./v1-single-shot.js"
export type { TCreateIngestionV1PipelineOptions } from "./v1-single-shot.js"
export { basicsExtension } from "./shared/basics-extension.js"
export type { TIngestionExtension, TIngestionInput } from "./shared/types.js"
export { finalizeResponse } from "./shared/finalize-response.js"
export type { TFinalizeResponseInput } from "./shared/finalize-response.js"
export { deriveRoles } from "./shared/role-derivation.js"
export type { TClaimRole, TDeriveRolesInput } from "./shared/role-derivation.js"
