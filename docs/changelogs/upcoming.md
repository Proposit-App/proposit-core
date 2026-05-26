# Upcoming changelog

## Added

### v2-multi-stage ingestion pipeline (`src/extensions/argument-ingestion/v2-multi-stage.ts`)

- `createIngestionV2Pipeline(extension): TPipeline<TIngestionInput, TParsedArgumentResponse>`
  wires the 12-stage DAG defined in the ingestion-pipeline overview spec §7.2.
  4 deterministic stages + 8 LLM stages; finalize declares
  `claim-canonicalization` + `variable-assignment` + `formula-compilation`
  as required deps and `claim-type-classification`, `relation-extraction`,
  `conclusion-selection`, `formula-validation`, `claim-reference-validation`
  as optional deps.

### 12 stage modules under `src/extensions/argument-ingestion/stages/`

- **`segmentation`** (`segmentation.ts`) — `gpt-5.4-mini` LLM stage; splits raw input into sentence-or-thereabouts segments.
- **`claim-mention-extraction`** (`claim-mention-extraction.ts`) — `gpt-5.4` LLM stage; extracts un-deduplicated claim mentions per segment.
- **`citation-source-detection`** (`citation-source-detection.ts`) — `gpt-5.4-mini` LLM stage; detects Markdown links + "according to" patterns + bracketed citations.
- **`axiom-indicator-detection`** (`axiom-indicator-detection.ts`) — `gpt-5.4-mini` LLM stage; detects "by definition" / "necessarily true" / etc.
- **`claim-canonicalization`** (`claim-canonicalization.ts`) — `gpt-5.5` (reasoning_effort=medium) LLM stage; factory parameterized on `extension.claimSchema` so the per-claim output carries the extension's discriminated-union shape. Drafts the `suggestedSymbol` for each claim.
- **`claim-type-classification`** (`claim-type-classification.ts`) — `gpt-5.4` LLM stage; refines the canonicalizer's per-claim type with the citation + axiom evidence.
- **`claim-reference-validation`** (`claim-reference-validation.ts`) — deterministic stage; audits miniId collisions, dangling mappings, empty mention ids / lists.
- **`variable-assignment`** (`variable-assignment.ts`) — deterministic stage; symbol-validation regex `/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/` with `p<n>` fallback that skips integers already used by valid suggested symbols.
- **`relation-extraction`** (`relation-extraction.ts`) — `gpt-5.5` (reasoning_effort=high) LLM stage; emits support / joint-support / derivation-support relations.
- **`conclusion-selection`** (`conclusion-selection.ts`) — `gpt-5.5` (reasoning_effort=medium) LLM stage; returns `conclusionMiniId: null` when ambiguous.
- **`formula-compilation`** (`formula-compilation.ts`) — deterministic stage; per-relation compilation rules from spec §7.3 + dedicated conclusion-premise minting.
- **`formula-validation`** (`formula-validation.ts`) — deterministic stage; re-parses each compiled formula via `parseFormula` and verifies every atom resolves to a known variable symbol.

### Shared schemas (`src/extensions/argument-ingestion/stages/schemas.ts`)

- Per-stage TypeBox `outputSchema` definitions matching the spec §7.2 output column.
- `STAGE_IDS` const map naming every stage id used across the v2 pipeline.

### Finalize (`src/extensions/argument-ingestion/shared/finalize-response-v2.ts`)

- `finalizeResponseV2({ ctx, extension })` assembles a `TParsedArgumentResponse`-shaped output from per-stage outputs accumulated by the executor.
- Failure paths from spec §7.5: `{ argument: null, failureText: "No claims could be extracted from the input." }` when canonicalization is empty; `{ argument: null, failureText: "No single conclusion could be selected." }` when `formula-compilation.conclusionPremiseMiniId` is null.
- Role derivation per spec §7.4: `conclusion` / `premise` / `intermediate` derived from the relation graph + selected conclusion.

### Recording-provider v2 support

- `createRecordingLlmProvider(...)` accepts a new `fileName` option so v1 and v2 recordings live side-by-side in each fixture directory (`recorded-llm.json` vs `v2-recorded-llm.json`).

## Tests

- `test/extensions/argument-ingestion/stages/variable-assignment.test.ts` — 17 cases (regex + length + fallback + collision-skip).
- `test/extensions/argument-ingestion/stages/claim-reference-validation.test.ts` — 8 cases covering each failure code.
- `test/extensions/argument-ingestion/stages/formula-compilation.test.ts` — 16 cases (every relation type, conclusion-premise minting, symbol-resolution failure modes).
- `test/extensions/argument-ingestion/stages/formula-validation.test.ts` — 8 cases (parse-error paths + symbol-unresolved paths).
- `test/extensions/argument-ingestion/stages/llm-stages.test.ts` — 15 cases (one happy-path round-trip per LLM stage + dep-shape assertions).
- `test/extensions/argument-ingestion/v2-multi-stage.test.ts` — 6 cases (factory shape + DAG validation + happy-path mock-LLM chain + both `argument: null` failure paths).
- `test/extensions/argument-ingestion/v2-e2e.test.ts` — golden-corpus replay driver for the 5 existing fixtures (skipped until `v2-recorded-llm.json` files are committed).

## Commits

- `<sha>` feat(ingestion-v2): add 4 deterministic stages + shared schemas
- `<sha>` feat(ingestion-v2): add 8 LLM stages + v2 pipeline factory + finalize
