# `arguments parse` Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-powered `arguments parse` CLI command that extracts a structured propositional argument from natural-language text and persists it.

**Architecture:** An LLM provider abstraction (`src/cli/llm/`) exposes a generic `TLlmProvider<TResponse>` interface with a factory function. The OpenAI implementation uses native `fetch`. A new `arguments parse` subcommand wires the provider to the existing `ArgumentParser` and `persistEngine` pipeline.

**Tech Stack:** TypeScript, Commander.js, native `fetch`, TypeBox (existing), parsing module (existing)

**Spec:** `docs/superpowers/specs/2026-03-16-arguments-parse-command-design.md`

---

## Chunk 1: LLM Provider Abstraction

### Task 1: LLM Types

**Files:**

- Create: `src/cli/llm/types.ts`

- [ ] **Step 1: Create the types file**

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

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS (no errors related to `src/cli/llm/types.ts`)

- [ ] **Step 3: Commit**

```bash
git add src/cli/llm/types.ts
git commit -m "feat(cli): add LLM provider types"
```

### Task 2: OpenAI Provider

**Files:**

- Create: `src/cli/llm/openai.ts`
- Read: `src/lib/parsing/schemata.ts` (for `getParsingResponseSchema`)

- [ ] **Step 1: Create the OpenAI provider**

```typescript
import { getParsingResponseSchema } from "../../lib/parsing/index.js"
import type { TLlmProvider, TLlmProviderOptions } from "./types.js"

const DEFAULT_MODEL = "gpt-5.4"

export const OPENAI_API_KEY_ENV = "OPENAI_API_KEY"

export function createOpenAiProvider(
    options: TLlmProviderOptions
): TLlmProvider {
    const model = options.model ?? DEFAULT_MODEL

    return {
        async complete(request) {
            const schema = getParsingResponseSchema(request.responseSchema)

            const response = await fetch(
                "https://api.openai.com/v1/chat/completions",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${options.apiKey}`,
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: "system", content: request.systemPrompt },
                            { role: "user", content: request.userMessage },
                        ],
                        response_format: {
                            type: "json_schema",
                            json_schema: {
                                name: "parsed_argument",
                                strict: false,
                                schema,
                            },
                        },
                    }),
                }
            )

            if (!response.ok) {
                const text = await response.text()
                throw new Error(
                    `OpenAI API error (${response.status}): ${text}`
                )
            }

            const data = (await response.json()) as {
                choices?: { message?: { content?: string } }[]
            }
            const content = data.choices?.[0]?.message?.content
            if (!content) {
                throw new Error("No content in OpenAI response.")
            }

            return JSON.parse(content) as Record<string, unknown>
        },
    }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/llm/openai.ts
git commit -m "feat(cli): add OpenAI LLM provider"
```

### Task 3: Provider Factory and Barrel

**Files:**

- Create: `src/cli/llm/index.ts`
- Read: `src/cli/llm/openai.ts` (for `OPENAI_API_KEY_ENV`)

- [ ] **Step 1: Create the factory and barrel**

```typescript
export type {
    TLlmCompletionRequest,
    TLlmProvider,
    TLlmProviderOptions,
} from "./types.js"
export { createOpenAiProvider, OPENAI_API_KEY_ENV } from "./openai.js"

import { createOpenAiProvider, OPENAI_API_KEY_ENV } from "./openai.js"
import type { TLlmProvider, TLlmProviderOptions } from "./types.js"

const PROVIDER_ENV_VARS: Record<string, string> = {
    openai: OPENAI_API_KEY_ENV,
}

export function resolveApiKey(providerName: string, explicit?: string): string {
    if (explicit) return explicit
    const envVar = PROVIDER_ENV_VARS[providerName]
    if (envVar) {
        const value = process.env[envVar]
        if (value) return value
    }
    const envHint = envVar ? ` or set ${envVar}` : ""
    throw new Error(
        `No API key provided for "${providerName}". Use --api-key${envHint}.`
    )
}

