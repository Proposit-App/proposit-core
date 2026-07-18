# Spec

Authoritative detail: the adopted `initial-request.md` (this folder) and the
root epic `2026-07-18-shared-derived-view-layer-core-barrel-hygiene`.

## New public surface

- **Subpath `@proposit/proposit-core/pipelines/scheduling`** (framework, from
  `src/lib/pipelines/scheduling.ts`) — pure, descriptor-based DAG eligibility so
  a consumer driving the DAG out-of-process (server's DB-backed advancer) need
  not re-implement it:
  - `isStageEligible(stage, records)`
  - `hasRequiredFailureUpstream(stage, records)`
  - `computeDagProgress(stages, records)`
  - types `TStageDescriptor`, `TDagProgress`; re-exports `TDepSpec`,
    `TOptionalDep`, `depId`, `isOptionalDep`.
- **Existing subpath `@proposit/proposit-core/pipelines/ingestion`** gains the
  canonical ordered stage-id lists (owned by the pipeline factories):
  - `INGESTION_SCHOLAR_STAGE_IDS`, `INGESTION_SCRIBE_STAGE_IDS`
  - `getCanonicalStageIds(pipelineId)`

## Removed from the root barrel (`src/lib/index.ts`) — BREAKING

- `createOpenAiResponsesProvider`, `TCreateOpenAiResponsesProviderOptions`,
  `TOpenAiFetch`, and the OpenAI error classes (`NonRetryableLlmError`,
  `QuotaExhaustedLlmError`, `RateLimitLlmError`, `SchemaValidationLlmError`,
  `ToolLoopExhaustedError`, `TransientLlmError`) — still at
  `@proposit/proposit-core/extensions/openai`.
- `createReviewTurn`, `createSimulateTurn`, `createDistillTurn`,
  `TDistillTurnOptions`, `TDistillOutput` — still at
  `@proposit/proposit-core/builder`.

## Taxonomy

Retire the "Argument Ingestion" Feature (`docs/taxonomy/argument-ingestion`).
Keep "Argument Builder". Pipeline code unchanged.
