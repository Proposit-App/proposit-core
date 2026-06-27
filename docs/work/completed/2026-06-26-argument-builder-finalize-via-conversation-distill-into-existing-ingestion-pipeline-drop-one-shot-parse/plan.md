# Plan

Scope of this item = the **proposit-core** deliverable (the distill turn). The
server adoption is a sibling task under the parent epic (Phase 4 below describes
it but it is not implemented here).

## Phase 1 — Core: distill turn (replaces one-shot parse)

Touch points:

- `src/extensions/builder/finalize.ts` → rename file to
  `src/extensions/builder/distill.ts`. Replace `createFinalizeTurn` with
  `createDistillTurn`:
  - Drop imports of `buildParsingPrompt` and `ParsedArgumentResponseSchema`.
  - `outputSchema`: a minimal local text wrapper —
    `Type.Object({ argumentText: Type.String({ minLength: 1 }) })`.
  - `system` prompt = the distill instructions (see spec §"Proposed behavior" 1):
    user↔reviewer transcript in; user's final settled argument as one
    self-contained prose statement out; reviewer questions used only to interpret
    the user's answers; drop questions, discarded ideas, simulated-user turns.
  - Keep it the terminal turn: retain `onClose`/`onComplete` sealing and
    `retry.maxAttempts: 1`.
  - Keep `TDistillTurnOptions = { model, reasoningEffort?, onClose }` (same shape,
    renamed type).
- `src/extensions/builder/index.ts` — export `createDistillTurn` /
  `TDistillTurnOptions`; remove the `createFinalizeTurn` exports.

Naming decision: prefer the honest rename (`distill`, not `finalize`) — the turn
distills prose, it no longer finalizes into an argument. This is a breaking
change to the one-version-old `@proposit/proposit-core/builder` subpath; it is
coordinated through the parent epic (only the server consumes it). If churn is
unwanted, the fallback is to keep the `createFinalizeTurn` name and only change
its body + output schema — record that choice in `outcome.md` if taken.

Note: do **not** revert the `src/lib/parsing/prompt-builder.ts` type/role edit —
it is now decoupled from finalize but still valid for the direct-parse consumers
of `buildParsingPrompt`.

## Phase 2 — Core: tests (depends on Phase 1)

Touch points: builder turn tests (the suite currently exercising the finalize
turn — locate via `grep -rn 'createFinalizeTurn\|builder:finalize' test/`).

- Replace finalize-turn assertions with distill-turn ones: the turn emits
  `{ argumentText }` prose, seals the conversation (one `onClose`/`onComplete`),
  and is terminal.
- Add an end-to-end test: a small scripted conversation (mock LLM) → distill turn
  → take `argumentText` → `executePipeline(createScribePipeline(basicsExtension),
  { text: argumentText }, { llm })` → assert a schema-valid
  `TParsedArgumentResponse` whose claims carry `BasicsParsingSchema` enrichment
  (at minimum a citation claim with an `UnparsedCitation`, and a derived `role`).
  This is the regression guard that finalize output == ingestion output.
- Cover the terse/reactive-answer case in the distill mock (the model's distilled
  prose should fold a "yes, and also Y" answer into a standalone claim).
- Decide + test the degenerate path: empty/insufficient distilled text → ingestion
  input is `minLength 1`; mirror `finalizeResponseV2`'s no-claims `failureText`
  rather than throwing.

## Phase 3 — Core: docs sync (parallelizable with Phase 2, finalize after Phase 1)

Evaluate triggers from `CLAUDE.md` Documentation Sync:

- `docs/api-reference.md` [Public-API] — if it documents the builder turns /
  `createFinalizeTurn`, update to `createDistillTurn` and describe the
  distill→ingest sequence (finalize no longer emits `TParsedArgumentResponse`).
- `docs/release-notes/upcoming.md` [Public-API] — plain-language note: builder
  finalize now distills the conversation and runs it through the standard
  ingestion pipeline, so built arguments match ingested ones.
- `docs/changelogs/upcoming.md` [Any-Code-Change] — developer changelog entry
  (rename, dropped one-shot parse, new distill turn + output schema).
- `AGENTS.md` [Routing] — only if a new invariant/route is introduced (none
  expected). Likely no change.
- No `examples/*.yaml` or CLI/smoke-test change expected (the builder is not a CLI
  surface; ingestion schemas are unchanged).

## Phase 4 — Consumer adoption (proposit-server) — SEPARATE node task

Not implemented in this item. Create as a sibling task under the parent epic
(server node). It must:

- Replace the server finalize action's one-shot parse
  (`buildParsingPrompt(BasicsParsingSchema)` / `getParsingResponseSchema(...)`)
  with: run the distill turn → feed `argumentText` to the existing ingestion
  runner (`src/services/tasks/ingestion/sync-run.ts`, `createScribePipeline(
  basicsExtension)`) → existing `persistParserOutput`.
- Delete/invert `finalize-chain.ts` re-rooting
  (`src/components/client/argument-builder/context/`): distill chains off the
  **latest** response (full conversation), not the pre-review one. Update
  `finalize-chain.test.ts` and `argument-builder-embedded.test.tsx`.
- Bump the pinned `@proposit/proposit-core` version once the core change ships.

## Parallelization & dependencies

- Phase 1 → Phase 2 (tests need the new turn).
- Phase 3 can be drafted alongside Phase 2; finalize wording after Phase 1 lands.
- Phase 4 depends on the core change publishing; tracked separately on the server
  node under the epic.

## Verification

```bash
# in proposit-core
pnpm run typecheck
pnpm exec vitest run -t "distill"        # plus the new e2e test file
pnpm run check                           # prettier + eslint + typecheck + full test
```

Green `pnpm run check` in proposit-core is the bar for this item. Server
verification belongs to the Phase 4 sibling task.

## Closeout (later)

- Version bump: **minor** (new `/builder` distill turn; breaking rename on a
  fresh subpath — call it out in release notes). Offer at completion, not now.
- At completion, report the capability parity note to the parent epic for
  capabilities reconcile (see spec §"Capability changes").
