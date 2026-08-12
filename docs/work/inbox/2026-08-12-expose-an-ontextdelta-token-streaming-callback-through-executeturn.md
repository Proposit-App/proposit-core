---
from: proposit-app
---

# Expose an onTextDelta token-streaming callback through executeTurn

> Escalated by `proposit-server` on 2026-07-30; routed here by the orchestrator on 2026-08-12. Original entry title: *proposit core expose an ontextdelta token streaming callback through executeturn*.

**Target node:** `proposit-core`. Consumer: `proposit-server` backlog item
`2026-07-01-stream-openai-review-responses-to-client` (priority 5), for which
this is a hard blocker — its own plan calls it "Phase 0".

## Problem

The Argument Builder's review and simulate turns render as spinner-then-blob.
The server already has every piece needed to stream them token-by-token *except*
a way to observe deltas as the turn runs:

- `TaskManager.sendDeltaToSubscribers` (`src/services/tasks/task-manager.ts:122`)
  exists and has zero callers.
- The SSE route (`src/app/api/v1/task/[taskId]/route.ts`) already forwards deltas.
- The client accumulator (`addMessageDelta` in the builder provider) is wired.

All three are inert because nothing feeds them.

## Root cause

`TExecuteTurnDeps` (`proposit-core/src/lib/conversation/turn.ts:60-68`) is
`{ llm, signal?, onEvent?, onComplete? }`. `onEvent` carries `TPipelineEvent`
(stage lifecycle), not tokens. There is no text-delta hook.

The OpenAI provider consumes the SSE stream internally and surfaces only the
terminal envelope — `proposit-core/src/extensions/openai/openai-parsing.ts:81-92`.
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

Checked before filing:

- The 2026-06-21 builder-pipeline epic deliberately left this behind — its
  "what moves vs what stays" table (`spec.md:230`) lists **SSE streaming** under
  "stays in the server (orchestration shell)".
- `2026-07-17-chat-builder-mobile` went the other way on purpose: "Slice 1 —
  proposit-shared (blocking): add a thin **non-streaming** `build()` method."
- The 2026-07-17 lost-inbox audit enumerated all 13 archived proposit-server
  requests; none is this one. The nearest neighbour,
  `provider-streaming-and-openai-background-mode`, shipped — but that is
  background mode plus *internal* SSE consumption, i.e. the plumbing underneath
  this callback, not a consumer-facing delta hook.

So this was never filed, never triaged, and never deferred.

## Consumer impact

`proposit-server` only; `proposit-mobile` does not consume builder turns this
way today. Server-side work after this lands is one wiring point in
`runBuilderTurn` (`src/services/tasks/executors/argument-build.ts:117`), which
lights up both the review and simulate paths at once, plus a tolerant
partial-JSON extractor.

That extractor is needed because `ParsedArgumentResponseSchema`
(`dist/lib/parsing/schemata.js:39-43`) orders `argument` → `uncategorizedText` →
`selectionRationale` → `failureText`, so raw deltas arrive behind a
`{"argument":null,"uncategorizedText":"` prefix with the prose escaped. That
extraction is the server's problem, not core's — noted so the seam design
accounts for deltas being mid-JSON-string rather than clean prose.

## Test cases

- A turn with `onTextDelta` supplied receives ≥1 call before `onComplete`, and
  the concatenation of all deltas equals the terminal envelope's raw text.
- A turn with `onTextDelta` omitted behaves identically to today (no throw, same
  terminal envelope).
- An aborted turn (`signal`) stops firing deltas.

## Note for the triaging orchestrator

The consumer item's own `plan.md:12` currently instructs a future agent to
hand-write a file at `../proposit-core/docs/inbox/…`, a path that does not
exist. That line is being corrected in the same pass that filed this request;
the seam description above was re-verified against core 3.2.0 and is current.

