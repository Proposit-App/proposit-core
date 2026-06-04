# Upcoming changelog

Commit range: `v1.10.0..HEAD`.

## Added

- `executeStage(pipeline, stageId, upstream, input, deps)` — runs one stage of a pipeline against a caller-supplied map of upstream `{ outcome, output? }` records, reproducing the monolithic run's `ctx.get` / `ctx.stageStatus` semantics without re-running the DAG. Parses `input` via `Value.Parse(pipeline.inputSchema, input)` and seeds the parsed value into `ctx.input` (parity with `executePipeline`). Emits the per-stage events only (no `pipeline:*` bookends). Throws `PipelineConfigurationError` (`UNKNOWN_STAGE`) for an unknown stage id and throws a `GET_OUTSIDE_DEPS` / `STATUS_OUTSIDE_DEPS` config error out directly. Normalizes away `output` for non-`completed` upstream records and accepts a superset of records (uses the stage's own `dependsOn`).
- `executeFinalize(pipeline, upstream, input, deps)` — symmetric entry point for the multi-parent finalize step. Applies the same `finalizeRequiredOk()` gate and `FINALIZE_UNCAUGHT_ERROR` capture as `executePipeline`'s finalize; emits no events; `async` only for signature symmetry (`TPipelineFinalize.run` stays synchronous).
- New public types `TStageOutcomeRecord`, `TExecuteStageDeps`, `TExecuteStageResult`, `TExecuteFinalizeResult`, exported from `src/lib/pipelines/` and the package root.
- `UNKNOWN_STAGE` added as a member of the `PipelineConfigurationError.code` union (additive).

## Changed

- Refactored `executePipeline` to call extracted, module-level `runOneStage(stage, ctx, state)`, `runFinalize(pipeline, ctx, state)`, and `makeStageContext(state, allowedDeps, label)` with an explicit `TStageRunState` threaded through (`{ records, failures, signal, emit, generateId, llm, input, setConfigError }`) rather than closure-captured locals. `executeStage` / `executeFinalize` reuse the same bodies — one source of truth for stage and finalize execution semantics, no behavior change (the existing `executePipeline` suite stays green). The config-error disposition differs only via the `setConfigError` seam: the whole-DAG scheduler captures + re-throws after its bookends; the single-stage path throws immediately.

## Tests

- Added `executeStage` / `executeFinalize` suites to `test/pipelines.test.ts` (single-stage run, input-parse parity, `UNKNOWN_STAGE`, input-schema rejection, skipped/failed-upstream rehydration, config-error throw-out, defensive `output` normalization, superset acceptance, per-stage-only events, retry-replay event-sequence parity + token usage, finalize happy path / required-dep-not-completed / optional-dep-skipped / throwing-finalize / no-events).
- Added a JSON value round-trip assertion in `test/extensions/argument-ingestion/v2-multi-stage.test.ts` over representative values of all 12 v2 ingestion stage outputs plus a finalize output (`JSON.parse(JSON.stringify(v))` deep-equals `v`).
