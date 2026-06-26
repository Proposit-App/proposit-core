#!/usr/bin/env node
// Terminal Argument Builder — interactive REPL.
//
// Usage: node dist/cli/builder-repl.js [--provider openai] [--api-key KEY]
//
// Commands:
//   /simulate   — run a simulate turn (play-the-user)
//   /finalize   — run a finalize turn and exit
//   /quit       — exit
//   any other   — runs a review turn with your input as the user message

import * as readline from "node:readline"
import { createOpenAiResponsesProvider } from "../extensions/openai/index.js"
import { createConversation } from "../lib/conversation/conversation.js"
import type { TConversation } from "../lib/conversation/conversation.js"
import { createReviewTurn } from "../extensions/builder/review.js"
import { createSimulateTurn } from "../extensions/builder/simulate.js"
import { createFinalizeTurn } from "../extensions/builder/finalize.js"
import type { TTurnResult } from "../lib/conversation/turn.js"
import type { TExecuteTurnDeps } from "../lib/conversation/turn.js"
import type { TStage } from "../lib/pipelines/types.js"

const DEFAULT_MODEL = "gpt-5.5"
const DEFAULT_API_KEY =
    process.env.PROPOSIT_API_KEY ?? process.env.OPENAI_API_KEY

function parseArgs(): { provider: string; apiKey?: string } {
    const args: string[] = []
    for (let i = 2; i < process.argv.length; i++) {
        args.push(process.argv[i])
    }
    let provider = "openai"
    let apiKey: string | undefined
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--provider" && i + 1 < args.length) {
            provider = args[++i]
        } else if (args[i] === "--api-key" && i + 1 < args.length) {
            apiKey = args[++i]
        }
    }
    return { provider, apiKey }
}

function buildDeps(provider: string, apiKey: string): TExecuteTurnDeps {
    let llm: import("../lib/llm/types.js").TLlmProvider
    switch (provider) {
        case "openai":
            llm = createOpenAiResponsesProvider({ apiKey })
            break
        default:
            console.error(`Unknown provider "${provider}". Supported: openai.`)
            process.exit(1)
    }
    return { llm }
}

function printResult<TOut>(result: TTurnResult<TOut>, turnName: string): void {
    if (result.failures.length > 0) {
        for (const f of result.failures) {
            console.error(`[${f.code}] ${f.message}`)
        }
    }
    if (result.output !== null) {
        console.log(`\n--- ${turnName} ---`)
        const output = result.output as Record<string, unknown>
        if (output.uncategorizedText) {
            console.log(output.uncategorizedText as string)
        }
        if (output.failureText) {
            console.log(output.failureText as string)
        }
        if (output.selectionRationale) {
            console.log(output.selectionRationale as string)
        }
        if (output.argument) {
            const arg = output.argument as Record<string, unknown>
            if (arg.claims) {
                console.log("\nClaims:")
                for (const c of arg.claims as Record<string, unknown>[]) {
                    const role = c.role as string
                    const type = c.type as string
                    const miniId = c.miniId as string
                    console.log(`  ${miniId} [${role}, ${type}]`)
                }
            }
            if (arg.premises) {
                console.log("\nPremises:")
                for (const p of arg.premises as Record<string, unknown>[]) {
                    const miniId = p.miniId as string
                    const formula = p.formula as string
                    console.log(`  ${miniId}: ${formula}`)
                }
            }
        }
        console.log()
    } else {
        console.log(`[${turnName}]: no output (turn failed)`)
        console.log()
    }
}

function buildTurnFactory(
    conversation: TConversation,
    turnName: string,
    factory: (model: string) => TStage<unknown>
): (model: string) => () => Promise<void> {
    return (model: string) => {
        return async (): Promise<void> => {
            const stage = factory(model)
            const result = await conversation.turn(stage, {
                userMessage: "[conversation transcript]",
            })
            printResult(result, turnName)
        }
    }
}

// eslint-disable-next-line @typescript-eslint/require-await
async function main(): Promise<void> {
    const { provider, apiKey } = parseArgs()
    const key = apiKey ?? DEFAULT_API_KEY
    if (!key) {
        console.error(
            "No API key provided. Set PROPOSIT_API_KEY or use --api-key."
        )
        process.exit(1)
    }

    const deps = buildDeps(provider, key)
    const model = DEFAULT_MODEL
    const conversation = createConversation(deps)

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "builder> ",
    })

    const doReview = buildTurnFactory(conversation, "review", createReviewTurn)
    const doSimulate = buildTurnFactory(
        conversation,
        "simulate",
        createSimulateTurn
    )

    const review = doReview(model)
    const simulate = doSimulate(model)

    const doFinalize = async (): Promise<void> => {
        const stage = createFinalizeTurn({
            model,
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            onClose: () => {},
        })
        const result = await conversation.turn(
            stage,
            {
                userMessage: "[conversation transcript]",
            },
            { onComplete: () => conversation.close() }
        )
        printResult(result, "finalize")
        conversation.close()
    }

    console.log("Terminal Argument Builder")
    console.log("Commands: /simulate, /finalize, /quit")
    console.log("Enter your text to start a review turn.\n")

    rl.prompt()

    rl.on("line", (line: string) => {
        // Fire-and-forget async handler: the REPL keeps running regardless.
        const trimmed = line.trim()
        if (!trimmed) {
            rl.prompt()
            return
        }

        if (trimmed === "/simulate") {
            void simulate().then(() => rl.prompt())
            return
        }

        if (trimmed === "/finalize") {
            void doFinalize().then(() => {
                console.log("Conversation finalized. Goodbye.")
                rl.close()
            })
            return
        }

        if (trimmed === "/quit") {
            console.log("Goodbye.")
            rl.close()
            return
        }

        void review().then(() => rl.prompt())
    })

    rl.on("close", () => {
        console.log()
        process.exit(0)
    })
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
})
