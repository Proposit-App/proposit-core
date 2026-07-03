# Spec

## Capability changes

None. This is an internal file-size decomposition with zero product delta, zero
public API change, and zero runtime-behavior change. No `capabilities.md`
reconcile is required.

## Problem

Three `src/lib/` files have grown large enough to hurt reviewability and mix
more than one concern in a single module. Line counts re-verified 2026-07-03
(match the initial request exactly):

- **`src/lib/core/expression-manager.ts` — 2,042 lines.** A single class
  (`ExpressionManager<TExpr>`) with ~30 public/private methods. Several mutation
  methods inline large blocks of numbered structural-validation checks
  (`insertExpression` 213 lines, `wrapExpression` 176, `validate()` 199,
  `repositionSiblings` 134, `updateExpression` 128, `removeAndPromote` 112,
  `addExpressionRelative` 95), plus a self-contained checksum dirty-set
  subsystem (`markExpressionDirty` / `flushExpressionChecksums` /
  `pruneDeletedFromDirtySet`, lines 253-355).
- **`src/lib/pipelines/execute.ts` — 1,278 lines.** Two distinct execution
  modes bundled in one file: the whole-DAG concurrent scheduler
  (`executePipeline`, `validateDag`, `makeStageContext`, `runOneStage`,
  `runFinalize`) in lines 1-798, and the single-stage entry points
  (`executeStage`, `executeFinalize`, `launchStage`, `completeStage`, plus
  shared-state helpers) in lines 799-1278. The file's own layout already
  bisects cleanly at that boundary.
- **`src/lib/pipelines/stage-helpers.ts` — 924 lines.** LLM-specific code
  (`LlmStageRetryExhaustedError`, `TLlmStageConfig`, `readLlmStageConfig`,
  `isLlmStage`, `applyRetrySuffix`, `buildLlmRequest`, `validateLlmOutcome`,
  `failureRetryReason`, `llmStage`) occupies lines 146-837 — about 75% of the
  file — while generic stage helpers (`deterministicStage`, retry
  types/policy, `StageAbortedError`, `SubPipelineFailedError`,
  `readStashedTokenUsage`, `subPipelineStage`) make up the remaining ~190
  lines, non-contiguously.

Two other recommendations from the same architecture review are already
resolved and are **not** part of this item: the OpenAI provider split
(shipped, `provider.ts` now 457 lines) and the ingestion-stages path
(reorganized independently; domain-grouping of `pipelines/base/stages/` is a
separate, not-yet-actioned flag — out of scope here, see Non-goals).

## Goals

- Reduce each of the three files to smaller, single-responsibility modules.
- Zero behavior change: every extracted block is a verbatim move (or a thin
  delegation to a moved function), not a rewrite.
- Zero public API change: every symbol currently importable from
  `src/lib/index.ts` or `src/lib/pipelines/index.ts` keeps the same name and
  export path. Where a file is genuinely renamed/split, update the barrel(s)
  in the same step so package consumers never see a path change.
- Minimize edits to files outside the three targets. Prefer keeping an
  existing filename as the stable import surface (with implementation moved
  out and re-exported) over forcing an import-path update at every call site,
  when the call-site count is large (see `stage-helpers.ts` below).
- Each file is its own independently landable, independently verifiable step.
  A regression surfaced by one file's split does not block or entangle the
  others.

## Non-goals

- `argument-engine.ts` (2,861 lines) / `premise-engine.ts` (2,284 lines) — the
  original review explicitly triaged these out as high-effort/high-regression
  risk (the `withValidation` + `ChangeCollector` + checksum-dirty-propagation
  invariants are tightly interwoven); tracked separately in
  `docs/inbox/2026-06-15-engine-class-decomposition.md`.
- `core/libraries/` subfolder grouping (review §3a: `claim-library.ts`,
  `claim-axiom-library.ts`, `claim-citation-library.ts`,
  `argument-library.ts`) — a separate flag, not part of the three files this
  item re-scoped as actionable.
- `pipelines/base/stages/` domain grouping (review §3b: proposal/clause/formula
  subfolders) — re-pointed and still valid per the initial request, but not
  one of the three "KEEP" targets in the 2026-06-28 refinement; a separate
  work item if pursued.
