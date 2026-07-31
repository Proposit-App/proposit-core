// Barrel for the shared one-shot ingestion task contract + helpers.
// Subpath: @proposit/proposit-core/pipelines/base
//
// Holds the schemas + helpers every ingestion pipeline shares: the
// finalize assembler, the extension descriptor + LLM-options types, the
// default `basicsExtension`, role derivation, and the full stage set
// (factories, STAGE_IDS, schemas, *_DEFAULTS) — including the
// per-extension canonicalization schema builders and the
// fallback-conclusion helper alternate pipelines reuse.

export {
    finalizeResponseV2,
    FINALIZE_V2_FAILURE_TEXTS,
} from "./finalize-response-v2.js"
export type { TFinalizeResponseV2Input } from "./finalize-response-v2.js"
export {
    locateSourceAnchor,
    SOURCE_ANCHOR_CONTEXT_CHARS,
} from "./source-anchors.js"
export type { TIngestionSourceAnchor } from "./source-anchors.js"
export { resolveLlmStageOptions } from "./resolve-llm-stage-options.js"
export { basicsExtension } from "./basics-extension.js"
export type {
    TIngestionExtension,
    TIngestionInput,
    TIngestionLlmOptions,
    TLlmStageOptionsOverride,
} from "./types.js"
export { deriveRoles } from "./role-derivation.js"
export type { TClaimRole, TDeriveRolesInput } from "./role-derivation.js"
// Stage factories, STAGE_IDS, schemas, *_DEFAULTS, the newly-exported
// per-extension schema builders, and the fallback-conclusion helper.
export * from "./stages/index.js"
