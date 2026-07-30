import fs from "node:fs/promises"
import path from "node:path"
import Type from "typebox"
import Value from "typebox/value"
import type { TCorePropositionalVariable } from "../../lib/schemata/index.js"
import { UUID } from "../../lib/schemata/shared.js"
import { getVersionDir } from "../config.js"
import { errorExit } from "../output.js"

// Local schema with optional checksum for backward-compatible disk reads.
const CliVariableSchema = Type.Object(
    {
        id: UUID,
        argumentId: UUID,
        argumentVersion: Type.Number(),
        symbol: Type.String(),
        checksum: Type.Optional(Type.String()),
    },
    { additionalProperties: true }
)

const VariablesFileSchema = Type.Array(CliVariableSchema)

function variablesPath(argumentId: string, version: number): string {
    return path.join(getVersionDir(argumentId, version), "variables.json")
}

export async function readVariables(
    argumentId: string,
    version: number
): Promise<TCorePropositionalVariable[]> {
    const filePath = variablesPath(argumentId, version)
    const content = await fs.readFile(filePath, "utf-8").catch(() => {
        errorExit(`variables.json not found for ${argumentId}@${version}.`)
    })
    const raw: unknown = JSON.parse(content)
    try {
        // The disk schema is deliberately looser than the runtime type (extra
        // properties allowed, checksum optional for files written before it
        // existed), so the validated rows are asserted back to it.
        return Value.Parse(
            VariablesFileSchema,
            raw
        ) as unknown as TCorePropositionalVariable[]
    } catch {
        errorExit(`Invalid or corrupt file: ${filePath}`)
    }
}

export async function writeVariables(
    argumentId: string,
    version: number,
    variables: TCorePropositionalVariable[]
): Promise<void> {
    await fs.writeFile(
        variablesPath(argumentId, version),
        JSON.stringify(variables, null, 2)
    )
}
