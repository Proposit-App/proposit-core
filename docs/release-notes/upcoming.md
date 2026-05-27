# Upcoming release notes

## Fixed

- **Segmentation truncation in the v2-multi-stage ingestion pipeline.**
  Importing arguments longer than ~10 KB through `createIngestionV2Pipeline`
  could fail with `Unterminated string in JSON at position N` and produce
  `output: null`. The segmentation stage shipped without an explicit
  `maxOutputTokens` cap, so a long input legitimately produced more JSON
  than the OpenAI Responses API's default per-model cap allowed, and the
  reply came back truncated mid-string. v1.3.1 sets a generous internal
  default on the segmentation stage (8 192 tokens) and detects the
  truncated-reply case at the provider level. Pinned by a live-LLM
  regression test gated on `OPENAI_API_KEY` + `RUN_LIVE_LLM_TESTS=1`.

- **Content-filtered inputs now fail fast with a clean error.** When
  OpenAI's content policy refuses to complete an output (response
  envelope `incomplete_details.reason: "content_filter"`), the
  provider now surfaces a `NonRetryableLlmError` on the first attempt
  instead of letting the framework's default retry policy burn a
  second API call on a deterministic refusal. The error message
  names the policy refusal verbatim and tells the caller that
  retrying won't help — the actionable next step is reviewing the
  input or prompt. Output-token cap errors stay routed through the
  retryable `TransientLlmError` path with a message that points at
  the per-stage `maxOutputTokens` override knob.

## Added

- **Caller-configurable per-stage LLM knobs on both ingestion pipeline
  factories.** `createIngestionV1Pipeline` and
  `createIngestionV2Pipeline` now accept an `llm` options field with
  pipeline-level `defaults` and a per-stage `overrides` map keyed by
  stage id. The two knobs exposed today are `maxOutputTokens` and
  `reasoningEffort`. Precedence: stage-override > pipeline-default >
  internal stage default. v1 callers that hit oversized inputs can now
  raise the cap on the single `parse-argument` stage directly without
  forking the pipeline.

    ```ts
    createIngestionV2Pipeline(basicsExtension, {
        llm: {
            defaults: { maxOutputTokens: 16_384 },
            overrides: {
                [STAGE_IDS.segmentation]: { maxOutputTokens: 32_768 },
            },
        },
    })
    ```

- **Opt-in pipeline + LLM debug logging.** Set
  `PROPOSIT_PIPELINE_DEBUG=1` (or `true` / `yes`) to surface structured
  per-stage + per-LLM-call diagnostics on `console.debug` (stderr).
  Every emission is a single line prefixed with
  `[proposit/pipeline] [<event>]` followed by a JSON payload — easy to
  `grep`/`jq` from a server log. Events cover pipeline + stage
  bookends, the cumulative token usage, and (for the OpenAI provider)
  each request's model, cap, prompt lengths, response status, raw
  output length, and — on failure — a 2 KB dump of the raw text the
  model emitted before the error. Zero overhead when the env var is
  off; safe to leave wired into production code. Browser-safe (uses
  a `globalThis.process?.env` indirection, so non-Node bundles see
  the gate as permanently closed).

## Changed

- Each LLM stage in the v2-multi-stage pipeline now exposes a
  `createXxxStage(options?)` factory in addition to the existing
  `xxxStage` default-options const (e.g.
  `createSegmentationStage`, `createClaimMentionExtractionStage`,
  etc.). The default const is unchanged for backward compatibility;
  the factory is what the pipeline-level `llm.overrides` surface
  composes against. The new `V1_PARSE_STAGE_ID` export gives v1
  callers the stage-id key for their `overrides` entry.

- Installing `@proposit/proposit-core` no longer prints an "Ignored
  build scripts" warning. The package previously declared a
  `postinstall` script that existed only for the project's own
  development; pnpm flagged it on every install. That script has
  been removed, so installs are now clean.
