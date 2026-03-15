import fs from "node:fs/promises"
import path from "node:path"
import { getStateDir } from "../config.js"

export function claimSourceAssociationsPath(): string {
    return path.join(getStateDir(), "claim-source-associations.json")
}

export async function readClaimSourceAssociations(): Promise<unknown[]> {
    const filePath = claimSourceAssociationsPath()
    try {
        const content = await fs.readFile(filePath, "utf-8")
        return JSON.parse(content) as unknown[]
    } catch {
        return []
    }
}

export async function writeClaimSourceAssociations(
    associations: unknown[]
): Promise<void> {
    const filePath = claimSourceAssociationsPath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(associations, null, 2))
}
