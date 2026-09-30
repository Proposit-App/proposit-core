# Pipelines and LLM providers

The library includes a small framework for running a set of processing steps ("stages") that depend on each other. Some stages are plain code; others call a large language model (LLM). It also includes ready-made pipelines that turn natural-language text into an argument.

The core never depends on a particular LLM vendor. Stages talk to the one-method `TLlmProvider` interface, and the concrete providers live at optional subpaths. Both providers call their HTTP APIs with plain `fetch`, so no vendor SDK needs to be installed.

## The provider interface

```typescript
type TLlmProvider = {
    respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>>
}
// TLlmRequest: { model, systemPrompt, userMessage, outputSchema, reasoningEffort?, tools?, maxOutputTokens?, signal?, ... }
// TLlmResponse: { output: T, tokenUsage: { input, output, reasoning? }, rawResponseId? }
```

`outputSchema` is a TypeBox schema. TypeBox is the schema library the package itself uses: add `typebox` to your own dependencies and import `Type` from it. The provider must return output matching it. Any object with this shape works, including a test stub.

Providers shipped:

- `@proposit/proposit-core/extensions/openai` — `createOpenAiResponsesProvider({ apiKey, baseUrl?, fetch?, stream?, backgroundMode?, … })` uses the OpenAI Responses API. The same subpath has `retrieveResponse`, `reconnectStream`, `cancelResponse` and `submitBackgroundResponse` for long-running requests.
- `@proposit/proposit-core/extensions/chat-completions` — `createChatCompletionsProvider({ baseUrl?, model?, apiKey?, requestTimeoutMs?, fetch? })` works with any OpenAI-compatible `/chat/completions` endpoint, such as a local model server.

Errors carry a `retryReason` tag (`"transient"`, `"rate_limit"` or `"quota_exhausted"`). The framework uses the tag to decide whether to retry.

## Writing a pipeline

```typescript
import Type from "typebox"
import {
    deterministicStage,
    executePipeline,
    llmStage,
} from "@proposit/proposit-core"
import type { TLlmProvider, TPipeline } from "@proposit/proposit-core"

// Any object with a `respond` method is a provider; this one is a stub.
const stubProvider: TLlmProvider = {
    // `respond` is generic in its output type, hence the cast.
    respond: () =>
        Promise.resolve({
            output: { topic: "weather" } as never,
            tokenUsage: { input: 10, output: 5 },
        }),
}

const pipeline: TPipeline<{ text: string }, string> = {
    id: "example",
    version: "1",
    inputSchema: Type.Object({ text: Type.String() }),
    outputSchema: Type.String(),
    stages: [
        deterministicStage<number>({
            id: "length",
            dependsOn: [],
            outputSchema: Type.Number(),
            fn: (ctx) => (ctx.input as { text: string }).text.length,
        }),
        llmStage<{ topic: string }>({
            id: "topic",
            dependsOn: [],
            outputSchema: Type.Object({ topic: Type.String() }),
            model: "gpt-5.4-mini",
            buildPrompt: (ctx) => ({
                system: "Name the topic of the text in one word.",
                user: (ctx.input as { text: string }).text,
            }),
        }),
    ],
    finalize: {
        dependsOn: ["length", "topic"],
        run: (ctx) =>
            `${ctx.get<{ topic: string }>("topic")?.topic} (${ctx.get<number>("length")} chars)`,
    },
}

const result = await executePipeline(
    pipeline,
    { text: "It rained." },
    { llm: stubProvider }
)
console.log(result.output) // "weather (10 chars)"
console.log(result.failures) // []
```

How pipelines behave:

- **Dependencies.** `dependsOn` lists stage ids. Wrap an id in `optional(id)` when the stage should still run if that dependency failed or was skipped. A stage whose required dependency did not complete is skipped, not failed.
- **Failures.** Pipeline configuration errors, such as a dependency cycle, an unknown stage id or input that does not match `inputSchema`, throw `PipelineConfigurationError`. Every other problem comes back in `result.failures`, and `result.stageOutcomes` records each stage as `"completed"`, `"skipped"` or `"failed"`.
- **Retries.** `llmStage` checks the LLM's output against `outputSchema` and retries under a retry policy (`DEFAULT_RETRY_POLICY`, adjustable per stage with `retry`). `checkOutput` adds your own content check, retried the same way.
- **Running options.** `executePipeline`'s third argument also takes `generateId`, `signal` (an `AbortSignal`; aborted stages are reported as skipped), `onEvent` (progress events) and `concurrencyLimit` (default 4).
- **One stage at a time.** To run each stage in a separate process, with outputs stored in between, use `executeStage`, `executeFinalize`, `launchStage` / `completeStage` and the `@proposit/proposit-core/pipelines/scheduling` helpers.

## Text to argument

Two ready-made pipelines produce the same output type (`TParsedArgumentResponse`) from `{ text }`:

- `createScholarPipeline(extension, options?)` is thorough, with about eight LLM calls.
- `createScribePipeline(extension, options?)` is fast, with about two.

Both are in `@proposit/proposit-core/pipelines/ingestion`. The `extension` argument is a bundle of schemas; `basicsExtension` from `@proposit/proposit-core/pipelines/base` is the default. `options.llm.defaults` (for example `{ model }`) overrides the model settings of every LLM stage.

`ArgumentParser` turns the pipeline's output into an engine and libraries. `BasicsArgumentParser` from `@proposit/proposit-core/extensions/basics` matches `basicsExtension`.

```typescript
import { executePipeline } from "@proposit/proposit-core"
import { createOpenAiResponsesProvider } from "@proposit/proposit-core/extensions/openai"
import { createScribePipeline } from "@proposit/proposit-core/pipelines/ingestion"
import { basicsExtension } from "@proposit/proposit-core/pipelines/base"
import { BasicsArgumentParser } from "@proposit/proposit-core/extensions/basics"

const provider = createOpenAiResponsesProvider({ apiKey })
const pipeline = createScribePipeline(basicsExtension)
const { output, failures } = await executePipeline(
    pipeline,
    { text },
    { llm: provider }
)
if (output === null) throw new Error(failures.map((f) => f.message).join("; "))

const parser = new BasicsArgumentParser()
const validated = parser.validate(output)
const { engine, claimLibrary, claimCitationLibrary, warnings } =
    parser.build(validated)
```

- `build(response, { strict?, generateId? })` returns `{ engine, claimLibrary, claimCitationLibrary, claimAxiomLibrary, warnings }`. These are standalone instances, not registered in any `PropositCore`.
- With `strict: false`, problems become `warnings` instead of errors.
- A subclass of `ArgumentParser` can add fields to the entities it creates by overriding the `mapArgument`, `mapClaim`, `mapVariable`, `mapPremise`, `mapClaimCitation` and `mapClaimAxiom` methods.

## Conversations

`@proposit/proposit-core/conversation` (`executeTurn`, `createConversation`) runs multi-turn exchanges with a provider. `@proposit/proposit-core/builder` provides ready-made turns that review, simulate and distill an argument (`createReviewTurn`, `createSimulateTurn`, `createDistillTurn`).
