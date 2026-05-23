import type { Command } from "commander"
import { buildParsingPrompt } from "../../lib/parsing/index.js"
import type { TParsedArgument } from "../../lib/parsing/index.js"
import {
    BasicsArgumentParser,
    BasicsParsingSchema,
} from "../../extensions/basics/index.js"
import { hydratePropositCore, persistEngine, persistCore } from "../engine.js"
import { PropositCore } from "../../lib/core/proposit-core.js"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../../lib/core/claim-citation-library.js"
import { cliLog } from "../logging.js"
import { errorExit, printJson, printLine, printWarning } from "../output.js"
import { resolveApiKey, createLlmProvider } from "../llm/index.js"

const DEFAULT_PARSE_MODEL = "gpt-5.4"

class CliArgumentParser extends BasicsArgumentParser {
    private readonly cliTitle?: string
    private readonly cliDescription: string

    constructor(title?: string, description?: string) {
        super()
        this.cliTitle = title
        this.cliDescription = description ?? ""
    }

    protected override mapArgument(
        parsed: TParsedArgument
    ): Record<string, unknown> {
        const basicsFields = super.mapArgument(parsed)
        return {
            ...basicsFields,
            ...(this.cliTitle !== undefined ? { title: this.cliTitle } : {}),
            description: this.cliDescription,
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
        .option(
            "--title <title>",
            "Argument title (overrides LLM-generated title)"
        )
        .option("--description <desc>", "Argument description", "")
        .option("--dry-run", "Print raw LLM JSON without persisting")
        .action(
            async (
                text: string | undefined,
                opts: {
                    llm: string
                    apiKey?: string
                    model?: string
                    title?: string
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
                const responseSchema = BasicsParsingSchema
                const systemPrompt = buildParsingPrompt(responseSchema)

                // 4. Call LLM via the abstract provider interface from
                //    src/lib/llm/. The CLI factory instantiates the
                //    concrete OpenAI Responses-API provider behind
                //    the abstract shape.
                const provider = createLlmProvider(opts.llm, { apiKey })

                let result: Record<string, unknown>
                try {
                    const response = await provider.respond({
                        model: opts.model ?? DEFAULT_PARSE_MODEL,
                        systemPrompt,
                        userMessage: inputText,
                        outputSchema: responseSchema,
                    })
                    result = response.output as Record<string, unknown>
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error)
                    await cliLog("parse:llm-error", { error: msg })
                    errorExit(msg)
                }

                // 5. Log raw LLM response
                await cliLog("parse:llm-response", {
                    provider: opts.llm,
                    model: opts.model ?? "(default)",
                    inputText,
                    response: result,
                })

                // 6. Dry-run: print raw response and exit
                if (opts.dryRun) {
                    printJson(result)
                    return
                }

                // 7. Validate
                const parser = new CliArgumentParser(
                    opts.title,
                    opts.description
                )
                let response
                try {
                    response = parser.validate(result)
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error)
                    await cliLog("parse:validation-error", { error: msg })
                    errorExit(`Validation failed: ${msg}`)
                }

                // 8. Check for null argument
                if (response.argument === null) {
                    const msg =
                        response.failureText ??
                        "The LLM could not parse the input as an argument."
                    await cliLog("parse:null-argument", {
                        failureText: response.failureText,
                    })
                    errorExit(msg)
                }

                // 9. Build engine
                let built
                try {
                    built = parser.build(response, { strict: false })
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error)
                    await cliLog("parse:build-error", { error: msg })
                    errorExit(`Build failed: ${msg}`)
                }

                if (built.warnings.length > 0) {
                    for (const w of built.warnings) {
                        printWarning(`[${w.code}] ${w.message}`)
                    }
                }

                // 10. Merge libraries with existing global state
                const existing = await hydratePropositCore()
                const mergedClaims = ClaimLibrary.fromSnapshot({
                    claims: [
                        ...existing.claims.snapshot().claims,
                        ...built.claimLibrary.snapshot().claims,
                    ],
                })
                const mergedCitations = ClaimCitationLibrary.fromSnapshot(
                    {
                        connections: [
                            ...existing.citations.snapshot().connections,
                            ...built.claimCitationLibrary.snapshot()
                                .connections,
                        ],
                    },
                    mergedClaims
                )

                const merged = new PropositCore({
                    claimLibrary: mergedClaims,
                    claimCitationLibrary: mergedCitations,
                    forkLibrary: existing.forks,
                })

                // 11. Persist and output
                await persistEngine(built.engine)
                await persistCore(merged)
                printLine(built.engine.getArgument().id)
            }
        )
}
