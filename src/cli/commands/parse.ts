import type { Command } from "commander"
import type { TParsedArgument } from "../../lib/parsing/index.js"
import { BasicsArgumentParser } from "../../extensions/basics/index.js"
import { hydratePropositCore, persistEngine, persistCore } from "../engine.js"
import { PropositCore } from "../../lib/core/proposit-core.js"
import { ClaimLibrary } from "../../lib/core/claim-library.js"
import { ClaimCitationLibrary } from "../../lib/core/claim-citation-library.js"
import { cliLog } from "../logging.js"
import { errorExit, printJson, printLine, printWarning } from "../output.js"
import { resolveApiKey, createLlmProvider } from "../llm/index.js"
import { executePipeline } from "../../lib/index.js"
import type { TPipelineResult } from "../../lib/index.js"
import {
    createScholarPipeline,
    createScribePipeline,
} from "../../extensions/pipelines/ingestion/index.js"
import { basicsExtension } from "../../extensions/pipelines/base/index.js"
import type { TParsedArgumentResponse } from "../../lib/parsing/index.js"

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
            "--pipeline <name>",
            "Ingestion pipeline (scholar = thorough, scribe = fast)",
            "scholar"
        )
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
                    pipeline: string
                    title?: string
                    description: string
                    dryRun?: boolean
                }
            ) => {
                // 1. Resolve the ingestion pipeline. `scholar` (thorough,
                //    multi-stage) is the default; `scribe` (fast, two
                //    cheap LLM calls) is opt-in. Both emit the same
                //    parsed-argument response shape.
                if (opts.pipeline !== "scholar" && opts.pipeline !== "scribe") {
                    errorExit(
                        `Unknown pipeline "${opts.pipeline}". Supported: scholar, scribe.`
                    )
                }

                // 2. Resolve API key
                let apiKey: string
                try {
                    apiKey = resolveApiKey(opts.llm, opts.apiKey)
                } catch (error) {
                    errorExit(
                        error instanceof Error ? error.message : String(error)
                    )
                }

                // 3. Resolve input text
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

                // 4. Build the selected ingestion pipeline and execute.
                //    The pipeline owns the LLM calls + structured-
                //    output validation; the CLI is left with engine
                //    construction + persistence. `--model`, when given,
                //    overrides every stage's model via the pipeline-level
                //    `llm.defaults`.
                const provider = createLlmProvider(opts.llm, { apiKey })
                const buildPipeline =
                    opts.pipeline === "scribe"
                        ? createScribePipeline
                        : createScholarPipeline
                const pipeline = buildPipeline(
                    basicsExtension,
                    opts.model
                        ? { llm: { defaults: { model: opts.model } } }
                        : undefined
                )

                let pipelineResult: TPipelineResult<TParsedArgumentResponse>
                try {
                    pipelineResult = await executePipeline(
                        pipeline,
                        { text: inputText },
                        { llm: provider }
                    )
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error)
                    await cliLog("parse:pipeline-error", { error: msg })
                    errorExit(msg)
                }

                // A degraded import: the pipeline's finalize returned no
                // argument. Both scholar and scribe reach this when
                // finalize returns null — empty canonicalization (no
                // claims extracted) or an irresolvable conclusion — with
                // the reason carried on `failures`. Surface those and
                // exit non-zero rather than printing a null argument.
                if (pipelineResult.output === null) {
                    const failureSummary = pipelineResult.failures
                        .map((f) => `[${f.code}] ${f.message}`)
                        .join("; ")
                    await cliLog("parse:pipeline-null-output", {
                        provider: opts.llm,
                        model: opts.model ?? "(default)",
                        failures: pipelineResult.failures,
                    })
                    errorExit(
                        failureSummary ||
                            "Ingestion pipeline returned no output."
                    )
                }

                const response: TParsedArgumentResponse &
                    Record<string, unknown> = pipelineResult.output

                // 5. Log raw LLM response
                await cliLog("parse:llm-response", {
                    provider: opts.llm,
                    model: opts.model ?? "(default)",
                    inputText,
                    response,
                })

                // 6. Dry-run: print raw response and exit
                if (opts.dryRun) {
                    printJson(response as unknown as Record<string, unknown>)
                    return
                }

                // 7. Validate via the parser (re-validates against
                //    the parser's schema; idempotent in the happy
                //    path).
                const parser = new CliArgumentParser(
                    opts.title,
                    opts.description
                )
                let validated
                try {
                    validated = parser.validate(
                        response as unknown as Record<string, unknown>
                    )
                } catch (error) {
                    const msg =
                        error instanceof Error ? error.message : String(error)
                    await cliLog("parse:validation-error", { error: msg })
                    errorExit(`Validation failed: ${msg}`)
                }

                // 8. Check for null argument
                if (validated.argument === null) {
                    const msg =
                        validated.failureText ??
                        "The LLM could not parse the input as an argument."
                    await cliLog("parse:null-argument", {
                        failureText: validated.failureText,
                    })
                    errorExit(msg)
                }

                // 9. Build engine
                let built
                try {
                    built = parser.build(validated, { strict: false })
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
