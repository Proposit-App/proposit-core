import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import { Command } from "commander"
import { hydratePropositCore, persistCore } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"
import {
    codePointLength,
    sliceByCodePoints,
} from "../../lib/utils/origin-text.js"
import type { TOriginAnchorTargetType } from "../../lib/schemata/index.js"

const STANCES = ["representation", "seed"] as const
const TARGET_TYPES = ["expression", "premise", "argument"] as const

function parseIntegerOption(value: string, label: string): number {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0) {
        errorExit(`${label} must be a non-negative integer (got "${value}").`)
    }
    return parsed
}

export function registerOriginCommands(program: Command): void {
    const origins = program
        .command("origins")
        .description("Manage source texts and the spans arguments derive from")

    origins
        .command("attach <file>")
        .description(
            "Store a source text from a file and link it to an argument version"
        )
        .requiredOption("--argument <id>", "Argument ID to link the text to")
        .requiredOption("--version <n>", "Argument version to link the text to")
        .option(
            "--stance <stance>",
            `What the argument claims about the source: ${STANCES.join(" | ")}`,
            "seed"
        )
        .action(
            async (
                file: string,
                opts: { argument: string; version: string; stance: string }
            ) => {
                if (
                    !STANCES.includes(opts.stance as (typeof STANCES)[number])
                ) {
                    errorExit(
                        `Unknown stance "${opts.stance}". Expected one of: ${STANCES.join(", ")}.`
                    )
                }
                let text: string
                try {
                    text = await fs.readFile(file, "utf-8")
                } catch {
                    errorExit(`Cannot read source text file "${file}".`)
                }
                const version = parseIntegerOption(opts.version, "--version")
                const core = await hydratePropositCore()
                let documentId: string
                try {
                    const document = core.origins.addDocument({
                        id: randomUUID(),
                        text,
                    })
                    documentId = document.id
                    core.origins.addLink({
                        id: randomUUID(),
                        argumentId: opts.argument,
                        argumentVersion: version,
                        documentId: document.id,
                        stance: opts.stance as (typeof STANCES)[number],
                    })
                } catch (error) {
                    errorExit(
                        error instanceof Error ? error.message : String(error)
                    )
                }
                await persistCore(core)
                printLine(documentId)
            }
        )

    origins
        .command("list")
        .description("List stored source texts and their links")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            if (opts.json) {
                printJson(core.origins.snapshot())
                return
            }
            for (const document of core.origins.getAllDocuments()) {
                const links = core.origins
                    .getAllLinks()
                    .filter((l) => l.documentId === document.id)
                const anchorCount = core.origins
                    .getAllAnchors()
                    .filter((a) => a.documentId === document.id).length
                printLine(
                    `${document.id} | ${codePointLength(document.text)} code points | ${links.length} link(s) | ${anchorCount} anchor(s)`
                )
                for (const link of links) {
                    printLine(
                        `  ${link.argumentId}@${link.argumentVersion} (${link.stance})`
                    )
                }
            }
        })

    origins
        .command("show <document_id>")
        .description("Show a source text, its links, and its anchors")
        .option("--json", "Output as JSON")
        .option("--text", "Print only the stored text")
        .action(
            async (
                documentId: string,
                opts: { json?: boolean; text?: boolean }
            ) => {
                const core = await hydratePropositCore()
                const document = core.origins.getDocument(documentId)
                if (!document) {
                    errorExit(`Origin document "${documentId}" not found.`)
                }
                if (opts.text) {
                    printLine(document.text)
                    return
                }
                const links = core.origins
                    .getAllLinks()
                    .filter((l) => l.documentId === documentId)
                const anchors = core.origins
                    .getAllAnchors()
                    .filter((a) => a.documentId === documentId)
                if (opts.json) {
                    printJson({ document, links, anchors })
                    return
                }
                printLine(`id:          ${document.id}`)
                printLine(`digest:      ${document.digest}`)
                printLine(`codePoints:  ${codePointLength(document.text)}`)
                for (const link of links) {
                    printLine(
                        `link:        ${link.id} -> ${link.argumentId}@${link.argumentVersion} (${link.stance})`
                    )
                }
                for (const anchor of anchors) {
                    printLine(
                        `anchor:      ${anchor.id} -> ${anchor.targetType} ${anchor.targetId} [${anchor.startCodePoint}, ${anchor.endCodePoint}) "${anchor.exact}"`
                    )
                }
            }
        )

    const anchor = origins
        .command("anchor")
        .description("Manage the spans argument parts derive from")

    anchor
        .command("add")
        .description(
            "Record the span of a source text that one argument part derives from"
        )
        .requiredOption("--document <id>", "Origin document ID")
        .requiredOption("--argument <id>", "Argument ID")
        .requiredOption("--version <n>", "Argument version")
        .requiredOption(
            "--target <type>",
            `What the anchor points at: ${TARGET_TYPES.join(" | ")}`
        )
        .requiredOption("--target-id <id>", "ID of the anchored part")
        .requiredOption(
            "--start <n>",
            "Inclusive start of the span, in Unicode code points"
        )
        .requiredOption(
            "--end <n>",
            "Exclusive end of the span, in Unicode code points"
        )
        .action(
            async (opts: {
                document: string
                argument: string
                version: string
                target: string
                targetId: string
                start: string
                end: string
            }) => {
                if (
                    !TARGET_TYPES.includes(
                        opts.target as TOriginAnchorTargetType
                    )
                ) {
                    errorExit(
                        `Unknown target "${opts.target}". Expected one of: ${TARGET_TYPES.join(", ")}.`
                    )
                }
                const core = await hydratePropositCore()
                const document = core.origins.getDocument(opts.document)
                if (!document) {
                    errorExit(`Origin document "${opts.document}" not found.`)
                }
                const version = parseIntegerOption(opts.version, "--version")
                const start = parseIntegerOption(opts.start, "--start")
                const end = parseIntegerOption(opts.end, "--end")
                // The quote is derived by slicing rather than supplied: a
                // reader picked a range, so the positions are authoritative
                // here and a hand-typed quote could only disagree with them.
                const exact = sliceByCodePoints(document.text, start, end)
                let anchorId: string
                try {
                    anchorId = core.origins.addAnchor({
                        id: randomUUID(),
                        argumentId: opts.argument,
                        argumentVersion: version,
                        documentId: document.id,
                        targetType: opts.target as TOriginAnchorTargetType,
                        targetId: opts.targetId,
                        exact,
                        startCodePoint: start,
                        endCodePoint: end,
                    }).id
                } catch (error) {
                    errorExit(
                        error instanceof Error ? error.message : String(error)
                    )
                }
                await persistCore(core)
                printLine(anchorId)
            }
        )

    anchor
        .command("remove <anchor_id>")
        .description("Remove an anchor")
        .action(async (anchorId: string) => {
            const core = await hydratePropositCore()
            if (!core.origins.getAnchor(anchorId)) {
                errorExit(`Origin anchor "${anchorId}" not found.`)
            }
            core.origins.removeAnchor(anchorId)
            await persistCore(core)
            printLine("success")
        })
}
