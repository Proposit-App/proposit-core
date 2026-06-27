# Spec

## Capability changes

No new or removed user capability. This is an internal re-wiring of the existing
"build an argument by conversation, then finalize it into a Proposit argument"
capability. Two side effects worth recording at reconcile time:

- **Output parity:** builder-finalized arguments will now carry the same
  enrichment as ingested ones (claim `title`/`body`, `UnparsedCitation` objects,
  premise/argument `title`, deterministically-derived `role`), because they go
  through the same ingestion pipeline. Any capability doc that describes the
  builder's output should point at ingestion parity rather than its own shape.
- **Reliability:** decomposed multi-stage extraction is more reliable than a
  single LLM call emitting the entire structured argument at once.

No `capabilities.md` rewrite is required; flag the parity note when the parent
epic reconciles capabilities.

## Problem

The builder finalize turn (`createFinalizeTurn`,
`src/extensions/builder/finalize.ts`) is a one-shot LLM parse: it runs
`buildParsingPrompt(ParsedArgumentResponseSchema)` with
`outputSchema: ParsedArgumentResponseSchema` and emits a
`TParsedArgumentResponse` directly. It is a parallel, lower-fidelity
re-implementation of the ingestion pipeline, and the two have already drifted:

1. **Schema drift.** Finalize uses the **bare** `ParsedArgumentResponseSchema`.
   Ingestion (`createScribePipeline`/`createScholarPipeline`) advertises
   `extension.responseSchema` — for the default `basicsExtension` that is
   `BasicsParsingSchema`, which adds per-entity fields (claim `title`/`body`,
   citation `url`/`citationTypeGuess`, axiom `axiom`, premise `title`, argument
   `title`). So finalize structurally cannot produce what ingestion produces,
   despite the parent epic's spec (§200, §204–206) calling for
   `buildParsingPrompt(BasicsParsingSchema)` / `getParsingResponseSchema(BasicsParsingSchema)`.
   And `TFinalizeTurnOptions` exposes no schema hook, so a consumer cannot fix
   this from outside.

2. **Prompt drift.** The one-shot prompt is the only path that asks the model to
   get the full combined schema right in one call — including `type` vs `role`,
   which the recent `prompt-builder.ts` edit had to clarify. Ingestion instead
   derives `role` deterministically (`finalizeResponseV2` → `buildClaimToRole`)
   and classifies `type` in a dedicated stage, so it never relies on the model
   to keep those orthogonal in one shot.

## Goals

- One parser. The builder's finalized output is produced by the **existing
  ingestion pipeline**, so it is identical to ingestion by construction.
- Delete the one-shot finalize parse (`finalize.ts`'s use of
  `buildParsingPrompt` + `ParsedArgumentResponseSchema`).
- Confine all "this is a multi-speaker conversation" knowledge to a single
  prose→prose distill prompt; ingestion stays untouched.

## Non-goals

- Forking/duplicating Scribe or adding conversation-aware pipeline stages.
- Dialectic / turn-structure capture.
- Touching `review`/`simulate` turns or the conversation primitive's core.
- Re-running a full capabilities authoring pass.

## Current-state findings

- `src/extensions/builder/finalize.ts` — `createFinalizeTurn` builds
  `buildParsingPrompt(ParsedArgumentResponseSchema)`, returns an `llmStage` with
  `outputSchema: ParsedArgumentResponseSchema`, `retry.maxAttempts: 1`, and seals
  the conversation via `options.onClose` (invoked through `executeTurn`'s
  `onComplete`). `TFinalizeTurnOptions = { model, reasoningEffort?, onClose }` —
  no schema parameter.
- `src/extensions/builder/review.ts` — review turns are deliberately
  **prose-only**: *"do NOT attempt to parse or structure the argument. Just ask
  questions."* So the transcript is plain prose; there are no competing
  structured-argument versions to disambiguate.
- `src/lib/conversation/turn.ts` — `executeTurn` runs one `TStage`, threads
  `previousResponseId` for provider-side reference chaining, and overrides the
  stage's user message via `TTurnInput.userMessage` (caller assembles the
  transcript when the provider cannot chain by reference). `onComplete` seals the
  conversation for terminal turns. A distill turn fits this contract unchanged.
- Ingestion entry: `createScribePipeline(extension, options?)` →
  `TPipeline<TIngestionInput, TParsedArgumentResponse>`; `TIngestionInput`/
  `INGESTION_INPUT_SCHEMA` = `{ text: string (minLength 1) }`
  (`scholar.ts:76`). `outputSchema` = `extension.responseSchema`. Run via
  `executePipeline(pipeline, { text }, { llm, ... })`.
