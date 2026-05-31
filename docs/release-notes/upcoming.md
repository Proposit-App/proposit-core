# Upcoming release notes

## Provider streaming and OpenAI background mode

**Local Ollama runs are now faster and more reliable.** The Ollama provider now streams responses by default (`stream: true`). Previously the provider waited for the full response in one HTTP call, which would time out on long local thinking-model generations. Streaming lets each chunk keep the connection alive, so a multi-minute structured-extraction stage no longer aborts mid-flight. Set `stream: false` on `TOllamaProviderConfig` to restore the old non-streaming behavior.

**OpenAI responses also stream by default.** The OpenAI Responses-API provider now streams over SSE by default (`stream: true`), accumulating the result inside the provider. This improves connection-drop resilience with no change to the returned data or any data-retention implications. Set `stream: false` on `TCreateOpenAiResponsesProviderOptions` to restore the blocking request path.

**New opt-in OpenAI background mode for long reasoning calls.** Pass `backgroundMode: true` to `createOpenAiResponsesProvider` to use OpenAI's background-response feature: the request is submitted, then polled until completion. This avoids keeping a long-lived connection open for calls with extended reasoning. Background mode requires OpenAI to store the response server-side (`store: true`), which is **not compatible with Zero Data Retention**; only enable it where that posture is acceptable. The current V1 implementation supports the no-tools path only — passing `backgroundMode` with a `tools` array throws immediately. Use `backgroundPollIntervalMs` (default 2000 ms) to tune the poll frequency.
