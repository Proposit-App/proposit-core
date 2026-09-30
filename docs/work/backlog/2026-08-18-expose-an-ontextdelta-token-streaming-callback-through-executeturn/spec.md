# Spec — Expose LLM text deltas to `executeTurn` and `executePipeline` callers

## Capability changes

**None.** `proposit-core` declares no capability store — `tcw capabilities list`
returns nothing and `tcw-config.yaml` has no `capabilities` key. This node's
taxonomy is registered (`tcw taxonomy list`) but its entries describe the
argument domain (claims, premises, expressions, grammar tiers), not the pipeline
framework. The delta here is a library observability surface for a downstream
consumer, so no Vocabulary or Feature entry moves.

The user-visible capability this unblocks — a consumer's argument builder
rendering a reply token-by-token instead of spinner-then-blob — belongs to that
consumer and is tracked there.

## Problem

The OpenAI Responses API already streams `response.output_text.delta` events
into this library, and the library already consumes them live. It discards
every one.

`parseSseEvent` (`src/extensions/openai/openai-parsing.ts:44-78`) recognises
exactly two event families — the three terminal events
(`openai-parsing.ts:14-18`, matched at `:71-73`) and `response.created`
(`:23`, matched at `:74-76`) — and returns `undefined` at `:77` for everything
else. `readSseEnvelope`'s `handleEvent` (`:113-125`) therefore drops each delta
on the floor, and the function returns only the terminal envelope (`:166`).

Nothing downstream can see partial output. `TExecuteTurnDeps`
(`src/lib/conversation/turn.ts:61-68`) is verbatim
`{ llm, signal?, onEvent?, onComplete? }`, and the `TPipelineEvent` union
(`src/lib/pipelines/types.ts:122-207`) carries stage lifecycle, prompts, and the
response id, but no token payload. A repo-wide grep for `onTextDelta` returns
zero hits.

The consequence for the consumer is that its streaming plumbing is inert: its
send-delta method has no caller because nothing feeds it, and it calls
`executeTurn` with only an `llm` — no observability hook at all.

### Why the streaming already runs

This is not a "turn streaming on" request. Foreground SSE is the default:
`const useStream = options.stream ?? true` (`src/extensions/openai/provider.ts:150`).
So every ordinary call already opens an event stream, parses each frame, and
throws the deltas away.

## Goals

1. A consumer of `executeTurn` can observe assistant text as it is generated,
   before the call resolves.
2. The same signal reaches a consumer of `executePipeline` / `executeStage`,
   since the deltas are produced one layer below both.
3. The signal carries enough context to survive a retry: a consumer must be
   able to tell a second attempt's deltas from the first attempt's.
4. Absolute backward compatibility. A caller that does not opt in observes no
   behavioural change of any kind — same terminal envelope, same events, no
   throw, no extra allocation on the hot path beyond an undefined check.

## Non-goals

- **Streaming on the launch/complete background path.** `launchStage`
  (`src/lib/pipelines/single-stage.ts:366-370`) calls
  `deps.submitBackgroundResponse`, a submit-only capability; core never holds
  that stream, so it has no deltas to emit. Out of scope and stated as a
  documented limitation, not a gap to close.
- **Streaming on the poll-only background path.** `runBackground`
  (`src/extensions/openai/openai-http.ts:260-346`) submits without `stream` and
  polls `getResponseById`; there is no SSE stream at all.
- **The chat-completions provider.** `src/extensions/chat-completions/` makes a
  single blocking call and has no SSE reader. It leaves the new hook uncalled,
  exactly as it already leaves `onResponseCreated` uncalled
  (`chat-completions/provider.ts:9`).
- **Reassembling partial JSON.** Deltas arrive mid-structured-output, so a
  consumer sees `{"argument":null,"uncategorizedText":"` before any prose, with
  the prose escaped. Extracting readable text from a partial envelope is the
  consumer's problem; the intake says so and this spec agrees.
