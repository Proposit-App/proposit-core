# lib/extensions decomposition — residual (ExpressionManager, pipelines/execute, stage grouping)

## Product changes

None — internal decomposition / file-size refactors. No public API or behavior change.

## Technical changes

Refined 2026-06-28. The re-scoped, still-actionable targets are the three large files
below (line counts re-verified 2026-06-28):

- **`src/lib/core/expression-manager.ts` — 2,042 lines** → extract per-operation structural
  validation helpers + the checksum dirty-set logic. KEEP.
- **`src/lib/pipelines/execute.ts` — 1,278 lines** → split the DAG scheduler from the
  single-stage entry points. KEEP.
- **`src/lib/pipelines/stage-helpers.ts` — 924 lines** (audit said 873; drifted up) → split
  LLM-specific helpers from generic stage utilities. KEEP.

Two original recommendations were struck as obsolete (see inline ~~strikethrough~~ below):

- **"Split OpenAI provider" — SHIPPED.** `src/extensions/openai/provider.ts` is now 457
  lines (was 1,589), already split into `openai-http.ts`, `openai-retrieval.ts`,
  `openai-tools.ts`, `openai-parsing.ts`, `structured-output.ts`, `errors.ts`, `types.ts`.
- **`src/extensions/argument-ingestion/stages/` — PATH GONE.** Ingestion was reorganized
  into `src/extensions/pipelines/base/stages/` (the 12 stage files now live there) +
  `src/extensions/pipelines/ingestion/{scholar,scribe}/`. The domain-grouping idea is still
  valid and has been **re-pointed** to the new `pipelines/base/stages/` folder (§3b).

## Meta changes

- **`blocked_by` cleared (2026-06-28).** This item was blocked by
  `2026-06-21-ponytail-lean-scan-residual-deletions-structuredclone-swap`. That lean-scan
  item has now been decomposed into two actionable children, and this file-size
  decomposition is independent of it (different files, no shared state). The stale blocker
  was removed via `tcw work edit --unblocked-by`; `blocked_by` is now empty.

---

# Architecture Review: `src/lib` + `src/extensions`

**Date:** 2026-06-15
**Scope:** File-size bloat, separation-of-concerns clarity
**Files surveyed:** 67 files in `src/lib/`, 41 in `src/extensions/` (34,685 total lines)

---

## 1. Large Files (>1000 lines) — Potential Decomposition Targets

> **Note:** The `argument-engine.ts` (2,861) and `premise-engine.ts` (2,284) splits were triaged out of this review as high-effort / high-regression-risk (the `withValidation` + `ChangeCollector` + checksum-dirty-propagation invariants are tightly interwoven). They are tracked separately in `docs/inbox/2026-06-15-engine-class-decomposition.md` for closer inspection later.

### src/lib/core/expression-manager.ts — 2,042 lines

**Issue:** Implements expression tree mutation with 10 public methods (add/append/insert/wrap/remove/update/change/reparent/delete/load/snapshot) plus many private helpers, all wrapped in structural validation and checksum dirty propagation. The `insertExpression` method alone is ~190 lines of numbered checks; `wrapExpression` is ~170 lines.

**Suggestion:**

- **Numbered structural checks** in each method → Extract to a check function per operation (e.g., `validateInsertExpression(input, exprStore, positionConfig)`). These are pure validations that throw — they'd reduce method bodies from 200→60 lines while improving testability.
- **Checksum dirty propagation** (`markExpressionDirty`, `flushExpressionChecksums`, `pruneDeletedFromDirtySet`) → Extract to a `DirtySetManager` or module-level helper. It's self-contained logic shared by all mutation paths.

### ~~src/extensions/openai/provider.ts — 1,589 lines~~ — SHIPPED, STRUCK 2026-06-28

> **DONE.** The provider was split. `provider.ts` is now **457 lines**; the seams below
> were extracted into `openai-http.ts`, `openai-retrieval.ts`, `openai-tools.ts`,
> `openai-parsing.ts`, `structured-output.ts`, `errors.ts`, and `types.ts` under
> `src/extensions/openai/`. Original suggestion retained for the record:

~~**Issue:** One huge factory function (`createOpenAiResponsesProvider`) containing the full `respond` closure (200+ lines) plus retrieval functions (`retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse`) and ~20 helper functions.~~

~~**Suggestion:** Split at natural seams — HTTP layer → `openai-http.ts`; error classification → an errors module; tool translation + agent loop → `openai-tools.ts`; background/retrieval API → `openai-retrieval.ts`.~~

### src/lib/pipelines/execute.ts — 1,278 lines

**Issue:** One module exports the whole-DAG scheduler (`executePipeline`), single-stage entry points (`executeStage`, `executeFinalize`), launch/complete split (`launchStage`, `completeStage`), and ~10 helper functions. The scheduler loop alone is ~140 lines; each stage-run/error-handling path is heavily inlined.

**Suggestion:** Split by execution mode:

- **DAG scheduler** → `pipelines/scheduler.ts` (the concurrent pool loop, DAG validation)
- **Single-shot entry points** → `pipelines/single-stage.ts` (`executeStage`, `executeFinalize`, rehydration logic)
- **Launch/complete split** → already partially separated; keep but extract the shared state builder and LLM config helpers out to `pipelines/stage-helpers.ts` (which is 924 lines as of 2026-06-28 — see below).

