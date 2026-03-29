import { Command } from "commander"
import { hydrateEngine, hydratePropositCore } from "../engine.js"
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
            const core = await hydratePropositCore()
            const engine = await hydrateEngine(argumentId, version, core)
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
                        const claim = core.claims.get(
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

            // Claims — only those referenced by this argument's variables
            const referencedClaims = variables
                .map((v) => v as unknown as TCorePropositionalVariable)
                .filter(isClaimBound)
                .map((v) => core.claims.get(v.claimId, v.claimVersion))
                .filter((c) => c !== undefined)
            if (referencedClaims.length > 0) {
                printLine("")
                printLine("Claims:")
                for (const claim of referencedClaims) {
                    const extras = claim as Record<string, unknown>
                    const frozen = claim.frozen ? " [frozen]" : ""
                    const meta = extrasString(extras, ["title", "body"])
                    printLine(`  ${claim.id}@${claim.version}${frozen}${meta}`)
                }
            }

            // Sources — only those associated with referenced claims
            const referencedClaimKeys = new Set(
                referencedClaims.map((c) => `${c.id}@${c.version}`)
            )
            const allAssocs = core.claimSources.getAll()
            const referencedSourceKeys = new Set(
                allAssocs
                    .filter((a) =>
                        referencedClaimKeys.has(
                            `${a.claimId}@${a.claimVersion}`
                        )
                    )
                    .map((a) => `${a.sourceId}@${a.sourceVersion}`)
            )
            const referencedSources = core.sources
                .getAll()
                .filter((s) => referencedSourceKeys.has(`${s.id}@${s.version}`))
            if (referencedSources.length > 0) {
                printLine("")
                printLine("Sources:")
                for (const source of referencedSources) {
                    const extras = source as Record<string, unknown>
                    const meta = extrasString(extras, ["text"])
                    printLine(`  ${source.id}@${source.version}${meta}`)
                }
            }
        })
}