export function createLlmProvider(
    name: string,
    options: TLlmProviderOptions
): TLlmProvider {
    switch (name) {
        case "openai":
            return createOpenAiProvider(options)
        default:
            throw new Error(
                `Unknown LLM provider "${name}". Supported: openai.`
            )
    }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/cli/llm/index.ts
git commit -m "feat(cli): add LLM provider factory with API key resolution"
```

## Chunk 2: Parse Command

### Task 4: Parse Command Implementation

**Files:**

- Create: `src/cli/commands/parse.ts`
- Modify: `src/cli/commands/arguments.ts:1,30-31` (add import + registration call)
- Read: `src/lib/parsing/argument-parser.ts` (for `ArgumentParser` subclass pattern)
- Read: `src/cli/engine.ts` (for `persistEngine`)
- Read: `src/cli/output.ts` (for `errorExit`, `printJson`, `printLine`)

- [ ] **Step 1: Create the parse command file**

```typescript
import type { Command } from "commander"
import {
    ArgumentParser,
    ParsedArgumentResponseSchema,
    buildParsingPrompt,
} from "../../lib/parsing/index.js"
import type { TParsedArgument } from "../../lib/parsing/index.js"
import { persistEngine } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"
import { resolveApiKey, createLlmProvider } from "../llm/index.js"

class CliArgumentParser extends ArgumentParser {
    private readonly title: string
    private readonly description: string

    constructor(title: string, description: string) {
        super()
        this.title = title
        this.description = description
    }

    protected override mapArgument(
        _parsed: TParsedArgument
    ): Record<string, unknown> {
        return {
            title: this.title,
            description: this.description,
            createdAt: new Date(),
            published: false,
        }
    }
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer)
    }
    return Buffer.concat(chunks).toString("utf-8")
}

export function registerParseCommand(args: Command): void {
    args.command("parse [text]")
        .description(
            "Parse natural-language text into a structured argument using an LLM"
        )
        .option("--llm <provider>", "LLM provider name", "openai")
        .option("--api-key <key>", "API key (overrides env var)")
        .option("--model <model>", "Model override")
        .option("--title <title>", "Argument title", "Parsed argument")
        .option("--description <desc>", "Argument description", "")
        .option("--dry-run", "Print raw LLM JSON without persisting")
        .action(
            async (
                text: string | undefined,
                opts: {
                    llm: string
                    apiKey?: string
                    model?: string
                    title: string
                    description: string
                    dryRun?: boolean
                }
            ) => {
                // 1. Resolve API key
                let apiKey: string
                try {
                    apiKey = resolveApiKey(opts.llm, opts.apiKey)
                } catch (error) {
                    errorExit(
                        error instanceof Error ? error.message : String(error)
                    )
                }

                // 2. Resolve input text
                let inputText: string
                if (text) {
                    inputText = text
                } else if (!process.stdin.isTTY) {
                    inputText = await readStdin()
                } else {
                    errorExit(
                        "No input text provided. Pass as argument or pipe to stdin."
                    )
                }

                if (!inputText.trim()) {
                    errorExit("Input text is empty.")
                }

                // 3. Build prompt and schema
                const responseSchema = ParsedArgumentResponseSchema
                const systemPrompt = buildParsingPrompt(responseSchema)

                // 4. Call LLM
                const provider = createLlmProvider(opts.llm, {
                    apiKey,
                    model: opts.model,
                })

                let result: Record<string, unknown>
                try {
                    result = await provider.complete({
                        systemPrompt,
                        userMessage: inputText,
                        responseSchema,
                    })
                } catch (error) {
                    errorExit(
                        error instanceof Error ? error.message : String(error)
                    )
                }

                // 5. Dry-run: print raw response and exit
                if (opts.dryRun) {
                    printJson(result)
                    return
                }

                // 6. Validate
                const parser = new CliArgumentParser(
                    opts.title,
                    opts.description
                )
                let response
                try {
                    response = parser.validate(result)
                } catch (error) {
                    errorExit(
                        `Validation failed: ${error instanceof Error ? error.message : String(error)}`
                    )
                }

                // 7. Check for null argument
                if (response.argument === null) {
                    errorExit(
                        response.failureText ??
                            "The LLM could not parse the input as an argument."
                    )
                }

                // 8. Build engine
                let engine
                try {
                    const built = parser.build(response)
                    engine = built.engine
                } catch (error) {
                    errorExit(
                        `Build failed: ${error instanceof Error ? error.message : String(error)}`
                    )
                }

                // 9. Persist and output
                await persistEngine(engine)
                printLine(engine.getArgument().id)
            }
        )
}
```

- [ ] **Step 2: Register the parse command in arguments.ts**

In `src/cli/commands/arguments.ts`, add at line 1 (with existing imports):

```typescript
import { registerParseCommand } from "./parse.js"
```

At the end of the `registerArgumentCommands` function body (before the closing `}`), add:

```typescript
registerParseCommand(args)
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 4: Verify lint passes**

