import { Command } from "commander"
import { hydrateEngine } from "../engine.js"
import { errorExit, printJson, printLine } from "../output.js"
import { readVersionMeta } from "../storage/arguments.js"
import { premiseExists } from "../storage/premises.js"
import { readRoles, writeRoles } from "../storage/roles.js"

async function assertNotPublished(
    argumentId: string,
    version: number
): Promise<void> {
    const meta = await readVersionMeta(argumentId, version)
    if (meta.published) {
        errorExit(
            `Version ${version} of argument "${argumentId}" is published and cannot be modified.`
        )
    }
}

export function registerRoleCommands(
    versionedCmd: Command,
    argumentId: string,
    version: number
): void {
    const roles = versionedCmd
        .command("roles")
        .description("Manage premise role assignments")

    roles
        .command("show")
        .description("Show current role assignments")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const engine = await hydrateEngine(argumentId, version)
            const conclusionPremiseId =
                engine.getRoleState().conclusionPremiseId
            const supportingPremiseIds = engine
                .listSupportingPremises()
                .map((pm) => pm.getId())

            if (opts.json) {
                printJson({ conclusionPremiseId, supportingPremiseIds })
            } else {
                printLine(`conclusion: ${conclusionPremiseId ?? "(none)"}`)
                printLine(
                    `supporting: ${supportingPremiseIds.length > 0 ? supportingPremiseIds.join(", ") : "(none)"}`
                )
            }
        })

    roles
        .command("set-conclusion <premise_id>")
        .description("Set the designated conclusion premise")
        .action(async (premiseId: string) => {
            await assertNotPublished(argumentId, version)
            if (!(await premiseExists(argumentId, version, premiseId))) {
                errorExit(`Premise "${premiseId}" does not exist.`)
            }
            const state = await readRoles(argumentId, version)
            await writeRoles(argumentId, version, {
                ...state,
                conclusionPremiseId: premiseId,
            })
            printLine("success")
        })

    roles
        .command("clear-conclusion")
        .description("Clear the designated conclusion premise")
        .action(async () => {
            await assertNotPublished(argumentId, version)
            const state = await readRoles(argumentId, version)
            const { conclusionPremiseId: _removed, ...rest } = state
            await writeRoles(argumentId, version, {
                ...rest,
                conclusionPremiseId: undefined,
            })
            printLine("success")
        })
}
