# `arguments parse` CLI Command

Adds an LLM-powered `arguments parse` command that extracts a structured propositional argument from natural-language text, validates it, and persists it to disk.

## LLM Provider Abstraction

New directory: `src/cli/llm/`

### Types (`types.ts`)

```typescript
import type { TSchema } from "typebox"

export type TLlmCompletionRequest = {
    systemPrompt: string
    userMessage: string
    responseSchema: TSchema
}

export type TLlmProviderOptions = {
    apiKey: string
    model?: string
}

export type TLlmProvider<TResponse = Record<string, unknown>> = {
    complete(request: TLlmCompletionRequest): Promise<TResponse>
}
```

- `TLlmProvider` is generic over the response type, defaulting to `Record<string, unknown>`. The generic is for consumer-side type narrowing — providers internally do `JSON.parse()` and the result is cast. The factory returns `TLlmProvider` (default generic), so callers that need a narrower type can assert after validation.
- `TLlmCompletionRequest.responseSchema` is a TypeBox `TSchema`. Each provider implementation serializes it internally via `getParsingResponseSchema()` for its API's structured output format.

### OpenAI Provider (`openai.ts`)

- `createOpenAiProvider(options: TLlmProviderOptions): TLlmProvider`
- Uses native `fetch` — no SDK dependency.
- Calls `POST https://api.openai.com/v1/chat/completions` with:
    - `messages`: system prompt + user message
    - `response_format: { type: "json_schema", json_schema: { name: "parsed_argument", strict: false, schema } }`
    - Schema serialized via `getParsingResponseSchema(request.responseSchema)` inside the provider.
- Default model: `gpt-5.4`.
- Default env var for API key fallback: `OPENAI_API_KEY`.
- Parses `choices[0].message.content` as JSON and returns the result.
- Throws on non-OK HTTP status or missing content.

### Factory (`index.ts`)

- `createLlmProvider(name: string, options: TLlmProviderOptions): TLlmProvider`
- Switch on `name`; throws on unknown provider.
- Adding a new provider: write one file, add one case.
- Each provider declares its default API key env var name. The factory exposes `resolveApiKey(providerName: string, explicit?: string): string` which checks the explicit key first, then the provider's env var, then throws.

## Parse Command

New file: `src/cli/commands/parse.ts`

### Registration

`registerParseCommand(args: Command)` is called from `registerArgumentCommands` in `arguments.ts`. The command is `arguments parse [text]`.

### Options

| Flag                   | Required | Default                   | Description                                                           |
| ---------------------- | -------- | ------------------------- | --------------------------------------------------------------------- |
| `--llm <provider>`     | no       | `openai`                  | LLM provider name                                                     |
| `--api-key <key>`      | no       | provider-specific env var | API key; flag takes precedence over env var                           |
| `--model <model>`      | no       | provider default          | Model override                                                        |
| `--title <title>`      | no       | `"Parsed argument"`       | Argument title for persistence                                        |
| `--description <desc>` | no       | `""`                      | Argument description for persistence                                  |
| `--dry-run`            | no       | `false`                   | Print raw LLM JSON via `printJson()`, skip validation and persistence |

### Input Resolution

1. If `[text]` positional argument is provided, use it.
2. Else if stdin is piped (not a TTY), read all of stdin.
3. Else error.

### Flow

1. Resolve API key: `resolveApiKey(opts.llm, opts.apiKey)` — checks flag, then provider env var, then errors.
2. Read input text (positional or stdin).
3. Build response schema: `ParsedArgumentResponseSchema` (core, no extensions for the CLI).
4. Build system prompt: `buildParsingPrompt(responseSchema)`.
5. Create provider: `createLlmProvider(opts.llm, { apiKey, model: opts.model })`.
6. Call `provider.complete({ systemPrompt, userMessage: inputText, responseSchema })`.
7. If `--dry-run`: `printJson(result)`, exit.
8. Validate: `new ArgumentParser().validate(result)`.
9. Check `response.argument === null`: if so, print `response.failureText` via `errorExit()`.
10. Build: `parser.build(response)` → `{ engine }`. The `ArgumentParser` subclass (or `mapArgument` override) injects `{ title, description, createdAt: new Date(), published: false }` from CLI flags.
11. Persist: `persistEngine(engine)`.
12. Print the argument ID to stdout.

### Argument Metadata

`persistEngine()` expects `title`, `description`, `createdAt`, and `published` on the argument object. These are not part of the LLM response — they are CLI concerns.

The parse command subclasses `ArgumentParser` and overrides `mapArgument()` to inject:

```typescript
{ title: opts.title, description: opts.description, createdAt: new Date(), published: false }
```

This follows the same pattern as `importArgumentFromYaml`, which injects these fields during construction.

### Error Handling

- Missing API key → `errorExit` with message naming the expected env var for the provider.
- Missing input text → `errorExit("No input text provided. Pass as argument or pipe to stdin.")`.
- LLM API error → `errorExit` with provider error message.
- Null argument → `errorExit` with `response.failureText` or a generic message.
- Validation failure → `errorExit` with TypeBox validation error.
- Build failure (bad formulas, undeclared variables, etc.) → `errorExit` with `ArgumentParser` error.

## Files

### Created

- `src/cli/llm/types.ts`
- `src/cli/llm/openai.ts`
- `src/cli/llm/index.ts`
- `src/cli/commands/parse.ts`

### Modified

- `src/cli/commands/arguments.ts` — import and call `registerParseCommand(args)`

### Not Changed

- No library (`src/lib/`) changes.
- No new dependencies in `package.json`.
- No schema changes.
