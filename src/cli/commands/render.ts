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
                const typeBadge =
                    premiseData.type === "derivation" ? " [derivation]" : ""
                printLine(`  ${marker} ${display}${typeBadge}${title}`)
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

            // Claims — those referenced by this argument's variables, plus
            // any citation-typed claims reachable via citation edges.
            // Citation-typed claims render inline with a [citation] badge.
            const directlyReferencedClaims = variables
                .map((v) => v as unknown as TCorePropositionalVariable)
                .filter(isClaimBound)
                .map((v) => core.claims.get(v.claimId, v.claimVersion))
                .filter((c) => c !== undefined)

            // Walk the support graph (citations + axioms) from the directly
            // referenced claims, collecting every reachable claim and every
            // support edge so the render output covers the full closure.
            const claimByKey = new Map<
                string,
                (typeof directlyReferencedClaims)[number]
            >()
            for (const claim of directlyReferencedClaims) {
                claimByKey.set(`${claim.id}@${claim.version}`, claim)
            }
            const referencedCitations: ReturnType<
                typeof core.citations.getAll
            > = []
            const referencedAxioms: ReturnType<typeof core.axioms.getAll> = []
            const seenConnectionIds = new Set<string>()
            const frontier: string[] = directlyReferencedClaims.map((c) => c.id)
            const visitedClaimIds = new Set(frontier)
            while (frontier.length > 0) {
                const claimId = frontier.pop()!
                const outgoingCitations =
                    core.citations.getConnectionsForClaim(claimId)
                const outgoingAxioms =
                    core.axioms.getConnectionsForClaim(claimId)
                const outgoing = [
                    ...outgoingCitations.map((c) => ({
                        kind: "citation" as const,
                        conn: c,
                    })),
                    ...outgoingAxioms.map((a) => ({
                        kind: "axiom" as const,
                        conn: a,
                    })),
                ]
                for (const { kind, conn } of outgoing) {
                    if (seenConnectionIds.has(conn.id)) continue
                    seenConnectionIds.add(conn.id)
                    if (kind === "citation") {
                        referencedCitations.push(conn)
                    } else {
                        referencedAxioms.push(conn)
                    }
                    const supportingClaim = core.claims.get(
                        conn.supportingClaimId,
                        conn.supportingClaimVersion
                    )
                    if (supportingClaim) {
                        const key = `${supportingClaim.id}@${supportingClaim.version}`
                        if (!claimByKey.has(key)) {
                            claimByKey.set(key, supportingClaim)
                        }
                        if (!visitedClaimIds.has(supportingClaim.id)) {
                            visitedClaimIds.add(supportingClaim.id)
                            frontier.push(supportingClaim.id)
                        }
                    }
                }
            }

            const referencedClaims = Array.from(claimByKey.values())
            if (referencedClaims.length > 0) {
                printLine("")
                printLine("Claims:")
                for (const claim of referencedClaims) {
                    const extras = claim as Record<string, unknown>
                    const frozen = claim.frozen ? " [frozen]" : ""
                    const typeBadge =
                        claim.type === "citation" ? " [citation]" : ""
                    const meta = extrasString(extras, ["title", "body"])
                    printLine(
                        `  ${claim.id}@${claim.version}${frozen}${typeBadge}${meta}`
                    )
                }
            }

            // Citations — edges between claims (claim -> supporting claim).
            if (referencedCitations.length > 0) {
                printLine("")
                printLine("Citations:")
                for (const citation of referencedCitations) {
                    printLine(
                        `  ${citation.id} | ${citation.claimId}@${citation.claimVersion} -> ${citation.supportingClaimId}@${citation.supportingClaimVersion}`
                    )
                }
            }

            // Axioms — edges between claims (claim -> supporting axiomatic claim).
            if (referencedAxioms.length > 0) {
                printLine("")
                printLine("Axioms:")
                for (const axiom of referencedAxioms) {
                    printLine(
                        `  ${axiom.id} | ${axiom.claimId}@${axiom.claimVersion} -> ${axiom.supportingClaimId}@${axiom.supportingClaimVersion}`
                    )
                }
            }
        })
}
