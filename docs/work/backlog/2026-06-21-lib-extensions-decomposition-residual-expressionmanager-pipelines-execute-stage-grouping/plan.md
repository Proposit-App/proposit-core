# Plan

Three independent phases, one per target file, ordered lowest → highest
blast radius. Each phase is a separately committable, separately verifiable
step — a regression in one does not block the others. Invoke the `brain-style`
skill (TypeScript sub-skill) before writing any new file in any phase, and use
the TypeScript LSP tool to navigate/verify definitions while moving code.

## Phase 1 — `src/lib/core/expression-manager.ts` (2,042 → target ~1,000-1,300)

Lowest risk: the class is not part of the public barrel, and only
`premise-engine.ts` + `test/core.test.ts` touch it directly (both call only
existing public methods — no signature changes here, so neither needs edits).

### 1a. Extract the checksum dirty-set trio

- New file `src/lib/core/expression-manager-dirty-set.ts`.
- Move `markExpressionDirty`, `flushExpressionChecksums`,
  `pruneDeletedFromDirtySet` (current lines 253-355) as exported functions.
  Since `flushExpressionChecksums` recomputes hierarchical checksums and
  notifies the `ChangeCollector` (not pure bookkeeping), give each function
  explicit parameters for the private state it reads today via `this`:
  the `expressions` map, `childExpressionIdsByParentId` map, the
  `ChangeCollector` instance, and `config`. This module's parameter shape is
  independent of `expression-manager-checks.ts` (1c) — each extracted
  function takes only what it actually reads; see 1c for why they aren't
  forced into one shared "store" type.
  **Pass the class's actual `Map`/`ChangeCollector` instances by reference,
  never a cloned/snapshotted copy** — build the small parameter object as a
  fresh object literal on each call (cheap: it holds references, not copies),
  not as a field cached on the class. Because JS `Map`/object references are
  shared, not copied, and every call is synchronous within the calling
  method, there is no window for the extracted function to see state that's
  stale relative to `this` — this is what makes the extraction behavior-
  preserving despite moving from implicit `this`-access to explicit
  parameters.
- `ExpressionManager`'s own `markExpressionDirty` / `flushExpressionChecksums`
  / `pruneDeletedFromDirtySet` become thin public methods that call the moved
  functions with `this`'s state — same public method names/signatures.
- Verify: `pnpm run typecheck`, then
  `pnpm exec vitest run test/core.test.ts` (it calls
  `flushExpressionChecksums()` ~12 times — the most direct regression guard
  for this sub-step).

### 1b. Extract the whole-tree invariant scan

- New file `src/lib/core/expression-manager-invariants.ts`.
- Move `validate()` (current lines 1796-1994, 199 lines) as an exported
  function taking the state it reads (same expression-store shape as 1a).
  It calls `flushExpressionChecksums()` internally — import that from
  `expression-manager-dirty-set.ts` rather than duplicating it.
- `ExpressionManager.validate()` becomes a thin delegation.
- Verify: `pnpm run typecheck`, then
  `pnpm exec vitest run test/core.test.ts test/grammar/` (grammar suites
  exercise `validate()` across all four tiers — the right regression guard
  here, since Structural/Evaluable/Derivable/Presentable violations must
  still be detected identically).

### 1c. Extract per-operation structural checks

