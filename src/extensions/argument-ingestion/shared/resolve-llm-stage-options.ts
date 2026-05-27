// Shared resolver for per-stage LLM-knob options.
//
// The ingestion pipelines (`createIngestionV1Pipeline`,
// `createIngestionV2Pipeline`) expose a `TIngestionLlmOptions`
// surface with pipeline-level `defaults` + per-stage `overrides`.
// Each LLM stage in turn carries its own *internal default* — the
// model + effort + token cap the stage author picked for typical
// inputs. The two surfaces compose via this resolver: stage-level
// override > pipeline-default > internal stage default.

import type { TIngestionLlmOptions, TLlmStageOptionsOverride } from "./types.js"

/**
 * Resolve the final per-stage LLM knobs.
 *
 * @param stageId — the stage's id (e.g. `"segmentation"`). Used to
 *                  pick the right entry from `options.overrides`.
 * @param internalDefault — the stage's built-in defaults; takes
 *                  effect for any knob not set by `options.defaults`
 *                  or `options.overrides[stageId]`.
 * @param options — the caller's pipeline-level options surface.
 *                  May be `undefined`, in which case the resolver
 *                  returns `internalDefault` verbatim.
 *
 * The merge is shallow per-field. A missing field at higher
 * precedence does not blank out a lower-precedence value — it
 * simply doesn't override.
 */
export function resolveLlmStageOptions(
    stageId: string,
    internalDefault: TLlmStageOptionsOverride,
    options?: TIngestionLlmOptions
): TLlmStageOptionsOverride {
    const pipelineDefault = options?.defaults ?? {}
    const perStage = options?.overrides?.[stageId] ?? {}
    const resolved: TLlmStageOptionsOverride = { ...internalDefault }
    if (pipelineDefault.maxOutputTokens !== undefined) {
        resolved.maxOutputTokens = pipelineDefault.maxOutputTokens
    }
    if (pipelineDefault.reasoningEffort !== undefined) {
        resolved.reasoningEffort = pipelineDefault.reasoningEffort
    }
    if (perStage.maxOutputTokens !== undefined) {
        resolved.maxOutputTokens = perStage.maxOutputTokens
    }
    if (perStage.reasoningEffort !== undefined) {
        resolved.reasoningEffort = perStage.reasoningEffort
    }
    return resolved
}
