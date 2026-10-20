# Keep the schema-retry note on a retried conversation turn

Found by the second round of the combined 6.0.0 review. The defect is older than 6.0.0: the shared-variable code it replaced behaved the same way.

## Problem

`executeTurn` (`src/lib/conversation/turn.ts`) wraps the provider and sets `req.userMessage` to the caller's message on every `respond` call. When a stage's output fails its schema, `llmStage` retries with a corrective note appended to the prompt (`applyRetrySuffix`, `src/lib/pipelines/llm-stage-helpers.ts`). The wrapper then overwrites that prompt.

Two consequences:

- Inside a conversation turn, the model is sent the identical prompt again, so the retry cannot correct anything.
- The `stage:llm-request` and `stage:llm-call` events report the stage's own prompt, not the message actually sent.

## Proposed direction

Have the turn supply its user message to the stage before the retry suffix is applied, for example through the stage context or a request hook that runs before `applyRetrySuffix`, instead of replacing it after. Then the events and the request agree, and a retry keeps its note.

## Tests

- A turn whose first output fails the schema sends, on the retry, the caller's message with the retry note added.
- The `stage:llm-request` event of each attempt shows the message actually sent.
