# Initial request

**Parent epic (cross-node):** `docs/work/active/2026-06-21-builder-pipeline-family-socratic-argument-builder-into-core`
**Node:** proposit-core — scope is the proposit-core deliverable; the server adoption is a sibling task under the epic.

## Requested outcome

Replace the Argument Builder's **finalize** step. Today finalize is a single
LLM call that parses the whole conversation straight into a
`TParsedArgumentResponse` using `buildParsingPrompt(...)` — effectively a
one-shot re-implementation of the ingestion pipeline (Scribe). Two parsers that
both emit `TParsedArgumentResponse` are now drifting:

- The finalize turn uses the **bare** `ParsedArgumentResponseSchema`, while
  ingestion (Scribe/Scholar) advertises the **extension** schema
  (`BasicsParsingSchema`) — so finalize omits the enrichment ingestion produces
  (claim `title`/`body`, `UnparsedCitation` objects, premise/argument `title`,
  deterministically-derived `role`). The work-item spec for the parent epic
  (§200, §204–206) actually specifies `BasicsParsingSchema`, but the code
  hardcodes the bare schema — a latent mismatch.
- The one-shot prompt is the only place the model is asked to get `type` vs
  `role` right in one combined schema (the recent `prompt-builder.ts` type/role
  clarification was patching exactly this failure mode).

Instead: **distill the conversation into clean single-author prose, then run the
existing ingestion pipeline on that prose.** One parser. Finalize's output then
matches ingestion by construction.

```
transcript --(distill: 1 LLM call, prose→prose)--> clean single-author argument text
            --> existing ingestion pipeline (Scribe + basicsExtension) --> TParsedArgumentResponse
```

## Decisions already made

- **Distill is a prose→prose step, no schema.** It has no parsing/structuring
  responsibility, so it cannot drift from the parser. That is the whole point —
  the current finalize drifts *because* it is a second thing that emits
  `TParsedArgumentResponse`.
- **Do not fork Scribe.** No new pipeline composed from Scribe's stage
  instances, and no "conversation-aware" stages. Composing a second pipeline
  from shared stages just relocates the drift from "two prompts" to "two stage
  lists." Scribe stays a black box, consumed unchanged, so every Scribe
  improvement flows through for free.
- **Feed the whole transcript to distill**, not just the user's messages. The
  reviewer's questions are needed only as *context* to interpret the user's
  (often terse, reactive) answers — distill resolves "Q: …? → A: yes, and also
  Y" into a standalone claim. The "this is a conversation, multiple speakers"
  framing lives **only** in the distill prompt; the ingestion pipeline keeps
  receiving single-author text and is never told it was a conversation.
- **No dialectic preservation.** We do not need to capture which claims were
  challenged/conceded or map turn structure onto argument structure. Goal is
  only "the user's resulting argument as a Proposit argument." (If dialectic
  capture is ever wanted, that is a richer, separate feature — out of scope.)

## Constraints / non-goals

- `proposit-core` owns no app metadata, no user/session concepts — keep the
  distill turn a generic conversation turn (consistent with `review`/`simulate`).
- Non-goal: changing the Socratic `review`/`simulate` turns.
- Non-goal: dialectic/turn-structure capture.

## Open questions for spec

- Distill output schema shape: bare string vs a minimal `{ argumentText }`
  object (llmStage requires an `outputSchema`).
- Naming: retarget `createFinalizeTurn` in place, or rename to
  `createDistillTurn` and have the consumer own the "distill → ingest" sequence.
- Server adoption (`finalize-chain.ts` re-rooting inversion) is consumer-side —
  scope here is the core deliverable; the server adoption is a sibling task
  under the parent epic.

## Product / capability impact

No new or removed capability. The builder's finalized argument now flows through
the **same ingestion pipeline** as ingested arguments, so it gains the same
enrichment (titles, `UnparsedCitation` objects, derived `role`) and improved
reliability. Report this parity note when the parent epic reconciles
capabilities.

## Resolutions

- **Distill output schema:** a minimal `{ argumentText }` object (not a bare
  string).
- **Naming:** the terminal builder turn is renamed `createFinalizeTurn` →
  `createDistillTurn` and emits clean single-author prose — no
  `buildParsingPrompt`, no `ParsedArgumentResponseSchema` — while still sealing
  the conversation. The consumer owns the "distill → ingest" sequence.
- **Consumer (server) adoption:** feed `argumentText` to the existing
  `createScribePipeline(basicsExtension)` → `TParsedArgumentResponse`, identical
  to ingestion; delete/invert the `finalize-chain.ts` re-rooting because distill
  wants the full conversation, not the pre-review response. One parser, one new
  prose prompt; Scribe consumed unchanged.
- **`prompt-builder.ts` type/role edit** is kept but decoupled from finalize.
- See `spec.md` / `plan.md` for full detail.
