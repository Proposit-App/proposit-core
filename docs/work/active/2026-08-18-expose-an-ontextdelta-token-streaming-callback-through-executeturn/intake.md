## Inbox manifest

- `2026-08-12-expose-an-ontextdelta-token-streaming-callback-through-executeturn.md`

## Inbox body

# Expose an onTextDelta token-streaming callback through executeTurn

> Requested by a downstream consumer on 2026-07-30; accepted here on 2026-08-12.
> Original entry title: *proposit core expose an ontextdelta token streaming
> callback through executeturn*.

**Target:** `proposit-core`. The consumer has a streaming item for which this is
a hard blocker.

## Problem

The consumer's argument-building review and simulate turns render as
spinner-then-blob. The consumer already has every piece needed to stream them
token-by-token *except* a way to observe deltas as the turn runs: its task
manager has a send-delta-to-subscribers method with no callers, its streaming
route already forwards deltas, and its client accumulator is wired. All three
are inert because nothing feeds them.

## Root cause

`TExecuteTurnDeps` (`src/lib/conversation/turn.ts:60-68`) is
`{ llm, signal?, onEvent?, onComplete? }`. `onEvent` carries `TPipelineEvent`
(stage lifecycle), not tokens. There is no text-delta hook.

The OpenAI provider consumes the SSE stream internally and surfaces only the
terminal envelope — `src/extensions/openai/openai-parsing.ts:81-92`.
The `output_text.delta` events **already arrive and are discarded**: the parser
returns `undefined` for intermediate events and handles only `response.created`
and the terminal ones.

## Proposed fix

Add an optional `onTextDelta?: (text: string) => void` to `TExecuteTurnDeps`,
threaded parsing → provider → turn. The precedent for the plumbing already
exists one function over: `readSseEnvelope(response, onResponseId?)` threads a
one-shot response-id callback through the same seam for background mode. This is
the same shape, fired repeatedly instead of once.

No behaviour change when the callback is omitted.

## Why this is not covered elsewhere

Checked before filing: earlier work on the argument-building pipeline
deliberately left SSE streaming to the consumer, and the nearest neighbour,
`provider-streaming-and-openai-background-mode`, shipped background mode plus
*internal* SSE consumption, i.e. the plumbing underneath this callback, not a
consumer-facing delta hook. So this was never filed, never triaged, and never
deferred.

## Consumer impact

One consumer's server only. Its work after this lands is one wiring point in the
function that runs an argument-building turn, which lights up both the review
and simulate paths at once, plus a tolerant partial-JSON extractor.

That extractor is needed because `ParsedArgumentResponseSchema`
(`dist/lib/parsing/schemata.js:39-43`) orders `argument` → `uncategorizedText` →
`selectionRationale` → `failureText`, so raw deltas arrive behind a
`{"argument":null,"uncategorizedText":"` prefix with the prose escaped. That
extraction is the consumer's problem, not core's — noted so the seam design
accounts for deltas being mid-JSON-string rather than clean prose.

## Test cases

- A turn with `onTextDelta` supplied receives ≥1 call before `onComplete`, and
  the concatenation of all deltas equals the terminal envelope's raw text.
- A turn with `onTextDelta` omitted behaves identically to today (no throw, same
  terminal envelope).
- An aborted turn (`signal`) stops firing deltas.

## Verified 2026-08-18

Every load-bearing claim holds. Line numbers corrected below — the entry was
written against core 3.2.0 and the repo is now at 4.0.1.

- **The seam is exactly as described and still has no delta hook.**
  `TExecuteTurnDeps` is at `src/lib/conversation/turn.ts:61-68` (entry said
  `:60-68`) and is verbatim `{ llm, signal?, onEvent?, onComplete? }`. A
  whole-`src/` grep for `onTextDelta` returns zero hits.
- **Intermediate SSE events are still discarded.** The event parser in
  `src/extensions/openai/openai-parsing.ts` handles only the terminal events
  (`:70-72`) and `response.created` (`:73-75`), then `return undefined` at
  `:77`. `output_text.delta` falls through that `undefined`.
- **The precedent seam is real and is the right shape to copy.**
  `readSseEnvelope(response, onResponseId?)` is declared at
  `src/extensions/openai/openai-parsing.ts:98-100`, and its JSDoc (`:87-93`)
  describes exactly the mid-flight, before-the-terminal-event callback this
  entry wants, fired once instead of repeatedly.
- **`executeTurn` threads deps through a provider wrapper**
  (`turn.ts:127-143`), which is where an `onTextDelta` would be injected
  alongside the existing response-id capture.

### Not verified

The consumer-side details in the "Problem" and "Consumer impact" sections were
not re-checked — they describe the consumer's code, not core's, and none of them
changes what core has to build.
