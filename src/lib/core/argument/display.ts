import type { TCoreArgument } from "../../schemata/index.js"

/**
 * The plain-text rendering `ArgumentEngine.toDisplayString` returns: a
 * header, then one line per premise labelled by its role. The premise list
 * is read through `listPremises`, after the supporting set, in the order the
 * method always read them.
 */
export function renderArgumentDisplay(
    arg: TCoreArgument,
    supportingPremises: readonly { getId(): string }[],
    listPremises: () => readonly {
        getId(): string
        toDisplayString(): string
    }[],
    conclusionPremiseId: string | undefined
): string {
    const lines: string[] = []
    lines.push(`Argument: ${arg.id} (v${arg.version})`)
    lines.push("")

    const supportingIds = new Set(supportingPremises.map((pe) => pe.getId()))

    for (const pe of listPremises()) {
        let role: string
        if (pe.getId() === conclusionPremiseId) {
            role = "Conclusion"
        } else if (supportingIds.has(pe.getId())) {
            role = "Supporting"
        } else {
            role = "Constraint"
        }
        const display = pe.toDisplayString() || "(empty)"
        lines.push(`[${role}] ${display}`)
    }

    return lines.join("\n")
}
