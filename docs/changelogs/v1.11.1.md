# Upcoming changelog

Commit range: `v1.11.0..HEAD`.

## Pipeline framework

- Add public `isLlmStage(stage): boolean` predicate over the package-internal `readLlmStageConfig`, exported from the pipelines barrel and the package root. Returns `true` iff the stage carries the `llmStage` config carrier (and is therefore driven by `launchStage` / `completeStage`); `false` for deterministic and sub-pipeline stages. Mirrors the `requireLlmStage` guard so an out-of-process orchestrator can route each stage without an external stage-id allowlist or catching `PipelineConfigurationError`. No behavior change to existing exports. (`src/lib/pipelines/stage-helpers.ts`, `src/lib/pipelines/index.ts`, `src/lib/index.ts`)
- Test: `test/extensions/argument-ingestion/is-llm-stage.test.ts` asserts the predicate per stage of the default `argument-ingestion-v2` pipeline, pins the `conclusion-selection` inner-`llmStage`-returns-a-literal case to `false`, and proves the predicate agrees with the `launchStage` guard for every stage.
- Docs: `docs/api-reference.md` gains an `isLlmStage` entry under the pipeline section.