- Ingestion finalize (`finalizeResponseV2`) deterministically derives `role`
  from relations + conclusion-selection, attaches `UnparsedCitation` to citation
  claims, and composes premise/argument titles. None of this exists on the
  builder's one-shot path.
- Consumer (server): `finalize` action runs the finalize turn, then
  `BasicsArgumentParser` + `persistParserOutput`. `finalize-chain.ts`
  (`proposit-server/src/components/client/argument-builder/context/`) re-roots
  the finalize call off the **pre-review** response (via `branchFrom`) to keep
  Socratic questions out of the parse. The server already runs ingestion through
  `executePipeline` in `src/services/tasks/ingestion/sync-run.ts`.
- The recent `src/lib/parsing/prompt-builder.ts` type/role edit is now
  **decoupled** from finalize (finalize stops using `buildParsingPrompt`) but
  remains a valid improvement for the remaining direct-parse consumers of
  `buildParsingPrompt`. Keep it; it is not part of this task's diff.

## Proposed behavior

1. **Core: distill turn replaces the one-shot parse.** Retarget the terminal
   builder turn so it emits **prose**, not a parsed argument:
   - System prompt (new): "You are reading a conversation between a user building
     an argument and a Socratic reviewer. Output the user's final, settled
     argument as one self-contained prose statement. Use the reviewer's questions
     only to interpret the user's answers — resolve reactive answers into
     standalone claims. Ignore the questions themselves, discarded ideas, and any
     simulated-user turns."
   - `outputSchema` = minimal text wrapper (e.g. `Type.Object({ argumentText:
     Type.String({ minLength: 1 }) })`). No parsing schema, no
     `buildParsingPrompt`, no `ParsedArgumentResponseSchema` import.
   - Still the terminal turn: seals the conversation via `onComplete`/`onClose`.
   - The whole transcript reaches it via the existing chaining (`previousResponseId`
     / `userMessage`) — chaining off the **latest** turn (full conversation), not
     a re-rooted pre-review response.

2. **Consumer (server, sibling task): distill → existing ingestion.** Replace the
   server's one-shot finalize parse with: run the distill turn → feed
   `argumentText` to the server's existing ingestion runner
   (`createScribePipeline(basicsExtension)` via `executePipeline({ text })`) →
   existing `persistParserOutput`. Output is `TParsedArgumentResponse` shaped as
   `BasicsParsingSchema` — identical to ingestion.

3. **Re-rooting inverts → `finalize-chain.ts` removed.** The old re-rooting
   existed to parse the clean *pre-review* argument and dodge Socratic noise.
   Distill deliberately *wants* the full conversation (questions as context for
   answers), so it chains off the latest response and `finalize-chain.ts`'s
   re-rooting is deleted/simplified.

## Acceptance criteria

- `createFinalizeTurn` (or its renamed successor) emits prose and no longer
  imports `buildParsingPrompt` or `ParsedArgumentResponseSchema`; it still seals
  the conversation.
- A core test drives a small conversation → distill turn → prose →
  `createScribePipeline(basicsExtension)` → a schema-valid
  `TParsedArgumentResponse` whose claims carry the `BasicsParsingSchema`
  enrichment (e.g. a citation claim with an `UnparsedCitation`).
- `pnpm run check` is green in `proposit-core`.
- Server adoption is tracked as a sibling task under the parent epic (re-rooting
  inversion, delete the one-shot finalize parse). Not required to land in this
  core task.

## Risks / dependencies / related

- **Risk — distill fidelity.** A bad distillation poisons the whole parse. Keep
  the prompt explicit about "user's final settled position, questions as context
  only," and cover terse/reactive answers in the test.
- **Risk — empty/degenerate transcript.** Distill must still produce non-empty
  text (ingestion input is `minLength 1`); decide failure behavior (likely an
  empty-argument `failureText`, mirroring `finalizeResponseV2`'s no-claims path).
- **Cost/latency.** distill (1 call) + full Scribe (multi-stage) > one finalize
  call. Acceptable: finalize runs once per build session, not on a hot path.
- **Dependency.** Parent epic
  `2026-06-21-builder-pipeline-family-socratic-argument-builder-into-core`
  (cross-node: core → shared → server). The server adoption is the consumer half.
- **Related.** `prompt-builder.ts` type/role edit (already made; keep, now
  decoupled from finalize).
