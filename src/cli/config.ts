import os from "node:os"
import path from "node:path"

export function getStateDir(): string {
    return (
        process.env.PROPOSIT_HOME ?? path.join(os.homedir(), ".proposit-core")
    )
}

export function getArgumentsDir(): string {
    return path.join(getStateDir(), "arguments")
}

export function getArgumentDir(argumentId: string): string {
    return path.join(getArgumentsDir(), argumentId)
}

export function getVersionDir(argumentId: string, version: number): string {
    return path.join(getArgumentDir(argumentId), String(version))
}

export function getPremisesDir(argumentId: string, version: number): string {
    return path.join(getVersionDir(argumentId, version), "premises")
}

export function getPremiseDir(
    argumentId: string,
    version: number,
    premiseId: string
): string {
    return path.join(getPremisesDir(argumentId, version), premiseId)
}
