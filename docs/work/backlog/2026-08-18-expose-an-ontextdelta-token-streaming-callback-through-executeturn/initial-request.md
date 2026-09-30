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
