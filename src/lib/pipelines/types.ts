// Pipeline framework primitives — shared types for the executor,
// stage helpers, and consumers.
//
// Type aliases use the repo's T-prefixed PascalCase convention
// (enforced by `@typescript-eslint/naming-convention`); the public
// vocabulary maps to the spec's unprefixed names as follows:
//
//   spec name        ↔  repo type
//   ---------------     -------------------
//   Stage<TOutput>      TStage<TOutput>
//   Pipeline<TIn,TOut>  TPipeline<TInput, TOutput>
//   StageContext        TStageContext
//   ProcessingFailure   TProcessingFailure
//   PipelineResult<T>   TPipelineResult<TOutput>
//   PipelineEvent       TPipelineEvent
//   DepSpec             TDepSpec
//   OptionalDep         TOptionalDep
//
// Helper functions (`optional`, `executePipeline`, …) keep their
// spec-spelled camelCase names since they are values, not types.

import type { TSchema } from "typebox"
import type { TLlmProvider, TLlmTokenUsage } from "../llm/types.js"

// -- Dependency-specification union --

// `__optional` is a sentinel discriminant that distinguishes the
// optional-dep wrapper from a bare stage id string. The double
// underscore is intentional — it signals "framework-private,
// don't read this directly; use `isOptionalDep`".
export type TOptionalDep = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    readonly __optional: true
    readonly id: string
}

export type TDepSpec = string | TOptionalDep

/**
 * Wrap a stage id as an optional dependency. Optional upstream
 * outcomes never propagate as skips: the depending stage runs even
 * when the upstream skipped or failed, but `ctx.get` returns
 * `undefined` for that id.
 */
export function optional(id: string): TOptionalDep {
    return { __optional: true, id }
}

export function isOptionalDep(dep: TDepSpec): dep is TOptionalDep {
    return typeof dep !== "string" && dep.__optional === true
}

export function depId(dep: TDepSpec): string {
    return typeof dep === "string" ? dep : dep.id
}

// -- Stage outcome + context --

export type TStageStatus = "completed" | "skipped" | "failed"

export type TStageContext = {
    input: unknown
    get<T>(stageId: string): T | undefined
    stageStatus(stageId: string): TStageStatus
    llm: TLlmProvider
    generateId: () => string
    signal: AbortSignal
    emit: (event: TPipelineEvent) => void
    addFailure: (failure: Omit<TProcessingFailure, "stage">) => void
}

// -- Stage --

export type TStage<TOutput> = {
    id: string
    dependsOn: readonly TDepSpec[]
    outputSchema: TSchema
    run: (ctx: TStageContext) => Promise<TOutput>
}

// -- Pipeline --

export type TPipelineFinalize<TOutput> = {
    dependsOn: readonly TDepSpec[]
    run: (ctx: TStageContext) => TOutput
}

export type TPipeline<TInput, TOutput> = {
    id: string
    version: string
    inputSchema: TSchema
    outputSchema: TSchema
    stages: readonly TStage<unknown>[]
    finalize: TPipelineFinalize<TOutput>
    /** Phantom field so `TInput` participates in inference. */
    // eslint-disable-next-line @typescript-eslint/naming-convention
    _inputTypeMarker?: TInput
}

// -- Failures --

export type TProcessingFailure = {
    stage: string
    code: string
    message: string
    severity: "warning" | "error"
    context?: Record<string, unknown>
}

// -- Result --

export type TPipelineResult<TOutput> = {
    output: TOutput | null
    failures: TProcessingFailure[]
    stageOutcomes: Record<string, TStageStatus>
    tokenUsage?: TLlmTokenUsage
}

// -- Events --

export type TPipelineEvent =
    | {
          kind: "pipeline:start"
          pipelineId: string
          pipelineVersion: string
          at: number
      }
    | {
          kind: "pipeline:end"
          status: "completed" | "failed"
          output: "present" | "null"
          at: number
      }
    | { kind: "stage:start"; stageId: string; at: number }
    | {
          kind: "stage:end"
          stageId: string
          status: TStageStatus
          tokenUsage?: TLlmTokenUsage
          at: number
      }
    | {
          kind: "stage:retry"
          stageId: string
          attempt: number
          reason: string
          at: number
      }
    | {
          kind: "stage:llm-call"
          stageId: string
          /** 1, 2, ... — one event per LLM-call attempt. */
          attempt: number
          /** The actual prompts sent for this attempt (the user
           *  message includes any retry-suffix appended on attempt
           *  2+ after a prior schema-validation failure). */
          prompts: { system: string; user: string }
          /** Raw LLM JSON as returned. May not conform to the
           *  stage's `outputSchema` if `validationError` is set. */
          output: unknown
          tokenUsage: TLlmTokenUsage
          /** Set iff `outputSchema` rejected this output. When the
           *  schema accepted the output the field is `undefined`. */
          validationError?: string
          at: number
      }
