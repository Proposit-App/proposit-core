# Stream LLM text deltas to executeTurn and executePipeline callers

> **The spec changed the delivered shape.** `spec.md` deliberately does **not**
> add `onTextDelta` to `TExecuteTurnDeps` (it lists that as a non-goal). Deltas
> arrive instead as a `stage:llm-text-delta` pipeline event on the existing
> `onEvent` channel, carrying the retry `attempt` so a consumer knows to reset
> its accumulated text, plus `TLlmRequest.onTextDelta` at the provider level.
> The request below describes the original ask; the spec's acceptance criteria
> replace the ones at the end of this file.

The raw request is preserved in `intake.md`. This is the written-up request,
re-verified 2026-08-28.

Add an optional `onTextDelta?: (text: string) => void` to `TExecuteTurnDeps`,
threaded parsing → provider → turn, so callers can observe the
`output_text.delta` SSE events the parser currently discards. No behaviour
change when the callback is omitted.

## Still unbuilt, still unblocked

`grep -rn "onTextDelta|TextDelta|output_text.delta"` over `src/`, `dist/` and
`CHANGELOG.md` returns **zero hits**. `TExecuteTurnDeps`
(`src/lib/conversation/turn.ts:61-68`) is still verbatim
`{ llm, signal?, onEvent?, onComplete? }`, and `openai-parsing.ts:77` still
returns `undefined` for every non-terminal event.

`executeTurn` threads deps through a provider wrapper (`turn.ts:127-143`), which
is where the hook is injected alongside the existing response-id capture.

## Corrections to the intake

**Line anchors.** The intake's verified block says the parser handles the
terminal events at `:70-72` and `response.created` at `:73-75`. Actual: `:71-73`
and `:74-76` (`:70` is `const type = parsed.type ?? eventType`).

**Copy the richer precedent.** The intake points at
`readSseEnvelope(response, onResponseId?)`
(`src/extensions/openai/openai-parsing.ts:98-100`), which is the transport-level
half. The **consumer-facing** seam this should mirror already exists one level
up: `onResponseCreated?: (responseId: string) => void` on `TLlmRequest`
(`src/lib/llm/types.ts:47-61`), threaded through `provider.ts:246` as
`onResponseId: notifyResponseId`. `onTextDelta` is that same channel fired
repeatedly instead of once — which is why `effort: low` holds. Mirror
`onResponseCreated`, not `readSseEnvelope`.

**Both provider paths need threading.** Streaming really is live, so the hook
has something to observe: `openai-http.ts:76` sends
`{ ...args.body, stream: true }` then `readSseEnvelope(response)` at `:80`, and
the background variant does the same at `:252`/`:257`. Note `:80` passes **no**
callback today — the non-background path needs threading too, not just the
background one.

## Consumer state

The consumer's streaming plumbing was re-checked on 2026-08-28 and is still
inert exactly as the intake describes: its send-delta method has no callers, and
it calls `executeTurn` from the function that runs an argument-building turn.

## Acceptance criteria

Unchanged from the intake, and concrete:

- A turn with `onTextDelta` supplied receives ≥1 call before `onComplete`, and
  the concatenation of all deltas equals the terminal envelope's raw text.
- A turn with `onTextDelta` omitted behaves identically to today (no throw, same
  terminal envelope).
- An aborted turn (`signal`) stops firing deltas.

## Original intake

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