- New file `src/lib/core/expression-manager-checks.ts`.
- For each of the largest mutation methods — `insertExpression` (213 lines),
  `wrapExpression` (176), `repositionSiblings` (134), `updateExpression`
  (128), `removeAndPromote` (112), `addExpressionRelative` (95) — extract the
  leading block of numbered inline structural checks into one exported
  `validate<Operation>Expression(input, store)`-style function per operation,
  matching the review's suggested shape (e.g.
  `validateInsertExpression(input, exprStore, positionConfig)`). `store` here
  only needs the Maps each specific check actually reads (usually
  `expressions` plus `childExpressionIdsByParentId`) — not the
  `ChangeCollector`/`config`, which are needed only by the dirty-set
  functions in 1a. Keep the two modules' parameter shapes independent rather
  than forcing one shared "store" type across both; each should take exactly
  what it uses.
  **Caveat — extraction isn't always a clean prefix.** Spot-checking
  `insertExpression`: only roughly half of its 213 lines are the leading
  numbered checks; the remainder is reparent/store/dirty-marking
  orchestration that depends on locals computed *inside* the check block
  (e.g. an anchor/anchor-parent value derived while validating). Where that
  happens, the check function can't be a pure throw-or-void helper — it must
  also return the derived value(s) the orchestration needs, and the calling
  method destructures the result before continuing. Confirm this shape
  per-operation as you go; don't assume every method's checks are a clean
  prefix with no downstream dependency before extracting it. (This also means
  the file may land closer to ~1,200-1,300 lines than a single clean
  half-split would suggest — see the phase heading above.)
  Each function must throw under the **exact same conditions**, with the
  **exact same error messages/codes**, as the inline code it replaces — this
  is a pure relocation, not a rewrite. This is already enforced by the
  existing suite, not just a manual check: `test/core.test.ts` asserts
  `toThrow(/regex/)` against specific substrings (including grammar codes,
  e.g. `toThrow(/S-10.*already exists/)`), not just "throws" — so an
  extraction that drops or alters wording fails the existing tests without
  any new test being written. Do this one operation at a time within
  the sub-step (insert, then wrap, then reposition, then update, then
  remove-and-promote, then add-relative) so a regression is easy to bisect;
  typecheck + the targeted test after each operation before moving to the
  next.
- Each mutation method calls its check function first, then keeps its own
  (now much shorter) orchestration body.
- Verify after all six: `pnpm run typecheck`, then
  `pnpm exec vitest run test/core.test.ts`, then `pnpm run check` (full
  suite — lint + typecheck + test + build) to close out Phase 1.

## Phase 2 — `src/lib/pipelines/execute.ts` (1,278 → removed; split in two)

### 2a. Split along the existing line-799 seam

- New file `src/lib/pipelines/scheduler.ts`: shared types (`TExecutePipelineDeps`
  etc.), `PipelineConfigurationError`, `validateDag`, `makeStageContext`,
  `runOneStage`, `runFinalize`, `executePipeline` (current lines 1-798).
- New file `src/lib/pipelines/single-stage.ts`: remaining types
  (`TStageOutcomeRecord`, `TExecuteStageDeps`, `TExecuteStageResult`,
  `TLaunchStageResult`, `TExecuteFinalizeResult`), `seedRecordsFromUpstream`,
  `buildSingleShotState`, `executeStage`, `executeFinalize`,
  `requireLlmStage`, `launchStage`, `completeStage`, `resolveApiKey`
  (current lines 799-1278).
- Delete `execute.ts`.

### 2b. Repoint the 3 files that reference `execute.ts` by path

- `src/lib/pipelines/index.ts` — re-export `executePipeline`,
  `PipelineConfigurationError`, and its types from `./scheduler.js`;
  re-export `executeStage`, `executeFinalize`, `launchStage`,
  `completeStage`, and their types from `./single-stage.js`. Confirm every
  name the barrel exported before the split is still exported after.
- `src/lib/conversation/turn.ts` — its `executeStage` / `TStageOutcomeRecord`
  import moves from `../pipelines/execute.js` to
  `../pipelines/single-stage.js`.
- `src/lib/pipelines/stage-helpers.ts` — its `executePipeline` import (used
  only by `subPipelineStage`) moves from `./execute.js` to `./scheduler.js`.
  This is the one pre-existing circular-import edge (scheduler.ts ↔
  stage-helpers.ts); do not attempt to remove the cycle here, just repoint
  it — confirm `pnpm run typecheck` still resolves it.

### 2c. Verify

- `pnpm run typecheck`
- `grep -rn "pipelines/execute" src/ test/` → expect zero results (confirms
  no stale reference to the removed file).
- `pnpm exec vitest run test/pipelines.test.ts`
- `pnpm run check` to close out Phase 2.

## Phase 3 — `src/lib/pipelines/stage-helpers.ts` (924 → target ~230, via delegation)

Highest external fan-out (17 files under `src/extensions/` + 2 tests import
`llmStage`/`deterministicStage`/etc. directly from
`../../../../lib/pipelines/stage-helpers.js`, not via the barrel) — so this
phase moves implementation, not the import surface.

### 3a. Move the LLM-specific block

