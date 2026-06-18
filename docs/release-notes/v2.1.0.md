# v2.1.0 release notes

> ## ⚠️ Breaking changes (shipped as a minor)
>
> **This release contains breaking changes even though the version is a minor bump.** Update your imports before upgrading — the ingestion pipeline factories were renamed, moved off the package root onto new `./pipelines/*` subpaths, the old single-shot pipeline + its `finalizeResponse` helper were removed, and the persisted pipeline identifiers changed. See "Upgrading" below for the exact replacements.

## Ingestion

- **There are now two ways to import an argument: thorough and fast.** The thorough pipeline (now called **scholar**) is the same multi-stage import as before — it reads the text in many careful passes. The new **scribe** pipeline does the same job in two quick, cheaper model calls and produces the exact same structured result, so a caller can pick fast-and-cheap or thorough without anything downstream changing. Both turn raw text into the same parsed-argument shape.
- **The import pipelines now live on their own import paths.** The factories are no longer reachable from the package root. Import `createScholarPipeline` / `createScribePipeline` from `@proposit/proposit-core/pipelines/ingestion`, and the shared building blocks (the default extension, the response assembler, the per-stage building blocks) from `@proposit/proposit-core/pipelines/base`.
- **The old single-shot import pipeline was removed.** It was superseded by the multi-stage scholar pipeline and is gone, along with its one-shot response helper.

## Upgrading

- Replace `createIngestionV2Pipeline(...)` with `createScholarPipeline(...)` and import it from `@proposit/proposit-core/pipelines/ingestion` (it is no longer exported from the package root).
- Replace any `createIngestionV1Pipeline(...)` usage with `createScholarPipeline(...)` (the thorough pipeline) or `createScribePipeline(...)` (the fast one). The single-shot factory and the `finalizeResponse` helper no longer exist.
- Import `basicsExtension`, `finalizeResponseV2`, `resolveLlmStageOptions`, and the stage helpers from `@proposit/proposit-core/pipelines/base` instead of the package root.
- If you persist or display the pipeline identifier, note it changed: `argument-ingestion-v2` is now `argument-ingestion-scholar`, and the new fast pipeline reports `argument-ingestion-scribe`. Records created under the old identifiers are not rewritten.
- The `proposit-core parse` CLI now runs the scholar pipeline by default; pass `--pipeline scribe` for the fast import. (The `--pipeline v1`/`v2` values are gone.)
