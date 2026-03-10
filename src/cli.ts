#!/usr/bin/env node
import { Command } from "commander"
import { registerMetaCommands } from "./cli/commands/meta.js"
import { registerArgumentCommands } from "./cli/commands/arguments.js"
import { registerVersionShowCommand } from "./cli/commands/version-show.js"
import { registerRoleCommands } from "./cli/commands/roles.js"
import { registerVariableCommands } from "./cli/commands/variables.js"
import { registerPremiseCommands } from "./cli/commands/premises.js"
import { registerExpressionCommands } from "./cli/commands/expressions.js"
import { registerAnalysisCommands } from "./cli/commands/analysis.js"
import { registerRenderCommand } from "./cli/commands/render.js"
import { registerDiffCommand } from "./cli/commands/diff.js"
import { isNamedCommand, resolveVersion } from "./cli/router.js"
import { errorExit } from "./cli/output.js"

const program = new Command()
program
    .name("proposit-core")
    .description("Proposit Core CLI")
    .enablePositionalOptions()
    .allowUnknownOption(false)

// ── Named top-level commands ──────────────────────────────────────────────────
registerMetaCommands(program)
registerArgumentCommands(program)
registerDiffCommand(program)

// ── Version-scoped commands ───────────────────────────────────────────────────
// If the first user argument is not a named command, treat it as an argument ID
// followed by a version specifier, then dispatch to the appropriate sub-program.
if (!isNamedCommand(process.argv)) {
    const [, , argumentId, versionArg, ...rest] = process.argv

    if (!argumentId || !versionArg) {
        errorExit(
            "Usage: proposit-core <argument_id> <argument_version> <command> ...\n       proposit-core arguments <subcommand> ..."
        )
    }

    // Resolve the version asynchronously, then build and parse a sub-program.
    const version = await resolveVersion(argumentId, versionArg)

    const sub = new Command()
    sub.name("proposit-core")
        .description(`Commands for ${argumentId}@${version}`)
        .enablePositionalOptions()

    registerVersionShowCommand(sub, argumentId, version)
    registerRenderCommand(sub, argumentId, version)
    registerRoleCommands(sub, argumentId, version)
    registerVariableCommands(sub, argumentId, version)
    registerPremiseCommands(sub, argumentId, version)
    registerExpressionCommands(sub, argumentId, version)
    registerAnalysisCommands(sub, argumentId, version)

    // Replace the consumed positional args with the remainder so Commander
    // sees: ["node", "proposit-core", <group>, <subcommand>, ...]
    await sub.parseAsync(["node", "proposit-core", ...rest])
} else {
    await program.parseAsync(process.argv)
}