- New file `src/lib/pipelines/llm-stage-helpers.ts`.
- Move `LlmStageRetryExhaustedError`, `TLlmStageConfig`,
  `readLlmStageConfig`, `isLlmStage`, `applyRetrySuffix`, `buildLlmRequest`,
  `validateLlmOutcome`, `failureRetryReason`, `llmStage` (current lines
  146-837, ~692 lines) verbatim.
- `stage-helpers.ts` re-exports all of the above from
  `./llm-stage-helpers.js`, with a one-line comment explaining the split
  (LLM-specific implementation lives in `llm-stage-helpers.ts`; this file
  re-exports it to keep the ~20 existing direct-import call sites and the
  public barrel unchanged).
- `stage-helpers.ts` keeps the generic remainder as real local code:
  `deterministicStage`, `TRetryReason`, `TRetryPolicy`,
  `DEFAULT_RETRY_POLICY`, `StageAbortedError`, `SubPipelineFailedError`,
  `readStashedTokenUsage`, `subPipelineStage`. Reunite `SubPipelineFailedError`
  next to `subPipelineStage` (they were separated by the LLM block before).

### 3b. Do NOT touch consumer import paths

- Confirm via `git diff --stat` that none of the 17 `src/extensions/**`
  files, `test/pipelines.test.ts`, or
  `test/extensions/openai/launch-complete-contract.test.ts` appear in the
  diff for this phase — their imports resolve unchanged through the
  `stage-helpers.ts` re-export.

### 3c. Verify

- `pnpm run typecheck`
- `pnpm exec vitest run test/pipelines.test.ts test/extensions/openai/launch-complete-contract.test.ts`
  (the latter is a deliberate drift-guard on `validateLlmOutcome`'s
  status/reason mapping — must still pass unchanged since the function body
  didn't move logic, only file).
- `pnpm run check` to close out Phase 3 and the whole item.

## Parallelization & dependencies

- The three phases touch disjoint files (`expression-manager.ts` is
  untouched by Phases 2-3; `execute.ts`/`scheduler.ts`/`single-stage.ts` and
  `stage-helpers.ts` only share the one import-path edge in 2b) — Phase 1
  can run fully in parallel with Phases 2+3 if split across two subagents or
  sessions.
- Within Phases 2 and 3: land Phase 2 before Phase 3, since 2b already touches
  `stage-helpers.ts`'s import line; sequencing avoids two agents editing the
  same file's import block at once. If parallelized anyway, Phase 3 must
  rebase onto Phase 2's `stage-helpers.ts` import-line change.
- Within Phase 1: 1a → 1b (1b's `validate()` extraction imports
  `flushExpressionChecksums` from 1a's new file) → 1c (independent of 1a/1b
  but sequenced last since it's the highest-touch sub-step).

## Verification (full, run at the end regardless of phase order)

```bash
pnpm run typecheck
pnpm run lint
pnpm exec vitest run          # full suite — no test assertions should need edits
pnpm run build                # generate:parser + tsc -p tsconfig.build.json + typedoc
pnpm run check                # equivalent to the above in sequence
```

`pnpm run check` green is the bar for the whole item. No golden-fixture or
snapshot diffs are expected anywhere (pure internal move); any snapshot diff
that does appear is a signal the "move, don't rewrite" constraint was
violated and needs investigation before proceeding.

## Documentation-sync tasks

Checked against `AGENTS.md`'s Documentation Sync table; `docs/api-reference.md`,
`README.md`, and `CLI_EXAMPLES.md` do not reference any of the three files by
path (confirmed via grep), so no update is needed there. Two triggers do
fire:

- `docs/changelogs/upcoming.md` [Any-Code-Change] — add one entry per phase
  (or one combined entry if all three land together) describing the file
  moves, since this trigger fires on any code change regardless of public
  surface.
- `docs/release-notes/upcoming.md` [Public-API] — likely **skip**: this
  trigger is scoped to public-API changes, and this item makes none. Confirm
  at closeout rather than assume; if skipped, note why in `outcome.md`.
- `AGENTS.md` [Routing] — no new invariant or canonical-doc route is
  introduced; no update expected.

## Closeout (later, not decided now)

- Version bump: likely **patch** (pure internal refactor, no public API
  change) — offer `pnpm version patch` at completion per repo convention,
  not decided here.
- `tcw work start <slug>` before the first code edit, committing that status
  transition before any implementation diff, per the task lifecycle.
