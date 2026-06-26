# Outcome — v2.4.0 Conversation primitive + terminal Argument Builder

## What was done

### Layer 1 — Provider support
- Added `TResponseId = string` brand type in `src/lib/llm/types.ts`
- Added `previousResponseId?: TResponseId` to `TLlmRequest<T>` (additive, non-breaking)
- OpenAI provider threads `previousResponseId` as `previous_response_id`
- chat-completions provider ignores it (synchronous, no response-IDs)

### Layer 2 — `executeTurn`
- New `src/lib/conversation/turn.ts` with `executeTurn<TOut>(stage, input, deps)`
- Stateless wrapper: runs one stage, threads `previousResponseId` in, surfaces `responseId` out
- Reuses existing single-stage execution path (retry, validation, events, token accounting)
- Types: `TTurnInput`, `TTurnResult<TOut>`, `TExecuteTurnDeps`

### Layer 3 — `createConversation`
- New `src/lib/conversation/conversation.ts` with `createConversation(deps): TConversation`
- Stateful object: holds response-ID chain + cumulative tokens
- Methods: `.turn(stage, input, opts?)`, `.close()`, `.branchFrom`
- `.turn` after `.close()` throws (`ConversationClosedError`)

### Contract types
- `TMultiTurnInput<I>` and `TMultiTurnOutput<O>` in `src/lib/conversation/contract.ts`

### Three builder turns
- `src/extensions/builder/` — turn factories: `createReviewTurn`, `createSimulateTurn`, `createFinalizeTurn`
- Each is a `TStage` factory
- `finalize` produces `TParsedArgumentResponse` (reuses existing `getParsingResponseSchema(BasicsParsingSchema)` + `BasicsArgumentParser`)
- `finalize` calls `onClose` callback to seal the conversation

### CLI — Terminal Argument Builder
- `src/cli/builder-repl.ts` — minimal `readline` REPL
- `/simulate`, `/finalize`, `/quit` commands

### Exports
- New subpath exports: `@proposit/proposit-core/conversation` and `@proposit/proposit-core/builder`

## Verification

- `pnpm run build` — passes (TypeScript compiles, Typedoc generates)
- `pnpm test` — passes (1989 tests, 60 test files green)
- `pnpm run check` — passes (typecheck, lint, test, build)
- Version bumped 2.3.1 → 2.4.0 (minor)
- Release notes and changelog rotated to v2.4.0

## Capability gate

Leaf capability **chat-build an argument in the terminal** flipped from Missing → Supported.

## What was NOT changed

- `executePipeline` and ingestion untouched
- All changes are additive/non-breaking
