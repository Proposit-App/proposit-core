# Local-LLM (Ollama) provider — proposit-core agenda

## Capability changes

**None.** This is developer/infrastructure tooling — it adds no user-facing capability. `proposit-core` is a library and carries **no `capabilities.md`**; there is no caps file to edit in this repo, and no product-layer capability is affected. (The standard "first commit updates `capabilities.md`" step does **not** apply here — skip it.)

## Goal

Let a developer run **the entire LLM-backed stack locally against Ollama (`qwen3.6:latest`)** with zero OpenAI cost. Dev/test only — **production stays on OpenAI forever.** Purely additive: a new `src/extensions/ollama/` provider implementing `TLlmProvider`, a `model?` knob on the existing per-stage options seam so the v2 ingestion pipeline can target local models, and opt-in tests. **No `src/lib/` change. OpenAI stays the default everywhere.**

Target ergonomics — after this lands, a dev runs the whole pipeline locally with:

```ts
import { OllamaProvider } from "@proposit/proposit-core/extensions/ollama"
import {
    createIngestionV2Pipeline,
    basicsExtension,
} from "@proposit/proposit-core/extensions/argument-ingestion"
import { executePipeline } from "@proposit/proposit-core"

const llm = new OllamaProvider() // http://localhost:11434
const pipeline = createIngestionV2Pipeline(basicsExtension, {
    llm: { defaults: { model: "qwen3.6:latest" } }, // note the `llm` wrapper
})
const result = await executePipeline(pipeline, { text }, { llm })
```

## Authoritative spec — READ FIRST