- **Reasoning-summary deltas, tool-call argument deltas, refusal deltas.** Other
  event families the parser also discards. Assistant output text only.
- **Changing `TExecuteTurnDeps`.** See the design note below.

## Design

### The surface: a pipeline event, not a deps callback

The filed request proposes `onTextDelta?: (text: string) => void` on
`TExecuteTurnDeps`, set by `turn.ts`'s provider wrapper, "mirroring"
`onResponseCreated`. Reading the code, that mirror does not hold, and this spec
deliberately departs from the proposed shape. Three grounded reasons:

**`onResponseCreated` is not a consumer surface.** It is a field on
`TLlmRequest` (`src/lib/llm/types.ts:47-61`) that the *pipeline* attaches, not
the caller: `buildLlmRequest` leaves it unset on purpose
(`src/lib/pipelines/llm-stage-helpers.ts:241-243`) and
`runLlmStageAttempt` assigns its own emitter at `:523`. What that emitter does
(`:506-517`) is republish the signal as a `stage:llm-response-created` pipeline
event. The consumer-facing half of the precedent is the event, not the callback.

**The event channel already reaches both callers.** `ctx.emit` is wired to
`deps.onEvent` (`src/lib/pipelines/single-stage.ts:186`), and `executeTurn`
already forwards `deps.onEvent` into `executeStage`
(`src/lib/conversation/turn.ts:174`). An event therefore lands with
`executeTurn` and `executePipeline` callers alike, and `turn.ts` needs no change
whatsoever — no new field on `TExecuteTurnDeps`, no new mutation in
`wrapProviderForTurn` (`:89-111`).

**A bare `(text: string) => void` is wrong under retry.** `runLlmStageAttempt`
runs inside a retry loop; a schema-validation failure re-issues the call and
streams a second set of deltas. A callback with no attempt index gives the
consumer no way to know its accumulator must be reset, so the failed attempt's
partial text concatenates with the retry's. That silently violates the request's
own acceptance criterion that the deltas concatenate to the terminal text.
Carrying `attempt` makes the reset unambiguous, matching how
`stage:llm-request`, `stage:llm-response-created` and `stage:llm-call` all
already carry it.

### The new event

Added to the `TPipelineEvent` union in `src/lib/pipelines/types.ts`, between the
`stage:llm-response-created` variant (`:164-182`) and `stage:llm-call`
(`:183-207`):

```ts
| {
      kind: "stage:llm-text-delta"
      stageId: string
      /** 1, 2, ... — the attempt these deltas belong to. */
      attempt: number
      /** One chunk of assistant output text, as the provider emitted it. */
      delta: string
      at: number
  }
```

`delta` is the raw chunk, never accumulated by core. Accumulation is the
consumer's, and keeping core stateless here is what makes the retry semantics
expressible: deltas belong to an attempt, and the consumer resets when
`attempt` changes.

Per-attempt ordering becomes:

```
stage:start → stage:llm-request → [stage:llm-response-created]
            → stage:llm-text-delta* → stage:llm-call → stage:end
```

### The threading, bottom to top

1. **`openai-parsing.ts`** — `TParsedSseEvent` (`:25-28`) gains a third member,
   `{ kind: "delta"; text: string }`. `parseSseEvent` recognises
   `response.output_text.delta` and returns it. The parsed-data type at `:56-61`
   widens to carry the event's `delta` string field.
2. **`readSseEnvelope`** (`:98-101`) gains a second optional callback parameter
   alongside `onResponseId`; `handleEvent` (`:113-125`) invokes it per delta
   event. Unlike `onResponseId` it fires many times, so it carries no
   once-only guard.
3. **`openai-http.ts`** — `fetchResponseEnvelope`'s args (`:40-51`) gain the
   optional callback, passed into `readSseEnvelope` on **both** streaming
   branches: the foreground path at `:80` and `runBackgroundStream` at `:257`.