- Any bug fix, validation-rule change, retry-policy change, or new test
  coverage for behavior not already covered — pure move/extract only.
- Version bump decision — offered at completion per repo convention, not
  decided in planning.

## Constraints / invariants (from `AGENTS.md`)

- `src/lib/` carries zero third-party SDK imports — already true for all
  three files (verified: only relative imports and `typebox`); must remain
  true after the split.
- All relative imports in `src/lib/` must end in `.js`; directory imports need
  an explicit `index.js` path. New sibling files avoid this entirely (no new
  directories are introduced by this plan).
- `brain-style` (TypeScript sub-skill) governs naming/casing for any new
  filenames and exported symbols; invoke it before writing new files.
- Grammar-rule codes, engine-error codes, and the hierarchical-checksum
  protocol are unaffected — no touch to their values, only to which file
  computes them.
- `ExpressionManager` mutations throw only on Structural violations — the
  extracted check functions must preserve exact throw conditions and error
  messages/codes.

## Current-state findings

### `expression-manager.ts`

- Only export is the `ExpressionManager<TExpr>` class (plus 4 supporting
  types); the class itself is **not part of the public barrel**
  (`src/lib/index.ts` exports only `TExpressionInput`,
  `TExpressionWithoutPosition`, `TExpressionUpdate`,
  `TExpressionManagerSnapshot` — documented there as "internal engine
  machinery referenced only by `PremiseEngine`'s protected `expressions`
  member").
- Direct class consumers: `src/lib/core/premise-engine.ts` (owns an instance,
  calls `markExpressionDirty`/`flushExpressionChecksums`) and
  `test/core.test.ts` (imports `ExpressionManager` directly, calls
  `flushExpressionChecksums()` ~12 times). Type-only consumers of
  `TExpressionInput` etc.: `src/cli/import.ts`,
  `src/cli/commands/expressions.ts`, `src/lib/core/argument-engine.ts`,
  `src/lib/parsing/argument-parser.ts`,
  `src/lib/core/interfaces/premise-engine.interfaces.ts`, several
  `test/grammar/` files — none reach into private internals.
- **This is the lowest-blast-radius file of the three**: as long as the class
  keeps its current public method signatures, no consumer outside this file
  needs to change.
- The dirty-set trio (`markExpressionDirty`, `flushExpressionChecksums`,
  `pruneDeletedFromDirtySet`, lines 253-355) is already contiguous — a clean,
  low-risk extraction — but reaches into 4 pieces of private state
  (`expressions`, `childExpressionIdsByParentId`, `collector`, `config`), so
  the extracted functions need those passed explicitly; `flushExpressionChecksums`
  also recomputes hierarchical checksums and notifies the `ChangeCollector`,
  it is not pure bookkeeping.
- No standalone `validateInsertExpression(...)`-style functions exist today —
  all structural checks are inlined in each mutation method via closures over
  `this`. Extracting them changes the checks from implicit `this`-access to
  explicit parameters (the relevant Maps/config), a real (but mechanical)
  internal signature change.
- **Not flagged by the original review:** `validate()` (199 lines, lines
  1796-1994) is a whole-tree invariant scan, only loosely coupled to the
  mutation methods (it calls `flushExpressionChecksums()` internally but
  otherwise just reads state) — the cleanest single seam in the file.
- Also not named individually by the review's "10 methods" list:
  `addExpressionRelative` (95 lines) and `wrapInFormula` (63 lines) are two
  more sizable public mutation methods.

### `pipelines/execute.ts`

- Public barrel `src/lib/pipelines/index.ts` re-exports `executePipeline`,
  `executeStage`, `executeFinalize`, `launchStage`, `completeStage`,
  `PipelineConfigurationError`, and associated types — documented public API
  (`AGENTS.md`: "pipeline framework … shipped as 1.1.0+ public API").
- Exactly one direct (non-barrel) internal consumer:
  `src/lib/conversation/turn.ts` imports `executeStage` and
  `TStageOutcomeRecord` from `../pipelines/execute.js` — and uses only the
  single-stage entry point, never the scheduler.
- `stage-helpers.ts` imports `executePipeline` from `execute.ts` (for
  `subPipelineStage`), while `execute.ts` imports 9 symbols from
  `stage-helpers.ts` (`LlmStageRetryExhaustedError`, `StageAbortedError`,
  `SubPipelineFailedError`, `readStashedTokenUsage`, `readLlmStageConfig`,
  `buildLlmRequest`, `applyRetrySuffix`, `validateLlmOutcome`,
  `failureRetryReason`, `TRetryReason`) — an existing circular import between
  the two files. `subPipelineStage` is the sole `stage-helpers.ts` consumer of
  `executePipeline`, so the cycle is isolable to that one call.
- No test imports `execute.ts` by direct path; `test/pipelines.test.ts` goes
  through the public barrel for everything it needs from this file.
- The review's split (scheduler vs. single-stage) matches the file's own
  layout almost exactly at the line-799 boundary. Caveat: `executePipeline`
  itself is 307 lines — relocating it doesn't reduce its own complexity; a
  follow-up decomposition of that function is plausible but out of scope here.

### `pipelines/stage-helpers.ts`

- Public barrel re-exports `deterministicStage`, `llmStage`,
  `subPipelineStage`, `isLlmStage`, `DEFAULT_RETRY_POLICY`,
  `LlmStageRetryExhaustedError`, `StageAbortedError`,
  `SubPipelineFailedError`, `TRetryPolicy`, `TRetryReason` — public API.
- **Widest blast radius of the three files:** 17 files under `src/extensions/`
  import `llmStage` and/or `deterministicStage` **directly** from
  `../../../../lib/pipelines/stage-helpers.js` (not via the barrel) —
  confirmed by grep, e.g. `src/extensions/pipelines/base/stages/*.ts`,
  `src/extensions/pipelines/ingestion/scribe/*.ts`,
  `src/extensions/builder/{distill,review,simulate}.ts`. Two test files also
  import directly by path: `test/pipelines.test.ts` (imports
  `readLlmStageConfig`, `buildLlmRequest`, `validateLlmOutcome` — a comment
  there notes these are "package-internal seam fns … imported directly … to
  test them without exporting them [via the barrel]") and
  `test/extensions/openai/launch-complete-contract.test.ts` (imports
  `llmStage`, `readLlmStageConfig`, `validateLlmOutcome`, `TRetryReason` — a
  deliberate drift-guard pinning `validateLlmOutcome`'s status/reason mapping
  against the real OpenAI provider's error classification).
- Splitting by moving `llmStage` et al. to a new file and updating all ~22
  import sites is mechanical but high-touch and easy to get subtly wrong (a
  missed import fails fast at typecheck, but a stray one importing the old
  re-implementation would not). Given the file's own `flushExpressionChecksums`-
  style precedent in this repo (the OpenAI provider split kept `provider.ts` as
  a smaller coordinating file that delegates to new modules, rather than
  forcing every consumer to re-point), the lower-risk shape is: move the
  LLM-specific **implementation** to a new file, and keep `stage-helpers.ts`
  re-exporting those names — zero import-path changes anywhere else.
- `SubPipelineFailedError` (declared at lines 123-145) and `subPipelineStage`
  (the function that throws it, lines 847-923) are separated by the entire
  LLM block; they should end up in the same file as each other once the LLM
  block is moved out.
- `llmStage` alone is 288 lines (~31% of the file) — the largest function
  here; a follow-up internal decomposition of `llmStage` itself is plausible
  but out of scope for this item.

## Proposed decomposition

1. **`expression-manager.ts`** → extract into two new sibling files under
   `src/lib/core/` (no new directory, so no import-path changes for any
   existing consumer):
   - `expression-manager-dirty-set.ts` — the checksum dirty-set trio, as
     exported functions taking the class's relevant private state
     explicitly.
   - `expression-manager-checks.ts` — one exported structural-check function
     per mutation operation (insert/wrap/update/reposition/remove-and-promote/
     add-relative/…), each throwing under the same conditions the inline code
     throws today, taking the input + whatever Maps/config it currently reads
     via `this`.
   - `expression-manager-invariants.ts` — the whole-tree `validate()` scan,
     as an exported function taking the state it currently reads via `this`.
   - `expression-manager.ts` keeps the class shell: constructor, accessors,
     and each mutation method now calling out to the extracted check/logic
     functions before/around its own remaining orchestration.
2. **`pipelines/execute.ts`** → split along its existing line-799 seam into
   `pipelines/scheduler.ts` (types, `PipelineConfigurationError`,
   `validateDag`, `makeStageContext`, `runOneStage`, `runFinalize`,
   `executePipeline`) and `pipelines/single-stage.ts` (remaining types,
   `seedRecordsFromUpstream`, `buildSingleShotState`, `executeStage`,
   `executeFinalize`, `requireLlmStage`, `launchStage`, `completeStage`,
   `resolveApiKey`). `execute.ts` is removed; update the 3 files that
   reference it by path: `src/lib/pipelines/index.ts` (barrel),
   `src/lib/conversation/turn.ts` (direct import → `single-stage.js`), and
   `src/lib/pipelines/stage-helpers.ts` (its `executePipeline` import →
   `scheduler.js`).
3. **`pipelines/stage-helpers.ts`** → move the LLM-specific block (lines
   146-837: `LlmStageRetryExhaustedError`, `TLlmStageConfig`,
   `readLlmStageConfig`, `isLlmStage`, `applyRetrySuffix`, `buildLlmRequest`,
   `validateLlmOutcome`, `failureRetryReason`, `llmStage`) to a new
   `pipelines/llm-stage-helpers.ts`. `stage-helpers.ts` re-exports those same
   names from the new file (with a short comment explaining the delegation)
   and keeps the generic remainder (`deterministicStage`, retry
   types/policy, `StageAbortedError`, `SubPipelineFailedError`,
   `readStashedTokenUsage`, `subPipelineStage`) as real local code. No import
   path anywhere else changes.

## Acceptance criteria

- `pnpm run check` (typecheck + lint + test + build) is green after each of
  the three steps, and again at the end.
- No extracted block changes throw conditions, return values, error
  messages/codes, checksum values, or retry/scheduling behavior — verified by
  the existing suite passing unchanged (no test assertions edited to
  accommodate the refactor, only import paths where a file was genuinely
  removed).
- Every symbol currently exported from `src/lib/index.ts` or
  `src/lib/pipelines/index.ts` is still exported with the same name.
- `grep -rn "pipelines/execute" src/ test/` returns nothing once step 2 lands
  (confirms no stale reference to the removed file).
- The 17 `src/extensions/**` files and the 2 tests that import
  `stage-helpers.js` directly are **not** touched by step 3 (re-export keeps
  their import paths valid) — grep confirms zero diff in those files.
- No new file exceeds ~500 lines except where explicitly noted as an accepted
  follow-up candidate (`llm-stage-helpers.ts` at ~700 lines, containing the
  already-large `llmStage` function; `scheduler.ts`'s `executePipeline` at
  307 lines).

## Risks / dependencies / related

- **Pre-existing circular import** between `execute.ts`/`scheduler.ts` and
  `stage-helpers.ts` survives the split (relocated, not removed). Not a new
  risk introduced by this work, but confirm the build/typecheck still
  resolves it cleanly after step 2.
- **`ExpressionManager` check extraction is the most delicate sub-step**:
  moving inline `this`-scoped checks to standalone functions with explicit
  parameters is a real (if mechanical) refactor of how each method reaches
  its state; a missed parameter or wrong Map reference would be a silent
  correctness bug rather than a typecheck failure in the worst case — lean on
  `test/core.test.ts` (the largest suite) plus `test/grammar/` for coverage.
- **`llmStage` (288 lines) and `executePipeline` (307 lines) remain large**
  after their respective moves — flagged as accepted follow-up candidates,
  not blockers for this item.
- **Related, not blocking:** `docs/inbox/2026-06-15-engine-class-decomposition.md`
  (argument-engine.ts / premise-engine.ts, deferred); review §3a
  (`core/libraries/`) and §3b (`pipelines/base/stages/` domain grouping),
  both separate, not-yet-actioned items.
- No cross-repo dependency — this item is entirely internal to
  `proposit-core`; nothing published or consumed by `proposit-shared`,
  `proposit-server`, or `proposit-mobile` changes.
