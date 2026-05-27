# Upcoming changelog

Commit range: `v1.3.0..HEAD`.

## Fixed

- **`createIngestionV2Pipeline` segmentation truncation on large
  inputs.** Two coupled fixes for the deterministic failure pattern
  reported against a 15.5 KB Singer fixture: (1) the OpenAI
  `Responses` provider now inspects `envelope.status` and throws
  `TransientLlmError` when the API returns `"incomplete"`, naming
  the `incomplete_details.reason` in the message — previously a
  truncated `output_text` was fed to `safeParseJson` and surfaced
  as `SchemaValidationLlmError: Unterminated string in JSON at
position N`; (2) the segmentation stage now ships an internal
  `maxOutputTokens` default (`SEGMENTATION_MAX_OUTPUT_TOKENS =
8192`) sized for typical long-form inputs. The provider-side
  detection covers any stage that hits an output cap; the stage-side
  default prevents the specific Singer reproducer from firing in the
  first place.

## Added

- `TLlmStageOptionsOverride` + `TIngestionLlmOptions` shapes in
  `src/extensions/argument-ingestion/shared/types.ts` and a
  `resolveLlmStageOptions(stageId, internalDefault, options?)`
  helper in `shared/resolve-llm-stage-options.ts`. Composes the
  three-layer precedence chain (stage-override > pipeline-default >
  internal stage default) for `maxOutputTokens` and
  `reasoningEffort`.
- `TCreateIngestionV2PipelineOptions` with `llm?: TIngestionLlmOptions`
  on `createIngestionV2Pipeline(extension, options?)`. Threads
  overrides through each of the 8 LLM stages in the v2 DAG.
- `TCreateIngestionV1PipelineOptions.llm?: TIngestionLlmOptions` on
  `createIngestionV1Pipeline(extension, options?)`. v1 has a single
  LLM stage (`V1_PARSE_STAGE_ID === "parse-argument"`) — both
  `defaults` and an entry under `overrides[V1_PARSE_STAGE_ID]` apply
  to it.
- `createXxxStage(options?)` factories on each LLM stage:
  `createSegmentationStage`, `createClaimMentionExtractionStage`,
  `createCitationSourceDetectionStage`,
  `createAxiomIndicatorDetectionStage`,
  `createClaimCanonicalizationStage(extension, options?)` (extended
  with second arg), `createClaimTypeClassificationStage`,
  `createRelationExtractionStage`,
  `createConclusionSelectionStage`. Each stage's internal-default
  knobs are exported as `XXX_STAGE_DEFAULTS` for callers composing
  options manually.
- `V1_PARSE_STAGE_ID` constant export from
  `src/extensions/argument-ingestion/v1-single-shot.ts` and the
  argument-ingestion barrel — the stage-id key for v1's `overrides`
  entry.
- `src/lib/pipelines/debug-log.ts` — opt-in structured logging
  module. Exports `PROPOSIT_PIPELINE_DEBUG_ENV_VAR`,
  `PROPOSIT_PIPELINE_DEBUG_PREFIX`, `isDebugEnabled`, and helpers
  `debugPipelineStart` / `debugPipelineEnd` / `debugStageStart` /
  `debugStageEnd` / `debugLlmRequest` / `debugLlmResponse` /
  `debugLlmFailure`. Gate is checked per call so toggling the env
  var mid-process works; gate uses a `globalThis.process?.env`
  indirection so it stays browser-safe.
- `src/lib/pipelines/execute.ts` wires `debugPipelineStart` /
  `debugPipelineEnd` / `debugStageStart` / `debugStageEnd` into the
  executor's event loop (alongside the existing `emit(...)` calls;
  no behavior change to `TPipelineEvent` consumers).
- `src/extensions/openai/provider.ts` wires `debugLlmRequest` /
  `debugLlmResponse` / `debugLlmFailure` around the per-round
  Responses API call. `debugLlmFailure` is also fired on the
  incomplete-envelope path with a 2 KB-capped dump of the truncated
  `output_text`.
- `src/extensions/openai/types.ts`: `TOpenAiResponsesEnvelope` gains
  `status?: string` and `incomplete_details?: { reason?: string }`
  to model the truncation-detection fields.
- New tests:
    - `test/extensions/openai/provider.test.ts` — two cases pinning
      `TransientLlmError` on `status: incomplete`, with the cap
      reason in the message.
    - `test/extensions/argument-ingestion/stages/segmentation-live.test.ts`
      — opt-in live-LLM regression against Singer's "Solution to
      World Poverty" (`OPENAI_API_KEY` + `RUN_LIVE_LLM_TESTS=1`).
    - `test/extensions/argument-ingestion/fixtures-live/singer-solution/input.txt`
      — the fixture text, copied from
      `proposit-server/public/debug-samples/`.
    - `test/extensions/argument-ingestion/llm-options-overrides.test.ts`
      — 9 unit tests pinning `resolveLlmStageOptions` precedence and
      the factory-to-LLM-request threading on both v1 and v2 pipelines.
    - `test/pipelines-debug-log.test.ts` — 8 unit tests covering the
      env-var truth table, the no-op-when-disabled invariant, and the
      pipeline + provider emission shapes.

## Changed

- Backward-compatible default-options consts (`segmentationStage`,
  `claimMentionExtractionStage`, etc.) are retained — they now alias
  `createXxxStage()` calls so existing consumers see the new
  internal defaults (notably the segmentation cap).
- The argument-ingestion barrel
  (`src/extensions/argument-ingestion/index.ts`) and the lib root
  barrel (`src/lib/index.ts`) re-export the new types
  (`TCreateIngestionV2PipelineOptions`, `TIngestionLlmOptions`,
  `TLlmStageOptionsOverride`), the helper (`resolveLlmStageOptions`),
  and the v1 stage-id constant (`V1_PARSE_STAGE_ID`).
- The pipeline barrel (`src/lib/pipelines/index.ts`) re-exports the
  debug-log helpers and the env-var-name + prefix constants.

## Tooling (from earlier in the cycle, pre-fix)

- `.githooks/pre-push` hook — verifies Prettier formatting before a
  push. Checks only the files added/modified on the current branch
  relative to its counterpart on the remote being pushed to
  (three-dot diff, `--diff-filter=ACMR`), falling back to
  `prettier --check .` when that comparison point can't be resolved
  (new/unpushed branch, missing remote ref, detached HEAD). Respects
  `.prettierignore`. Bypass once with `git push --no-verify`.
- `prepare` package script — runs
  `git config core.hooksPath .githooks` on install so the pre-push
  hook activates automatically after `pnpm install`.

## Removed

- `postinstall` package script (`prettier -w package.json
pnpm-lock.yaml`). Removing it means installing
  `@proposit/proposit-core` as a dependency no longer triggers
  pnpm's `Ignored build scripts: @proposit/proposit-core` warning —
  `prepare` is not an install lifecycle script and never runs for
  registry consumers. Formatting is now verified at push time by the
  pre-push hook rather than auto-fixed at install time; run
  `pnpm prettify` to fix formatting manually.
