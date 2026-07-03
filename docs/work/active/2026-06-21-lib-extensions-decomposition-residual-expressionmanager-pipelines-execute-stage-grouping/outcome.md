# Outcome

Work completed successfully. All three phases from `plan.md` are implemented,
verified, and committed as three separate, independently landable commits.

## What changed

### Phase 1 — `src/lib/core/expression-manager.ts` (2,042 → 1,397 lines)

Commit `ec231fa`. Split into a class shell plus three sibling modules:

- `expression-manager-dirty-set.ts` — the checksum dirty-set trio
  (`markExpressionDirty`, `flushExpressionChecksums`,
  `pruneDeletedFromDirtySet`) as exported functions taking the class's
  `expressions` / `childExpressionIdsByParentId` / `dirtyExpressionIds` /
  `config` / `collector` explicitly. `ExpressionManager`'s own methods
  became thin delegations.
- `expression-manager-invariants.ts` — the whole-tree `validate()` scan,
  as `validateExpressionManagerInvariants`.
- `expression-manager-checks.ts` — one `validate<Operation>` function per
  mutation operation (`validateInsertExpression`, `validateWrapExpression`,
  `validateRepositionSiblings`, `validateUpdateExpression`,
  `validateRemoveAndPromote`, `validateAddExpressionRelative`), each
  extracted and verified one operation at a time per the plan's ordering
  (insert → wrap → reposition → update → remove-and-promote →
  add-relative).

Two operations did not have a clean "leading block of checks" prefix, as
the plan's own caveat anticipated, and got a pragmatic per-operation shape
instead of a literal reading of "extract the checks":

- `repositionSiblings`: the single throw condition ("not enough space") is
  inseparable from the range-computation arithmetic the mutation loop also
  needs, so `validateRepositionSiblings` extracts that whole computation
  and returns `{ startIdx, endIdx, lowerBound, upperBound, count }` rather
  than being a pure throw-or-void helper.
- `addExpressionRelative`: its only precondition is a sibling-existence
  check; the rest of the method is position arithmetic entangled with
  calls to the private `repositionSiblings` mutator, which isn't safely
  extractable without passing mutation callbacks across the module
  boundary. `validateAddExpressionRelative` is intentionally minimal
  (existence check only) — a deliberate, lower-risk deviation from a
  literal per-operation "check + derived value" shape, not an oversight.

No throw conditions, error messages/codes, checksum values, or
retry/scheduling behavior changed — `test/core.test.ts` (1,062 tests) and
`test/grammar/` pass unchanged throughout.

### Phase 2 — `src/lib/pipelines/execute.ts` (1,278 lines, removed)

Commit `d0a1305`. Split along the file's existing scheduler-vs-single-shot
seam:

- `scheduler.ts` — the whole-DAG concurrent scheduler: `executePipeline`,
  `validateDag`, `makeStageContext`, `runOneStage`, `runFinalize`,
  `PipelineConfigurationError`, `TExecutePipelineDeps`.
- `single-stage.ts` — the durable-orchestrator entry points:
  `executeStage`, `executeFinalize`, `launchStage`, `completeStage`, and
  their supporting types. Imports `makeStageContext` / `runOneStage` /
  `runFinalize` / `now` / `noopEmit` / `defaultGenerateId` /
  `PipelineConfigurationError` from `scheduler.ts` (these had to become
  exported — they were module-private in the original single file).

The 3 consumers that referenced `execute.ts` by path were repointed:
`src/lib/pipelines/index.ts` (barrel, same export names, new source
files), `src/lib/conversation/turn.ts` (`executeStage` /
`TStageOutcomeRecord` → `./single-stage.js`), and
`src/lib/pipelines/stage-helpers.ts` (`executePipeline` → `./scheduler.js`,
preserving the pre-existing scheduler↔stage-helpers circular import,
which still resolves cleanly).

`grep -rn "pipelines/execute" src/ test/` returns zero results.
`test/pipelines.test.ts` (87 tests) passes unchanged.

### Phase 3 — `src/lib/pipelines/stage-helpers.ts` (924 → 238 lines)

Commit `5396d12`. Moved the LLM-specific implementation to a new
`llm-stage-helpers.ts`: `llmStage`, `readLlmStageConfig`, `isLlmStage`,
`applyRetrySuffix`, `buildLlmRequest`, `validateLlmOutcome`,
`failureRetryReason`, `LlmStageRetryExhaustedError`, plus their private
supporting helpers (`classifyError`, `sleep`, `emitRetry`, `now`,
`clampMaxLengthStrings`, `checkLlmOutput`, `formatIncompleteMirror`,
`resolveErrorCap`, `truncateValidationError`). `stage-helpers.ts`
re-exports all of it and keeps the generic remainder as real local code:
`deterministicStage`, `subPipelineStage`, `TRetryReason`/`TRetryPolicy`/
`DEFAULT_RETRY_POLICY`, `StageAbortedError`, `SubPipelineFailedError`,
`readStashedTokenUsage`.

