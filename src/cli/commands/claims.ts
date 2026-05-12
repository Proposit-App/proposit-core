import { randomUUID } from "node:crypto"
import { Command } from "commander"
import { hydratePropositCore, persistCore } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"
import {
    CLI_AXIOM_REASON_CODES,
    type TCliAxiomReasonCode,
} from "../schemata.js"

export function registerClaimCommands(program: Command): void {
    const claims = program
        .command("claims")
        .description("Manage global claim library")

    claims
        .command("list")
        .description("List all claims")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            const all = core.claims.getAll()
            if (opts.json) {
                printJson(all)
            } else {
                for (const claim of all) {
                    const extras = claim as Record<string, unknown>
                    const frozen = claim.frozen ? " [frozen]" : ""
                    const typeBadge =
                        claim.type === "citation"
                            ? " [citation]"
                            : claim.type === "axiomatic"
                              ? ` [axiom: ${(claim as { reasonCode?: string }).reasonCode ?? "?"}]`
                              : ""
                    const title =
                        typeof extras.title === "string"
                            ? ` | ${extras.title}`
                            : ""
                    printLine(
                        `${claim.id}@${claim.version}${frozen}${typeBadge}${title}`
                    )
                }
            }
        })

    claims
        .command("show <claim_id>")
        .description("Show all versions of a claim")
        .option("--json", "Output as JSON")
        .action(async (claimId: string, opts: { json?: boolean }) => {
            const core = await hydratePropositCore()
            const versions = core.claims.getVersions(claimId)
            if (versions.length === 0) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            if (opts.json) {
                printJson(versions)
            } else {
                for (const v of versions) {
                    const extras = v as Record<string, unknown>
                    const frozen = v.frozen ? " [frozen]" : ""
                    const typeBadge =
                        v.type === "citation"
                            ? " [citation]"
                            : v.type === "axiomatic"
                              ? ` [axiom: ${(v as { reasonCode?: string }).reasonCode ?? "?"}]`
                              : ""
                    printLine(`v${v.version}${frozen}${typeBadge}`)
                    if (typeof extras.title === "string") {
                        printLine(`  title: ${extras.title}`)
                    }
                    if (typeof extras.body === "string") {
                        printLine(`  body:  ${extras.body}`)
                    }
                    if (
                        v.type === "axiomatic" &&
                        typeof extras.reasonCode === "string"
                    ) {
                        printLine(`  reason: ${extras.reasonCode}`)
                    }
                }
            }
        })

    claims
        .command("add")
        .description("Create a new claim")
        .option(
            "--type <type>",
            "Claim type: 'normal', 'citation', or 'axiomatic' (default: normal)",
            "normal"
        )
        .option(
            "--reason <code>",
            `Reason code (required for --type axiomatic). One of: ${CLI_AXIOM_REASON_CODES.join(", ")}`
        )
        .option("--title <title>", "Short title summarizing the claim")
        .option("--body <body>", "Detailed description of the claim")
        .action(
            async (opts: {
                type?: string
                reason?: string
                title?: string
                body?: string
            }) => {
                const claimType = opts.type ?? "normal"
                if (
                    claimType !== "normal" &&
                    claimType !== "citation" &&
                    claimType !== "axiomatic"
                ) {
                    errorExit(
                        `Invalid --type value "${claimType}". Must be "normal", "citation", or "axiomatic".`
                    )
                }
                if (claimType === "axiomatic") {
                    if (opts.reason === undefined) {
                        errorExit(
                            `--reason is required when --type=axiomatic. Valid codes: ${CLI_AXIOM_REASON_CODES.join(", ")}`
                        )
                    }
                    if (
                        !CLI_AXIOM_REASON_CODES.includes(
                            opts.reason as TCliAxiomReasonCode
                        )
                    ) {
                        errorExit(
                            `Invalid --reason value "${opts.reason}". Valid codes: ${CLI_AXIOM_REASON_CODES.join(", ")}`
                        )
                    }
                } else if (opts.reason !== undefined) {
                    errorExit(`--reason is only valid with --type=axiomatic.`)
                }
                const core = await hydratePropositCore()
                const claim = core.claims.create({
                    id: randomUUID(),
                    type: claimType,
                    ...(opts.title !== undefined ? { title: opts.title } : {}),
                    ...(opts.body !== undefined ? { body: opts.body } : {}),
                    ...(opts.reason !== undefined
                        ? { reasonCode: opts.reason }
                        : {}),
                } as Parameters<typeof core.claims.create>[0])
                await persistCore(core)
                printLine(claim.id)
            }
        )

    claims
        .command("update <claim_id>")
        .description("Update claim metadata")
        .option("--title <title>", "New title")
        .option("--body <body>", "New body")
        .action(
            async (
                claimId: string,
                opts: { title?: string; body?: string }
            ) => {
                const core = await hydratePropositCore()
                const current = core.claims.getCurrent(claimId)
                if (!current) {
                    errorExit(`Claim "${claimId}" not found.`)
                }
                if (current.frozen) {
                    errorExit(
                        `Claim "${claimId}" version ${current.version} is frozen and cannot be updated.`
                    )
                }
                const updates: Record<string, unknown> = {}
                if (opts.title !== undefined) updates.title = opts.title
                if (opts.body !== undefined) updates.body = opts.body
                if (Object.keys(updates).length === 0) {
                    errorExit("No updates specified. Use --title or --body.")
                }
                core.claims.update(
                    claimId,
                    updates as Parameters<typeof core.claims.update>[1]
                )
                await persistCore(core)
                printLine("success")
            }
        )

    claims
        .command("freeze <claim_id>")
        .description(
            "Freeze the current version and create a new mutable version"
        )
        .action(async (claimId: string) => {
            const core = await hydratePropositCore()
            const current = core.claims.getCurrent(claimId)
            if (!current) {
                errorExit(`Claim "${claimId}" not found.`)
            }
            let frozen, newVersion
            try {
                const result = core.claims.freeze(claimId)
                frozen = result.frozen
                newVersion = result.current
            } catch (error) {
                errorExit(
                    error instanceof Error ? error.message : String(error)
                )
            }
            await persistCore(core)
            printLine(
                `Frozen v${frozen.version}, new mutable v${newVersion.version}`
            )
        })
}
