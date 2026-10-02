# Upcoming

## Added

### Show a model's reply as it is written

Pipeline stages now report the model's output text while it streams. Each
chunk arrives as a `stage:llm-text-delta` event on the `onEvent` handler you
already pass to `executePipeline`, `executeStage` or `executeTurn`:

```ts
let text = ""
let attempt = 0
await executeTurn(stage, input, {
    llm,
    onEvent: (event) => {
        if (event.kind !== "stage:llm-text-delta") return
        if (event.attempt !== attempt) {
            // A retry streams again from the beginning.
            attempt = event.attempt
            text = ""
        }
        text += event.delta
        render(text)
    },
})
```

There is nothing to switch on: the OpenAI provider already streams by default.
Things to know:

- **Start over on a retry.** When a stage retries, the new attempt streams
  its text again from the beginning, with a higher `attempt`.
- **It is the raw text.** For a stage with an output schema the chunks are
  pieces of JSON, not prose; pulling readable text out of a partial JSON
  document is up to you.
- **Tool rounds.** A stage with function tools makes one request per round,
  and any text the model writes before calling a tool streams too, ahead of
  the final answer and under the same `attempt`.
- **Where it does not fire:** the poll-only background mode, `stream: false`,
  the chat-completions provider, and `launchStage`, none of which hold a live
  stream.

Providers get the same signal directly through the new optional
`TLlmRequest.onTextDelta` callback.

## Fixed

### The response id arrives mid-flight on the default stream

`onResponseCreated`, and so the `stage:llm-response-created` event, now fires
as soon as the default foreground stream reports the id, instead of only when
the call completes, for a call that makes a single request. Background-stream
mode already did this. A call with function tools makes a request per round
and still reports its id at completion, so the id event and
`stage:llm-call` always carry the same id. Only a
background response keeps generating after you disconnect, so recovering an
interrupted call is still a background-stream guarantee.

## Breaking

- **A new pipeline event kind.** If you `switch` over `TPipelineEvent`'s
  `kind` with no `default`, add a case for `stage:llm-text-delta` (or a
  `default`).