Run: `pnpm run lint`
Expected: PASS (run `pnpm eslint . --fix` and `pnpm run prettify` first if needed)

- [ ] **Step 5: Verify existing tests still pass**

Run: `pnpm run test`
Expected: All existing tests PASS (no regressions)

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/parse.ts src/cli/commands/arguments.ts
git commit -m "feat(cli): add arguments parse command with LLM integration"
```

## Chunk 3: Tests

### Task 5: Unit Tests for LLM Abstraction

**Files:**

- Modify: `test/core.test.ts` (add new describe blocks at the bottom)
- Read: `src/cli/llm/index.ts` (for `resolveApiKey`, `createLlmProvider`)

Tests for the LLM layer focus on the factory and API key resolution — not on the OpenAI HTTP call (which would require mocking `fetch`).

- [ ] **Step 1: Write tests for resolveApiKey and createLlmProvider**

Add at the bottom of `test/core.test.ts`:

```typescript
describe("LLM provider abstraction", () => {
    describe("resolveApiKey", () => {
        it("returns explicit key when provided", () => {
            const key = resolveApiKey("openai", "sk-explicit")
            expect(key).toBe("sk-explicit")
        })

        it("falls back to OPENAI_API_KEY env var", () => {
            const original = process.env.OPENAI_API_KEY
            try {
                process.env.OPENAI_API_KEY = "sk-from-env"
                const key = resolveApiKey("openai")
                expect(key).toBe("sk-from-env")
            } finally {
                if (original === undefined) {
                    delete process.env.OPENAI_API_KEY
                } else {
                    process.env.OPENAI_API_KEY = original
                }
            }
        })

        it("throws when no key is available", () => {
            const original = process.env.OPENAI_API_KEY
            try {
                delete process.env.OPENAI_API_KEY
                expect(() => resolveApiKey("openai")).toThrow(/OPENAI_API_KEY/)
            } finally {
                if (original !== undefined) {
                    process.env.OPENAI_API_KEY = original
                }
            }
        })

        it("throws for unknown provider with no explicit key", () => {
            expect(() => resolveApiKey("unknown")).toThrow(/unknown/)
        })

        it("returns explicit key even for unknown provider", () => {
            const key = resolveApiKey("unknown", "sk-explicit")
            expect(key).toBe("sk-explicit")
        })
    })

    describe("createLlmProvider", () => {
        it("creates an openai provider", () => {
            const provider = createLlmProvider("openai", {
                apiKey: "sk-test",
            })
            expect(provider).toBeDefined()
            expect(typeof provider.complete).toBe("function")
        })

        it("throws on unknown provider name", () => {
            expect(() =>
                createLlmProvider("unknown", { apiKey: "sk-test" })
            ).toThrow(/unknown/i)
        })
    })
})
```

- [ ] **Step 2: Add the import at the top of the test file**

Add to the imports at the top of `test/core.test.ts`:

```typescript
import { resolveApiKey, createLlmProvider } from "../src/cli/llm/index"
```

- [ ] **Step 3: Run the new tests**

Run: `pnpm run test`
Expected: All tests PASS including the new `LLM provider abstraction` suite

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add LLM provider factory and API key resolution tests"
```

