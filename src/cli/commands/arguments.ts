import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { Command } from "commander"
import { importArgumentFromYaml } from "../import.js"
import { getVersionDir } from "../config.js"
import { persistEngine } from "../engine.js"
import {
    errorExit,
    printJson,
    printLine,
    requireConfirmation,
} from "../output.js"
import {
    copyVersionDir,
    deleteArgumentDir,
    deleteVersionDir,
    latestVersionNumber,
    listArgumentIds,
    listVersionNumbers,
    readArgumentMeta,
    readVersionMeta,
    writeArgumentMeta,
    writeVersionMeta,
} from "../storage/arguments.js"
import { writeVariables } from "../storage/variables.js"
import { writeRoles } from "../storage/roles.js"
import { getPremisesDir } from "../config.js"

export function registerArgumentCommands(program: Command): void {
    const args = program.command("arguments").description("Manage arguments")

    args.command("create <title> <description>")
        .description("Create a new argument")
        .action(async (title: string, description: string) => {
            const id = randomUUID()
            const createdAt = new Date()

            await writeArgumentMeta({ id, title, description })
            await writeVersionMeta(id, {
                version: 0,
                createdAt,
                published: false,
            })
            await writeVariables(id, 0, [])
            await writeRoles(id, 0, { supportingPremiseIds: [] })
            await fs.mkdir(getPremisesDir(id, 0), { recursive: true })

            printLine(id)
        })

    args.command("import <yaml_file>")
        .description("Import an argument from a YAML file")
        .action(async (yamlFile: string) => {
            const filePath = path.resolve(yamlFile)
            let content: string
            try {
                content = await fs.readFile(filePath, "utf-8")
            } catch {
                errorExit(`Cannot read file: ${filePath}`)
            }

            let engine: ReturnType<typeof importArgumentFromYaml>
            try {
                engine = importArgumentFromYaml(content)
            } catch (error) {
                errorExit(
                    error instanceof Error ? error.message : String(error)
                )
            }

            await persistEngine(engine)
            printLine(engine.getArgument().id)
        })

    args.command("list")
        .description("List all arguments")
        .option("--json", "Output as JSON")
        .action(async (opts: { json?: boolean }) => {
            const ids = await listArgumentIds()
            const items = await Promise.all(
                ids.map(async (id) => {
                    const meta = await readArgumentMeta(id)
                    const versions = await listVersionNumbers(id)
                    const latestV = versions[versions.length - 1] ?? 0
                    const vMeta = await readVersionMeta(id, latestV)
                    return { meta, vMeta }
                })
            )
            // Sort newest first by createdAt
            items.sort(
                (a, b) =>
                    b.vMeta.createdAt.getTime() - a.vMeta.createdAt.getTime()
            )

            if (opts.json) {
                printJson(
                    items.map(({ meta, vMeta }) => ({
                        id: meta.id,
                        title: meta.title,
                        description: meta.description,
                        latestVersion: vMeta.version,
                        latestCreatedAt: vMeta.createdAt,
                        latestPublished: vMeta.published,
                    }))
                )
            } else {
                for (const { meta, vMeta } of items) {
                    printLine(
                        `${meta.id} | ${meta.title} (created ${vMeta.createdAt.toLocaleString()})`
                    )
                }
            }
        })

    args.command("delete <argument_id>")
        .description("Delete an argument or its latest version")
        .option("--confirm", "Skip confirmation prompt")
        .option("--all", "Delete all versions")
        .action(
            async (
                argumentId: string,
                opts: { confirm?: boolean; all?: boolean }
            ) => {
                if (!opts.confirm) {
                    await requireConfirmation(
                        `Delete argument "${argumentId}"?`
                    )
                }

                const versions = await listVersionNumbers(argumentId)
                if (versions.length === 0) {
                    errorExit(`Argument "${argumentId}" not found.`)
                }

                let deleted = 0
                if (opts.all || versions.length === 1) {
                    deleted = versions.length
                    await deleteArgumentDir(argumentId)
                } else {
                    const latest = versions[versions.length - 1]
                    await deleteVersionDir(argumentId, latest)
                    deleted = 1
                }

                printLine(`${deleted} argument(s) deleted`)
            }
        )

    args.command("publish <argument_id>")
        .description("Publish the latest version and prepare a new draft")
        .action(async (argumentId: string) => {
            const V = await latestVersionNumber(argumentId)
            const vMeta = await readVersionMeta(argumentId, V)

            if (vMeta.published) {
                errorExit(
                    `Version ${V} of argument "${argumentId}" is already published.`
                )
            }

            // Mark old version as published
            await writeVersionMeta(argumentId, {
                ...vMeta,
                published: true,
                publishedAt: new Date(),
            })

            // Copy to new version
            const newV = V + 1
            await copyVersionDir(argumentId, V, newV)

            // Overwrite new version's meta
            await writeVersionMeta(argumentId, {
                version: newV,
                createdAt: new Date(),
                published: false,
            })

            // Remove publishedAt from the new version's meta file if it was copied
            const newMetaPath = path.join(
                getVersionDir(argumentId, newV),
                "meta.json"
            )
            const newMeta = await readVersionMeta(argumentId, newV)
            const cleanMeta: Record<string, unknown> = {
                version: newMeta.version,
                createdAt: newMeta.createdAt,
                published: false,
            }
            await fs.writeFile(newMetaPath, JSON.stringify(cleanMeta, null, 2))

            printLine(`Version ${V} published, draft version ${newV} prepared`)
        })
}