4. **`provider.ts`** — a new optional `onTextDelta?: (text: string) => void` on
   `TLlmRequest` (`src/lib/llm/types.ts:37-78`), threaded into the
   `fetchResponseEnvelope` call (`:236-247`) beside the existing
   `onResponseId: notifyResponseId` (`:246`).
5. **`llm-stage-helpers.ts`** — `runLlmStageAttempt` assigns its own emitter at
   the same seam that already assigns `onResponseCreated` (`:522-523`), closing
   over `cfg.id` and `attempt` and calling `ctx.emit`.

`buildLlmRequest` continues to leave the field unset, for the same reason it
leaves `onResponseCreated` unset: the loop owns the per-attempt binding.

### Sibling defect found in the same seam

The provider passes `onResponseId: notifyResponseId` into
`fetchResponseEnvelope` (`provider.ts:246`), but the **foreground streaming
branch drops it**: `openai-http.ts:80` calls `readSseEnvelope(response)` with no
callback, where `runBackgroundStream` at `:257` correctly passes
`args.onResponseId`. Foreground streaming is the default (`provider.ts:150`) and
its SSE stream does carry `response.created`, so `stage:llm-response-created`
fires late — from the terminal envelope via the fallback at
`llm-stage-helpers.ts:552` — when it could fire mid-flight.

This is one argument at the exact call site this work is already editing. Fixed
here, as a separate commit. It narrows, but does not remove, the documented
"early persistence is a background-mode-only guarantee" caveat, so
`docs/api-reference.md:1960` and the JSDoc at `src/lib/llm/types.ts:53-59` are
reworded rather than left contradicted.

### Sweep

The sweep for defects sibling to the reported one was scoped to SSE-frame
handling and to the callback-threading seam it runs through — every call site
between `parseSseEvent` and `ctx.emit`, in both providers and both streaming
transports. That is the whole surface on which "a signal the transport has is
not reaching a consumer" can occur; the rest of the repository is engine and
grammar code with no streaming transport. The dropped `onResponseId` above is
the one defect it found.

## Acceptance criteria

Each is checkable by someone else without asking what was meant.

1. `readSseEnvelope`, given a stream carrying a frame whose data JSON is
   `{"type":"response.output_text.delta","delta":"abc"}` followed by a
   `response.completed` frame, invokes its delta callback exactly once with
   `"abc"` and still returns the terminal envelope. (Expressed through
   `readSseEnvelope` rather than `parseSseEvent`, which is module-private at
   `src/extensions/openai/openai-parsing.ts:44` and so cannot be asserted on
   directly.)
2. A provider built with default options (`stream` unset, so foreground SSE) and
   a mocked `fetch` returning a stream of two delta frames followed by a
   `response.completed` frame, called with `onTextDelta` set, invokes it exactly
   twice, in frame order, and both invocations happen before `respond()`
   resolves.
3. The same provider called with `onTextDelta` **unset** returns a
   `TLlmResponse` deep-equal to the one it returns today for the same fixture,
   and throws nothing.
4. `executeTurn` run with a mock provider that fires two deltas, and with an
   `onEvent` collector, yields exactly two `stage:llm-text-delta` events, each
   carrying the stage's own `stageId` and `attempt: 1`, ordered after
   `stage:llm-request` and before `stage:llm-call`.
5. A stage whose first attempt fails schema validation and whose second attempt
   succeeds, with both attempts streaming deltas, yields
   `stage:llm-text-delta` events carrying `attempt: 1` for the first attempt's
   deltas and `attempt: 2` for the second's.
6. A turn aborted mid-stream via `deps.signal` fires no `stage:llm-text-delta`
   event after the abort resolves, and the abort still surfaces as a `skipped`
   stage exactly as it does today.
7. `executePipeline` with an `onEvent` collector receives the same events for an
   LLM stage — the signal is not `executeTurn`-only.
