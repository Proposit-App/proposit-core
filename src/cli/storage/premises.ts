import fs from "node:fs/promises"
import path from "node:path"
import Value from "typebox/value"
import {
    CliPremiseDataSchema,
    CliPremiseMetaSchema,
    type TCliPremiseData,
    type TCliPremiseMeta,
} from "../schemata.js"
import { getPremiseDir, getPremisesDir } from "../config.js"
import { errorExit } from "../output.js"

export async function readPremiseMeta(
    argumentId: string,
    version: number,
    premiseId: string
): Promise<TCliPremiseMeta> {
    const filePath = path.join(
        getPremiseDir(argumentId, version, premiseId),
        "meta.json"
    )
    const content = await fs.readFile(filePath, "utf-8").catch(() => {
        errorExit(`Premise "${premiseId}" not found.`)
    })
    const raw = JSON.parse(content) as Record<string, unknown>
    // Premises could carry an unspoken mark before 5.3.0. A premise has no
    // content of its own, so a stored mark is dropped rather than refused, and
    // the next write saves the file without it.
    delete raw.enthymeme
    try {
        return Value.Parse(CliPremiseMetaSchema, raw)
    } catch {
        errorExit(`Invalid or corrupt file: ${filePath}`)
    }
}

export async function writePremiseMeta(
    argumentId: string,
    version: number,
    meta: TCliPremiseMeta
): Promise<void> {
    const dir = getPremiseDir(argumentId, version, meta.id)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
        path.join(dir, "meta.json"),
        JSON.stringify(meta, null, 2)
    )
}

export async function readPremiseData(
    argumentId: string,
    version: number,
    premiseId: string
): Promise<TCliPremiseData> {
    const filePath = path.join(
        getPremiseDir(argumentId, version, premiseId),
        "data.json"
    )
    const content = await fs.readFile(filePath, "utf-8").catch(() => {
        errorExit(`data.json not found for premise "${premiseId}".`)
    })
    const raw: unknown = JSON.parse(content)
    try {
        return Value.Parse(CliPremiseDataSchema, raw)
    } catch {
        errorExit(`Invalid or corrupt file: ${filePath}`)
    }
}

export async function writePremiseData(
    argumentId: string,
    version: number,
    premiseId: string,
    data: TCliPremiseData
): Promise<void> {
    const dir = getPremiseDir(argumentId, version, premiseId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
        path.join(dir, "data.json"),
        JSON.stringify(data, null, 2)
    )
}

export async function listPremiseIds(
    argumentId: string,
    version: number
): Promise<string[]> {
    const dir = getPremisesDir(argumentId, version)
    await fs.mkdir(dir, { recursive: true })
    const entries = await fs
        .readdir(dir, { withFileTypes: true })
        .catch(() => [])
    return entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
}

export async function deletePremiseDir(
    argumentId: string,
    version: number,
    premiseId: string
): Promise<void> {
    await fs.rm(getPremiseDir(argumentId, version, premiseId), {
        recursive: true,
        force: true,
    })
}

export async function premiseExists(
    argumentId: string,
    version: number,
    premiseId: string
): Promise<boolean> {
    const dir = getPremiseDir(argumentId, version, premiseId)
    return fs
        .stat(dir)
        .then((s) => s.isDirectory())
        .catch(() => false)
}
