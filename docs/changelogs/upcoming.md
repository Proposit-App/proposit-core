# Upcoming changelog

Commit range: `v1.6.0..HEAD`.

## Docs

- `docs/api-reference.md`: added a "Pipeline & providers" section documenting the previously-undocumented public surface that has shipped since 1.1.0 — the abstract `TLlmProvider` interface (`respond<T>`, `TLlmRequest`/`TLlmResponse`/`TToolSpec`, free-form `model`), the pipeline framework (`executePipeline`, `TPipeline`/`TStage`/`TStageContext`/`TProcessingFailure`/`TPipelineResult`/`TPipelineEvent`, `DEFAULT_RETRY_POLICY`, and the `failure-codes.ts` constants), the two concrete providers as subpath exports (`extensions/openai` production default + `extensions/ollama` dev-only), and the ingestion factories (`createIngestionV1Pipeline` / `createIngestionV2Pipeline` + `basicsExtension`) with the `TIngestionLlmOptions` / `TLlmStageOptionsOverride` options seam and the new `model?` knob. Docs-only — no `src/` change.