8. Sibling fix: a provider in foreground streaming mode whose mocked stream
   emits `response.created` and then pauses invokes `onResponseCreated` before
   `respond()` resolves. This test fails against the tree as it stands today;
   confirm that failure before writing the fix.
9. `pnpm run check` passes — typecheck, prettier, eslint, the full vitest suite,
   and the build.

## Risks

- **Hot-path cost.** `parseSseEvent` now matches a third event type on every
  frame, and delta frames are by far the most numerous. The added work is one
  string comparison and, when a consumer opted in, one function call per frame.
  Mitigation: no accumulation, no allocation beyond the already-parsed string,
  and the terminal/created checks keep their current order so the added
  comparison is last.
- **A consumer double-renders on retry.** Criterion 5 is the guard, and the
  `docs/api-reference.md` entry must state the reset rule outright rather than
  leave it inferable from the field's presence.
- **Fixture shape drift.** The repo's existing delta fixture
  (`test/extensions/openai/provider.test.ts:1478-1483`) nests `delta` under
  `response`, which the current parser never reads, so the shape was never
  wrong in a way anything could catch. New tests must use the real wire shape,
  and that fixture is corrected in the same pass. See `## Notes`.
- **Reworded guarantee.** The sibling fix changes documented behaviour that two
  places describe as background-only. Both are updated in the same commit or
  the docs contradict the code.

## Notes

- **Assumption, not grounded.** The exact wire shape of the delta event —
  event type `response.output_text.delta` with the chunk in a **top-level**
  `delta` string field, siblings `item_id` / `output_index` /
  `content_index` / `sequence_number` — is taken from the event type string
  already present in this repo's fixtures
  (`test/extensions/openai/provider.test.ts:1480`, `:1675`, `:2475`) plus prior
  knowledge of the Responses API. It could not be confirmed against OpenAI's
  documentation from this environment: `developers.openai.com` is refused by the
  egress proxy. `AGENTS.md` names `https://developers.openai.com/api/llms.txt`
  as the route to confirm it, and the opt-in live suite
  (`RUN_LIVE_LLM_TESTS=1`, `test/extensions/openai/provider-live.test.ts`) can
  pin it against the real API. **Confirm the field placement before
  implementing** — if `delta` is nested, only step 1 of the threading changes.
- The intake and request were written against core 3.2.0 and re-verified at
  4.0.1. `package.json` now reads **5.0.0**; every citation in this spec was
  re-read against the working tree at spec time.
- **Baseline measured, not assumed.** `pnpm run check` is green on the tree as
  it stands (2514 passed, 14 skipped; typecheck, prettier, eslint and build
  clean), so criterion 9 has a real bar. Criterion 8 was run as a throwaway
  probe and **failed** as predicted — a foreground-streaming provider whose
  mocked stream carries `response.created` collected zero ids. The same probe
  resolved normally with top-level-`delta` frames in the stream, confirming the
  current parser ignores them without error.
- `sseResponse`, the SSE fixture helper
  (`test/extensions/openai/provider.test.ts:1093`), types its events as
  `{ type: string; response: unknown }`. A real delta frame carries `delta` at
  the top level, so the helper's signature widens as part of this work.
- Documentation entries expected to fire: `docs/api-reference.md`
  (`Public-API` — the event union table at `:1947`, the per-event prose after
  `:1960`, and the `executeStage` event list at `:1888`),
  `docs/release-notes/upcoming.md` (`Public-API`), and
  `docs/changelogs/upcoming.md` (`Any-Code-Change`). `AGENTS.md` (`Routing`)
  does **not** fire: no new easy-to-violate invariant and no new doc route.
- Adding a member to the `TPipelineEvent` union is source-compatible for
  producers but breaks any consumer with an exhaustive `switch` that has no
  `default`. That is a minor-version concern for the release cut, not a design
  one.
