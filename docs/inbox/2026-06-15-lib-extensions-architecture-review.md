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

### src/extensions/openai/provider.ts — 1,589 lines
**Issue:** One huge factory function (`createOpenAiResponsesProvider`) containing the full `respond` closure (200+ lines) plus retrieval functions (`retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse`) and ~20 helper functions. The `respond` method handles: HTTP fetch routing, error classification, tool-call agent loops, streaming/poll/background modes, function-call parsing, schema conversion — all in one nested closure.

**Suggestion:** Split at natural seams:
- **HTTP layer** (`fetchResponseEnvelope`, `callOnce`, `getResponseById`, `cancelBackground`, SSE helpers) → already partially separated into a `-- HTTP --` section; extract to `openai-http.ts`.
- **Error classification** (`classifyHttpError`, incomplete-reason handling) → `openai-errors.ts` (move beyond the existing error *types* file).
- **Tool translation + agent loop** (translateTools, findFunctionHandler, function-call parsing) → `openai-tools.ts`.
- **Background/retrieval API** (`retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse`) → `openai-retrieval.ts`.

### src/lib/pipelines/execute.ts — 1,278 lines
**Issue:** One module exports the whole-DAG scheduler (`executePipeline`), single-stage entry points (`executeStage`, `executeFinalize`), launch/complete split (`launchStage`, `completeStage`), and ~10 helper functions. The scheduler loop alone is ~140 lines; each stage-run/error-handling path is heavily inlined.

**Suggestion:** Split by execution mode:
- **DAG scheduler** → `pipelines/scheduler.ts` (the concurrent pool loop, DAG validation)
- **Single-shot entry points** → `pipelines/single-stage.ts` (`executeStage`, `executeFinalize`, rehydration logic)
- **Launch/complete split** → already partially separated; keep but extract the shared state builder and LLM config helpers out to `pipelines/stage-helpers.ts` (which is 873 lines — see below).

---

## 2. Medium Files (>500 lines, <1000) — Mostly Fine, Some Flags

| File | Lines | Notes |
|------|-------|-------|
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | 730 | Interface file; acceptable for JSDoc-heavy interfaces. |
| `src/lib/parsing/argument-parser.ts` | 774 | Could benefit from extracting the parsing rules into separate modules per rule type (D-1 through D-7). |
| `src/lib/core/evaluation/argument-evaluation.ts` | 757 | Contains grading, evaluation defaults by claim type, and inference path logic. Consider splitting `grading` out (already exists in `grading.ts` alongside it). |
| `src/lib/pipelines/stage-helpers.ts` | 873 | Helper functions for pipeline stages. Split LLM-specific helpers from generic stage utilities. |
| `src/lib/grammar/an-rules.ts` | 857 | Auto-normalization rules (AN-1 through AN-4). Each rule is a self-contained pass; consider exporting each as a separate module function. |

---

## 3. Separation of Concerns — Flags

### 3a. `src/lib/core/` is a god-folder
The `core/` directory has **29 files** and carries the entire argument engine, premise engine, expression management, checksum protocol, library management (claim/axiom/citation), fork operations, diff logic, and relationship tracking. Several of these could live in their own subdirectories:

- `core/evaluation/` already exists (4 files) for evaluation-specific logic — good pattern.
- `core/interfaces/` already exists (5 files) for interface contracts — good.
- But `core/claim-library.ts`, `core/claim-axiom-library.ts`, `core/claim-citation-library.ts`, and `core/argument-library.ts` could be grouped under `core/libraries/`.

**Suggestion:** Create a `core/libraries/` subfolder for the four library classes. Keep `core/` for the core engine primitives (ArgumentEngine, PremiseEngine, ExpressionManager, VariableManager).

### 3b. `src/extensions/argument-ingestion/stages/` has deep nesting
16 stage files in one folder under `extensions/argument-ingestion/stages/`. Each is a reasonable size (100–340 lines) but the folder itself is sprawling. The stages represent distinct pipeline phases with their own types, schemas, and execution logic — some could be co-located with their schema definitions.

**Suggestion:** Group stages by domain:
- `stages/proposal/` — segmentation, conclusion-selection, variable-assignment
- `stages/clause/` — claim-type-classification, claim-canonicalization, claim-reference-validation, citation-source-detection, axiom-indicator-detection
- `stages/formula/` — formula-compilation, formula-validation, relation-extraction

### 3c. ExpressionManager owns checksum dirty management but isn't told about it
`ExpressionManager.flushExpressionChecksums()` is a public method that must be called at the boundary of every mutation in both `ExpressionManager` and `PremiseEngine`. The dirty-set logic is complex (bottom-up processing, depth sorting) yet tightly coupled to the expression store.

**Suggestion:** This is already well-encapsulated within `ExpressionManager`. No action needed — just noting that it's a *concern* of ExpressionManager rather than its own class because splitting it would require the dirty-set to know about the expression store (circular dependency).

---

## 4. Overall Health Assessment

### Strengths
- **Good modular boundaries at the extension level:** OpenAI, Ollama, IEEE, and argument-ingestion are clearly separated with no cross-imports between them.
- **Interface files separate contracts from implementations.** The interface JSDoc is the canonical, tracked home for the public-engine-API documentation (see CLAUDE.md Documentation Sync `[Public-Engine-API]`) — it is required surface for a published library, not bloat.
- **`src/lib/` has zero third-party SDK imports** (as per invariants), keeping SDK coupling out of core.
- **Pipeline framework** (`pipelines/`) is well-separated from engine logic with a clear `TLlmProvider` interface boundary.

### Actionable Priorities (by effort/benefit)

1. **Split OpenAI provider** into HTTP/agent-retrieval submodules — medium effort, improves testability of each mode.
2. **Extract structural validation helpers** from `ExpressionManager` methods — medium effort, would reduce 10 methods by ~60% each.