One deviation from a literal reading of "the generic remainder": the
token-usage side channel's writer, `stashTokenUsage`, had to become
exported (it was module-private) because it stays in `stage-helpers.ts`
next to the `TOKEN_USAGE_CHANNELS` `WeakMap` and `readStashedTokenUsage`
(so there is exactly one shared map instance), while `llmStage` — its only
caller — moved to `llm-stage-helpers.ts`. This introduces one new
same-direction-as-existing circular import edge
(`llm-stage-helpers.ts` → `stage-helpers.ts`, for `StageAbortedError`,
`stashTokenUsage`, `DEFAULT_RETRY_POLICY`), alongside the pre-existing
`scheduler.ts` ↔ `stage-helpers.ts` cycle from Phase 2. Both resolve
cleanly (`pnpm run typecheck` and the full suite are green) because every
cross-cycle reference is used only inside function bodies invoked later,
never at module-top-level evaluation time.

Verified via `git status --short` that none of the 17 `src/extensions/**`
files that import `stage-helpers.js` directly, nor
`test/pipelines.test.ts` / `test/extensions/openai/launch-complete-contract.test.ts`,
appear in the diff for this phase — their imports resolve unchanged
through the re-export. Both targeted suites (92 tests total) pass.

## Verification performed

- `pnpm run typecheck` — clean after every sub-step of every phase.
- Targeted `vitest run` after each sub-step per `plan.md` (core.test.ts,
  core.test.ts + grammar/, pipelines.test.ts,
  launch-complete-contract.test.ts).
- `pnpm run check` (typecheck + lint + full test + build) at the close of
  each phase and once more at the end. Full suite: 1,990 passed, 14
  skipped, 0 failed, unchanged from the pre-refactor baseline. Build
  (parser generation + `tsc -p tsconfig.build.json` + typedoc): clean, 0
  errors, same 4 pre-existing typedoc warnings as baseline.
- `pnpm run lint`'s `prettify:check` step reports the same 28
  `docs/taxonomy/**` formatting warnings that exist on `main` before this
  work (confirmed via `git log` — they predate this item, from
  `docs(taxonomy): add feature entries + claim-connection/analysis vocab`,
  commit `eb9de58`); `pnpm eslint .` alone is clean with zero warnings.
- `grep -rn "pipelines/execute" src/ test/` → zero results.
- `git diff HEAD~3 -- src/lib/index.ts` → empty (Phase 1 made zero
  changes to the top-level public barrel).
- `git diff HEAD~3 -- src/lib/pipelines/index.ts` → same export symbol set,
  only source paths repointed.
- `git status --short` on the 17 `src/extensions/**` direct-import files +
  2 direct-import tests → empty, both before and after Phase 3.

## Deviations from plan.md

- `expression-manager.ts` landed at 1,397 lines vs. the plan's stated
  target of "~1,000-1,300" — within the margin the plan itself flagged as
  plausible ("may land closer to ~1,200-1,300... or higher") given that
  `insertExpression`/`wrapExpression`'s checks return derived anchor state
  the orchestration still needs inline.
- `repositionSiblings` and `addExpressionRelative` extractions took a
  pragmatic per-operation shape rather than the plan's literal
  "leading-block-of-checks" template, per the plan's own invitation to
  "confirm this shape per-operation as you go" (see Phase 1 section
  above for the reasoning on each).
- One new circular-import edge (`llm-stage-helpers.ts` ↔
  `stage-helpers.ts`) was introduced in Phase 3, in addition to the
  pre-existing `scheduler.ts` ↔ `stage-helpers.ts` cycle the plan already
  flagged as an accepted risk. Not called out explicitly in `plan.md`,
  but a necessary consequence of the plan's own explicit split boundaries
  (`StageAbortedError` and `readStashedTokenUsage` both listed under the
  "generic remainder" staying in `stage-helpers.ts`, while their sole
  caller `llmStage` moved out). Confirmed safe via typecheck + full test
  suite.
- No new file exceeds ~730 lines (`llm-stage-helpers.ts` at 726,
  `scheduler.ts` at 766 including `executePipeline`'s own 307 lines) —
  consistent with the plan's accepted follow-up-candidate sizing.

## Follow-up notes (not decided here — closeout choice)

- The plan's accepted follow-up candidates (`llmStage` at ~290 lines,
  `executePipeline` at 307 lines) remain large after their moves, as
  anticipated; no further internal decomposition was attempted, per scope.
- `docs/inbox/2026-06-15-engine-class-decomposition.md`
  (`argument-engine.ts` / `premise-engine.ts`) remains deferred, unrelated
  to this item.
- Documentation-sync: `docs/changelogs/upcoming.md` updated with one entry
  per phase, per `plan.md`'s documentation-sync task.
  `docs/release-notes/upcoming.md` was left untouched — this item makes no
  public-API change, so the `[Public-API]` trigger does not fire.