### Task 6: Unit Tests for CliArgumentParser

**Files:**

- Modify: `test/core.test.ts` (add new describe block at the bottom)
- Read: `src/cli/commands/parse.ts` (for `CliArgumentParser` — note: it's not exported, so test via a local equivalent or export it)

The `CliArgumentParser` is defined in `parse.ts` but not exported. Rather than exporting a CLI-internal class, test the metadata injection behavior by recreating the pattern inline — this verifies the `mapArgument` override works with `ArgumentParser`.

- [ ] **Step 1: Write tests for the mapArgument metadata injection**

Add at the bottom of `test/core.test.ts`:

```typescript
describe("CliArgumentParser metadata injection", () => {
    class TestCliParser extends ArgumentParser {
        private readonly title: string
        private readonly description: string

        constructor(title: string, description: string) {
            super()
            this.title = title
            this.description = description
        }

        protected override mapArgument(): Record<string, unknown> {
            return {
                title: this.title,
                description: this.description,
                createdAt: new Date("2026-01-01T00:00:00Z"),
                published: false,
            }
        }
    }

    function validResponse(): TParsedArgumentResponse {
        return {
            argument: {
                claims: [
                    {
                        miniId: "C1",
                        role: "premise" as const,
                        sourceMiniIds: [],
                    },
                ],
                variables: [{ miniId: "V1", symbol: "A", claimMiniId: "C1" }],
                sources: [],
                premises: [{ miniId: "P1", formula: "A" }],
                conclusionPremiseMiniId: "P1",
            },
            uncategorizedText: null,
            selectionRationale: null,
            failureText: null,
        }
    }

    it("injects title and description into the built argument", () => {
        const parser = new TestCliParser("My Title", "My Desc")
        const { engine } = parser.build(validResponse())
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("My Title")
        expect(arg.description).toBe("My Desc")
        expect(arg.published).toBe(false)
        expect(arg.createdAt).toEqual(new Date("2026-01-01T00:00:00Z"))
    })

    it("uses default title when not specified", () => {
        const parser = new TestCliParser("Parsed argument", "")
        const { engine } = parser.build(validResponse())
        const arg = engine.getArgument() as Record<string, unknown>
        expect(arg.title).toBe("Parsed argument")
        expect(arg.description).toBe("")
    })
})
```

- [ ] **Step 2: Verify the import for TParsedArgumentResponse is already present**

Check that `test/core.test.ts` already imports `TParsedArgumentResponse` and `ArgumentParser` from the parsing module. If not, add:

```typescript
import { ArgumentParser } from "../src/lib/parsing/argument-parser"
import type { TParsedArgumentResponse } from "../src/lib/parsing/schemata"
```

- [ ] **Step 3: Run the new tests**

Run: `pnpm run test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add test/core.test.ts
git commit -m "test: add CliArgumentParser metadata injection tests"
```

## Chunk 4: Final Checks

### Task 7: Full Check Suite

- [ ] **Step 1: Run the full check suite**

Run: `pnpm run check`
Expected: typecheck, lint, test, and build all PASS

- [ ] **Step 2: Verify the built CLI registers the parse command**

Run: `pnpm cli -- arguments parse --help`
Expected: Shows the parse command help with `--llm`, `--api-key`, `--model`, `--title`, `--description`, `--dry-run` options

- [ ] **Step 3: Commit any formatting fixes if needed**

If `pnpm run check` required formatting fixes:

```bash
git add -u
git commit -m "style: format new files"
```