- **Implementation spec (authoritative, dual-reviewed + corrected):** `/Users/brian/Projects/Proposit-App/docs/superpowers/specs/2026-05-30-local-llm-ollama-provider-design.md`
- **Overview (context + non-goals):** `…/2026-05-30-local-llm-ollama-provider-overview.md`
- **Dual-review synthesis (the findings already folded into the spec — read so you don't re-introduce them):** `/Users/brian/Projects/Proposit-App/docs/reviews/proposit-core/2026-05-30-ollama-provider-spec.md`

The spec's "Grounding (verified file:line facts)" section is accurate as of 2026-05-30 (the reviewer verified it against source) — but line numbers drift, so re-confirm before editing.

## Slices (sequential: S1 → S2 → S3, one branch)

**S1 — `src/extensions/ollama/` provider extension.** Mirror the `openai/` layout (`types.ts`, `structured-output.ts`, `errors.ts`, `provider.ts`, `index.ts`). Use the **official `ollama` SDK** (a deliberate divergence from the openai provider, which actually uses raw `fetch`). Add `ollama` as an **optional peerDependency** with floor `">=0.5.0"` + `peerDependenciesMeta.ollama.optional: true`, add the `./extensions/ollama` subpath to `exports`, and add `ollama` as a **devDependency** so tests/typecheck/build resolve it (`pnpm -C /Users/brian/Projects/Proposit-App/proposit-core add -D ollama` — this changes the lockfile; expected).

**S2 — model-override seam.** Extend the EXISTING `TLlmStageOptionsOverride` (`src/extensions/argument-ingestion/shared/types.ts`) — its docstring already anticipates a `model` knob.

**S3 — opt-in integration tests + always-on deterministic units.** Env-gated live suite (`RUN_LOCAL_LLM_TESTS=1` + `:11434` reachability) + mocked-client units that run in CI. See the spec's S3 for the exact test list.

## Must-not-miss (reviewer-caught — already in the spec, called out here so they don't regress)

1. **Model-seam is a THREE-part edit per stage, not two.** The 8 LLM stage factories call `llmStage({ model: SEGMENTATION_MODEL, … })` with `model` **hard-coded as a separate argument that is NOT read from `options`**. You must (a) add `model?` to `TLlmStageOptionsOverride`; (b) add two clauses to `resolveLlmStageOptions`; (c) in **each** of the 8 factories, add the model const to its `*_STAGE_DEFAULTS` AND change the `model:` line to read the resolved value (`options?.model ?? STAGE_CONST`). **Omitting (c) makes the override a silent no-op.** Add a test asserting an override actually reaches the built `llmStage`.
2. **The factory options wrap under `llm`:** `{ llm: { defaults, overrides } }` (`TCreateIngestionV2PipelineOptions`), not bare `{ defaults }`.
3. **Context-overflow / eval errors → strictly `NonRetryableLlmError`, NEVER `SchemaValidationLlmError`** (the latter is tagged `transient` and WOULD be retried — a guaranteed-failing second attempt). `classifyOllamaError` must also map `ECONNREFUSED`→NonRetryable, 404-model-not-pulled→NonRetryable, `ECONNRESET`/socket-drop→Transient, cold-VRAM-load 5xx→Transient.
4. **Errors live in `extensions/openai/errors.ts`, NOT `src/lib/`** — the framework classifies by the `retryReason` string tag (codes are SDK-free in `src/lib/pipelines/failure-codes.ts`). Define your OWN `ollama/errors.ts` carrying the same tags + importing the lib codes. Do **not** import from `extensions/openai/` and do **not** change `src/lib/`.
5. **Own structured-output converter** (`typeboxToJsonSchema`) producing STANDARD JSON schema — `Type.Optional` → key OMITTED from `required`, NO forced `additionalProperties:false`. Do **not** reuse / rename `typeboxToOpenAiSchema`. Build the `format` schema and any prompt-injected copy from the one converted object.
6. `tokenUsage`: `prompt_eval_count`→`input`, `eval_count`→`output`, `reasoning` unset, `rawResponseId` left **undefined**. `maxOutputTokens`→`num_predict` (never `0`). `reasoningEffort` ignored by the Ollama provider. Honor `signal`. Missing-`ollama`-package → throw a clear actionable error.

## The one load-bearing unknown (resolve via TDD)

Does `qwen3.6` reliably honor the `format` JSON schema on a representative ingestion-stage schema? Confirm empirically in the opt-in live structured-output smoke. If a strict fold turns out necessary for reliability, add it to the **Ollama** converter (don't reuse the OpenAI one) and flag it in your hand-back. The framework's existing local TypeBox check + one schema-retry is the safety net.

## Method (rigid — superpowers baseline)

- Invoke `superpowers:using-superpowers` at session start. Apply `test-driven-development` (FAILING TEST FIRST for every unit), `systematic-debugging` before any fix, `verification-before-completion` before claiming done. Use `writing-plans` to turn this spec into your task plan before touching code. All TypeScript work follows the `brain-style` skill; verify types with the LSP tool.
- **Deterministic units run in CI; the live Ollama suite is opt-in and must never gate CI.** Write the deterministic units (converter, `classifyOllamaError`, provider against a mocked `ollama` client, the model-seam-reaches-`llmStage` guard) test-first.
- Keep the full suite green: `pnpm -C /Users/brian/Projects/Proposit-App/proposit-core run check` (typecheck + lint + test + build). Paste the tail in your hand-back.
- Update `docs/changelogs/upcoming.md` (commit-hash range) and `docs/release-notes/upcoming.md` (plain-language) per core's documentation-sync; also update the `CLAUDE.md` "Pipeline framework" section (add the Ollama provider + the `model` knob) and `docs/api-reference.md` (new `OllamaProvider` + `model` on `TLlmStageOptionsOverride`).

## Environment notes (orchestrator-learned)

- You are likely spawned with the workspace-root CWD and `cd` may not persist across calls. Use **absolute `-C` / `--prefix` forms** for every `pnpm`/`git` command (e.g. `pnpm -C /Users/brian/Projects/Proposit-App/proposit-core run check`, `git -C /Users/brian/Projects/Proposit-App/proposit-core …`). Note `pnpm -C <dir> version` mis-spawns (EACCES) — but you are **not** versioning here, so it won't bite.

## Boundaries / hand-back

- Work ONLY on branch `ollama/provider` (off `proposit-core` `main`). Implement S1→S2→S3 + tests + docs. Then **STOP** — do NOT bump the version, do NOT merge to main, do NOT tag, do NOT publish. The orchestrator runs the `proposit-core-reviewer` dual-review + a human check, then coordinates the version/merge/tag and the **consumer-side tarball validation** (server + shared) before the user publishes. This change touches `TLlmStageOptionsOverride` (code that runs in consumers), so that gate is non-skippable.
- Report back to the orchestrator (final message): branch + commit range; the failing-test→green trail per slice; your key design decisions (converter strict-fold needed or not + the empirical qwen `format` result, error-mapping cases, tool-loop handling); exact files touched; the `pnpm run check` tail; and any deviations from this agenda or the spec for the reviewer to scrutinize.
