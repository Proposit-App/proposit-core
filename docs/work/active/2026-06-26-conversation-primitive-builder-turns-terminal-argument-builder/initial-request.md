# Initial request — Conversation primitive, builder turns, terminal Argument Builder

**Initiative:** [`2026-06-21-builder-pipeline-family-socratic-argument-builder-into-core`](../../../../../docs/work/active/2026-06-21-builder-pipeline-family-socratic-argument-builder-into-core) (epic)
**Node:** proposit-core
**Release:** minor 2.3.1 → **2.4.0**

## The ask

Introduce a `conversation` primitive in core for interactive, user-driven multi-turn LLM exchanges. Reframe the Argument Builder's three actions (`review` / `finalize` / `simulate_user`) as **turns** on a conversation. Give core its own terminal Argument Builder (first interactive CLI surface).

## Scope (per epic spec §4–§6, §9)

### Layer 1 — provider support
- Add `previousResponseId?: TResponseId` to `TLlmRequest<T>` (additive, non-breaking)
- Brand `TResponseId = string` in `src/lib/llm/types.ts`
- OpenAI provider: pass `previousResponseId` as `previous_response_id`
- chat-completions provider: ignore it (synchronous, no response-IDs)

### Layer 2 — `executeTurn`
- New `src/lib/conversation/turn.ts`
- Stateless wrapper: runs one stage, threads `previousResponseId` in, surfaces `responseId` out
- Reuses existing single-stage execution path (retry, validation, events, token accounting)
- Types: `TTurnInput`, `TTurnResult<TOut>`, `TExecuteTurnDeps`

### Layer 3 — `createConversation`
- New `src/lib/conversation/conversation.ts`
- Stateful object: holds response-ID chain + cumulative tokens
- Methods: `.turn(stage, input, opts?)`, `.close()`
- `branchFrom` support for tree-shaped chaining
- `.turn` after `.close()` throws

### Contract types
- `MultiTurnInput<I>` / `MultiTurnOutput<O>` in `src/lib/conversation/contract.ts`

### Three builder turns
- `src/extensions/builder/` — turn factories: `review`, `simulate`, `finalize`
- Each is a `TStage` factory
- `finalize` produces `TParsedArgumentResponse` (same output as ingestion)
- `finalize` calls `.close()` on the conversation

### CLI — terminal Argument Builder
- Minimal `readline` REPL — core's first interactive command
- `/simulate`, `/finalize`, `/quit` commands
- Holds a single `createConversation` for process lifetime

### Out of scope (per epic spec §14)
- Durable/cross-restart response-ID persistence (Group D)
- Moving `provider.tsx` into core
- Local-LLM multi-turn parity beyond transcript-carry fallback
- Generalizing `conversation` beyond the builder (rule of three)

## Capability gate

Declares the leaf capability **chat-build an argument in the terminal** (Missing → Supported) in core's `capabilities.md`.

## Verification (per epic spec §12)

- Conversation threads `previousResponseId` + accumulates `responseId`
- `review`/`simulate` return message + `responseId`
- `finalize` yields schema-valid `TParsedArgumentResponse` and `close()`s
- `branchFrom` runs off a non-tail response
- Contract types compose
- `previousResponseId` round-trips through OpenAI (live-gated `RUN_LIVE_LLM_TESTS`), clean no-op on chat-completions
- `.turn` after `.close()` throws
- CLI smoke test: scripted conversation builds an argument end-to-end

## Dependencies

- None (this is the first child; independent of shared and server)
