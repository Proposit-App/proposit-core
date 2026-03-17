import { Command } from "commander"
import { hydrateEngine, hydrateLibraries } from "../engine.js"
import { isClaimBound, isPremiseBound } from "../../lib/schemata/index.js"
import type { TCorePropositionalVariable } from "../../lib/schemata/index.js"
import { printLine } from "../output.js"

function extrasString(obj: Record<string, unknown>, fields: string[]): string {
    const parts: string[] = []
    for (const field of fields) {
        const val = obj[field]
        if (typeof val === "string" && val.length > 0) {
            parts.push(`${field}: ${val}`)
        }
    }
    return parts.length > 0 ? ` | ${parts.join(" | ")}` : ""
}

export function registerRenderCommand(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    versionedCmd
        .command("render")
        .description("Render all premises as logical expression strings")
        .action(async () => {
            const libs = await hydrateLibraries()
            const engine = await hydrateEngine(argumentId, version, libs)
            const arg = engine.getArgument() as Record<string, unknown>
            const roles = engine.getRoleState()
            const conclusionId = roles.conclusionPremiseId

            // Argument header
            const argTitle =
                typeof arg.title === "string" ? arg.title : "(untitled)"
            const argDesc =
                typeof arg.description === "string"
                    ? ` — ${arg.description}`
                    : ""
            printLine(`Argument: ${argTitle}${argDesc}`)
            printLine("")

            // Premises
            printLine("Premises:")
            const all = engine.listPremises()
            const sorted = [
                ...all.filter((pm) => pm.getId() === conclusionId),
                ...all.filter((pm) => pm.getId() !== conclusionId),
            ]

            for (const pm of sorted) {
                const id = pm.getId()
                const marker = id === conclusionId ? "*" : " "
                const display = pm.toDisplayString() || "(empty)"
                const premiseData = pm.toPremiseData() as Record<
                    string,
                    unknown
                >
                const title =
                    typeof premiseData.title === "string"
                        ? ` | ${premiseData.title}`
                        : ""
                printLine(`  ${marker} ${display}${title}`)
            }

            // Variables
            const variables = engine.getVariables()
            if (variables.length > 0) {
                printLine("")
                printLine("Variables:")
                for (const v of variables) {
                    const typed = v as unknown as TCorePropositionalVariable
                    let binding = ""
                    if (isClaimBound(typed)) {
                        const claim = libs.claimLibrary.get(
                            typed.claimId,
                            typed.claimVersion
                        )
                        if (claim) {
                            const claimExtras = claim as Record<string, unknown>
                            const claimTitle =
                                typeof claimExtras.title === "string"
                                    ? claimExtras.title
                                    : `${typed.claimId}@${typed.claimVersion}`
                            binding = ` → ${claimTitle}`
                        }
                    } else if (isPremiseBound(typed)) {
                        binding = ` → premise:${typed.boundPremiseId}`
                    }
                    printLine(`  ${v.symbol}${binding}`)
                }
            }

            // Claims
            const claims = libs.claimLibrary.getAll()
            if (claims.length > 0) {
                printLine("")
                printLine("Claims:")
                for (const claim of claims) {
                    const extras = claim as Record<string, unknown>
                    const frozen = claim.frozen ? " [frozen]" : ""
                    const meta = extrasString(extras, ["title", "body"])
                    printLine(`  ${claim.id}@${claim.version}${frozen}${meta}`)
                }
            }

            // Sources
            const sources = libs.sourceLibrary.getAll()
            if (sources.length > 0) {
                printLine("")
                printLine("Sources:")
                for (const source of sources) {
                    const extras = source as Record<string, unknown>
                    const meta = extrasString(extras, ["text"])
                    printLine(`  ${source.id}@${source.version}${meta}`)
                }
            }
        })
}
