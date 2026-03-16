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
