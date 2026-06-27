# Argument Builder finalize via conversation-distill into existing ingestion pipeline (drop one-shot parse)

## Product changes

No new/removed capability. The builder's finalized argument now goes through the
**same ingestion pipeline** as ingested arguments, so it gains the same
enrichment (titles, `UnparsedCitation` objects, derived `role`) and improved
reliability. Report this parity note when the parent epic reconciles capabilities.

## Technical changes

Replace the one-shot finalize parse with **distill → existing ingestion**:

- Core: retarget the terminal builder turn to emit clean single-author prose
  (`createDistillTurn`, `{ argumentText }`) — no `buildParsingPrompt`, no
  `ParsedArgumentResponseSchema`. Still seals the conversation.
- Consumer (server, sibling task under the epic): feed `argumentText` to the
  existing `createScribePipeline(basicsExtension)` → `TParsedArgumentResponse`,
  identical to ingestion. Delete/invert `finalize-chain.ts` re-rooting (distill
  wants the full conversation, not the pre-review response).

One parser, one new prose prompt; Scribe consumed unchanged. See `spec.md` /
`plan.md`. Scope of this item is the proposit-core deliverable.

## Meta changes

Parent epic: `2026-06-21-builder-pipeline-family-socratic-argument-builder-into-core`
(cross-node). The `prompt-builder.ts` type/role edit is kept but decoupled from
finalize.
