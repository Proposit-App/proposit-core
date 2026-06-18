# v2.1.0 changelog

> **⚠️ BREAKING (shipped as a minor):** despite the minor version bump, this release breaks the ingestion public API. The argument-ingestion extension was relocated to `src/extensions/pipelines/` and now ships on two new package subpaths (`./pipelines/base`, `./pipelines/ingestion`) instead of the package root; the multi-stage factory was renamed `createScholarPipeline`; the single-shot pipeline + `finalizeResponse` were removed; and the pipeline-id wire strings changed. Consumers must update imports — see the release notes "Upgrading" section.

Commit range: `v2.0.0..HEAD`.

## Added

- New `@proposit/proposit-core/pipelines/ingestion` subpath exporting `createScholarPipeline` (+ `TCreateScholarPipelineOptions`) and the new `createScribePipeline` (+ `TCreateScribePipelineOptions`).
- New `@proposit/proposit-core/pipelines/base` subpath exporting the shared one-shot ingestion task contract + helpers: `finalizeResponseV2` / `FINALIZE_V2_FAILURE_TEXTS` / `TFinalizeResponseV2Input`, `resolveLlmStageOptions`, `basicsExtension`, `deriveRoles` (+ `TClaimRole` / `TDeriveRolesInput`), the ingestion-type seam (`TIngestionExtension` / `TIngestionInput` / `TIngestionLlmOptions` / `TLlmStageOptionsOverride`), and the full stage set (`STAGE_IDS`, every stage factory/const, the stage output schemas + `*_DEFAULTS`).
- **`createScribePipeline`** — a fast, two-LLM-call ingestion pipeline (`extract` → `structure`) that feeds scholar's four deterministic stages + `finalizeResponseV2` to emit the identical `TParsedArgumentResponse`. Each combined LLM stage is paired with deterministic adapter stages that republish its output under the canonicalization / classification (from `extract`) and relation-extraction / conclusion-selection (from `structure`) slots the shared backend reads. Cheap-model default `gpt-5.4-mini`, per-stage overridable via `llm`. New `STAGE_IDS.extract` / `STAGE_IDS.scribeStructure` entries.
- Newly-public helpers (previously private), now exported from `./pipelines/base`: `buildResponseSchema(extension)` and `buildClaimRecordSchema(claimSchema)` (the per-extension canonicalization schema builders) and `selectFallbackConclusion(classifications, relations)` (the deterministic relation-graph conclusion pick). These let an alternate pipeline emit the same canonicalization shape and reproduce the same conclusion resolution.

## Notes

- `scribe` makes the existing public `isLlmStage(stage)` predicate (framework API since v1.11.1) load-bearing for out-of-process stage routing: scribe reuses scholar's stage ids (`claim-canonicalization`, `claim-type-classification`, `relation-extraction`, `conclusion-selection`) as **deterministic adapter** stages, so a router keying on a flat stage-id set would misroute them. `isLlmStage` keys on the resolved stage's LLM-config carrier and classifies them correctly (adapters → `false`, scribe's two cheap LLM stages → `true`); this contract is pinned by `test/extensions/pipelines/reuse-invariant.test.ts`. No API change — surfaced here because it is now a cross-repo routing dependency.

## Changed

- **BREAKING:** relocated `src/extensions/argument-ingestion/` → `src/extensions/pipelines/` (`base/` = the shared contract + helpers + the 12 stages, as a cross-family sibling of `ingestion/{scholar,scribe}/`). A pure move — no prompt, `STAGE_IDS`-value, or schema change; the existing scholar golden corpus passes unchanged.
- **BREAKING:** renamed `createIngestionV2Pipeline` → `createScholarPipeline` and `TCreateIngestionV2PipelineOptions` → `TCreateScholarPipelineOptions`.
- **BREAKING:** the ingestion factories + helpers are no longer re-exported from the package root (`@proposit/proposit-core`); import them from the `./pipelines/base` and `./pipelines/ingestion` subpaths.
- **BREAKING:** the persisted pipeline-id wire strings changed: scholar's `PIPELINE_ID` is now `argument-ingestion-scholar` (was `argument-ingestion-v2`); scribe's is `argument-ingestion-scribe`. Records created under the old ids are not migrated.
- The `proposit-core parse` CLI now builds the scholar pipeline (was the single-shot pipeline) and accepts `--pipeline scholar|scribe` (default `scholar`); the `--model` flag now threads through `llm.defaults.model`. The previous `--pipeline v1|v2` handling is gone, and the CLI now handles a degraded (`argument: null`) finalize result as a live path.
- Added `./pipelines/base` + `./pipelines/ingestion` to `package.json` `exports` and `typedoc.json` entry points (ingestion previously had no subpath export and no generated API docs).

## Removed

- **BREAKING:** removed the single-shot ingestion pipeline: `createIngestionV1Pipeline`, `V1_PARSE_STAGE_ID`, `TCreateIngestionV1PipelineOptions`, and the `finalizeResponse` / `TFinalizeResponseInput` helper (only the single-shot pipeline used it; `finalizeResponseV2` stays).

## Tests

- Relocated the ingestion test tree to `test/extensions/pipelines/`; deleted the v1 golden driver, the v1 unit suite, and the v1 fixtures (`recorded-llm.json` / `expected.json` per case); the scholar (`v2-*`) goldens are unchanged.
- Added `scribe.test.ts` (happy path with a compiled+validated formula; empty-claim → valid `argument: null`; an unresolvable conclusion → `NO_SINGLE_CONCLUSION` processing failure, not a crash; the `argument-ingestion-scribe` wire id), `reuse-invariant.test.ts` (scribe reuses scholar's four deterministic stage consts by reference and populates the six finalize slots), `export-surface.test.ts` (the two subpath barrels), and `claim-canonicalization-schema.test.ts` (the exported per-extension schema builders); plus a `selectFallbackConclusion` unit test.
- Added `scribe-e2e.test.ts`, a replay-mode golden driver that stays inert until `scribe-recorded-llm.json` fixtures are recorded with a live model.