---

## 2. Medium Files (>500 lines, <1000) — Mostly Fine, Some Flags

| File                                                    | Lines | Notes                                                                                                                                                          |
| ------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | 730   | Interface file; acceptable for JSDoc-heavy interfaces.                                                                                                         |
| `src/lib/parsing/argument-parser.ts`                    | 774   | Could benefit from extracting the parsing rules into separate modules per rule type (D-1 through D-7).                                                         |
| `src/lib/core/evaluation/argument-evaluation.ts`        | 757   | Contains grading, evaluation defaults by claim type, and inference path logic. Consider splitting `grading` out (already exists in `grading.ts` alongside it). |
| `src/lib/pipelines/stage-helpers.ts`                    | 924   | Helper functions for pipeline stages. Split LLM-specific helpers from generic stage utilities. (Verified 924 on 2026-06-28; audit said 873.)                   |
| `src/lib/grammar/an-rules.ts`                           | 857   | Auto-normalization rules (AN-1 through AN-4). Each rule is a self-contained pass; consider exporting each as a separate module function.                       |

---

## 3. Separation of Concerns — Flags

### 3a. `src/lib/core/` is a god-folder

The `core/` directory has **29 files** and carries the entire argument engine, premise engine, expression management, checksum protocol, library management (claim/axiom/citation), fork operations, diff logic, and relationship tracking. Several of these could live in their own subdirectories:

- `core/evaluation/` already exists (4 files) for evaluation-specific logic — good pattern.
- `core/interfaces/` already exists (5 files) for interface contracts — good.
- But `core/claim-library.ts`, `core/claim-axiom-library.ts`, `core/claim-citation-library.ts`, and `core/argument-library.ts` could be grouped under `core/libraries/`.

**Suggestion:** Create a `core/libraries/` subfolder for the four library classes. Keep `core/` for the core engine primitives (ArgumentEngine, PremiseEngine, ExpressionManager, VariableManager).

### 3b. ~~`src/extensions/argument-ingestion/stages/`~~ → RE-POINTED to `src/extensions/pipelines/base/stages/` (2026-06-28)

> **Old path gone.** `src/extensions/argument-ingestion/stages/` no longer exists —
> ingestion was reorganized into `src/extensions/pipelines/base/stages/` (the flat stage
> folder) + `src/extensions/pipelines/ingestion/{scholar,scribe}/`. The domain-grouping
> idea is **still valid** and re-pointed below: `pipelines/base/stages/` currently holds the
> stage files flat in one folder (`segmentation.ts`, `conclusion-selection.ts`,
> `variable-assignment.ts`, `claim-type-classification.ts`, `claim-canonicalization.ts`,
> `claim-reference-validation.ts`, `citation-source-detection.ts`,
> `axiom-indicator-detection.ts`, `claim-mention-extraction.ts`, `formula-compilation.ts`,
> `formula-validation.ts`, `relation-extraction.ts`, plus `schemas.ts` + `index.ts`).

The stages still sit flat in one folder. Each is a reasonable size but the folder is
sprawling; the stages represent distinct pipeline phases with their own types, schemas, and
execution logic.

**Suggestion (re-pointed to `pipelines/base/stages/`):** Group stages by domain:

- `base/stages/proposal/` — segmentation, conclusion-selection, variable-assignment
- `base/stages/clause/` — claim-type-classification, claim-canonicalization, claim-reference-validation, citation-source-detection, axiom-indicator-detection, claim-mention-extraction
- `base/stages/formula/` — formula-compilation, formula-validation, relation-extraction

### 3c. ExpressionManager owns checksum dirty management but isn't told about it

`ExpressionManager.flushExpressionChecksums()` is a public method that must be called at the boundary of every mutation in both `ExpressionManager` and `PremiseEngine`. The dirty-set logic is complex (bottom-up processing, depth sorting) yet tightly coupled to the expression store.

**Suggestion:** This is already well-encapsulated within `ExpressionManager`. No action needed — just noting that it's a _concern_ of ExpressionManager rather than its own class because splitting it would require the dirty-set to know about the expression store (circular dependency).

---

## 4. Overall Health Assessment

### Strengths

- **Good modular boundaries at the extension level:** OpenAI, Ollama, IEEE, and argument-ingestion are clearly separated with no cross-imports between them.
- **Interface files separate contracts from implementations.** The interface JSDoc is the canonical, tracked home for the public-engine-API documentation (see CLAUDE.md Documentation Sync `[Public-Engine-API]`) — it is required surface for a published library, not bloat.
- **`src/lib/` has zero third-party SDK imports** (as per invariants), keeping SDK coupling out of core.
- **Pipeline framework** (`pipelines/`) is well-separated from engine logic with a clear `TLlmProvider` interface boundary.

### Actionable Priorities (by effort/benefit)

1. ~~**Split OpenAI provider** into HTTP/agent-retrieval submodules~~ — **SHIPPED 2026-06-28** (`provider.ts` now 457 lines; see §1 strike).
2. **Extract structural validation helpers** from `ExpressionManager` methods — medium effort, would reduce 10 methods by ~60% each. **(Remaining top priority.)**
3. **Split `pipelines/execute.ts`** (DAG scheduler vs single-stage) and **`stage-helpers.ts`** (LLM-specific vs generic) — the other two re-scoped targets.
