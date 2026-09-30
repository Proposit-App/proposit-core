import { errorExit } from "./output.js"
import { readVersionMeta } from "./storage/arguments.js"
import { premiseExists } from "./storage/premises.js"

/**
 * Exits with an error when the given argument version is published, because a
 * published version is read-only.
 */
export async function assertNotPublished(
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

/**
 * Exits with an error when the premise has no directory on disk. Callers pass
 * their own message where the wording differs from the usual one.
 */
export async function assertPremiseExists(
    argumentId: string,
    version: number,
    premiseId: string,
    notFoundMessage = `Premise "${premiseId}" not found.`
): Promise<void> {
    if (!(await premiseExists(argumentId, version, premiseId))) {
        errorExit(notFoundMessage)
    }
}

/**
 * The text to show for a caught value: the message of an `Error`, or the
 * value converted to a string for anything else that was thrown.
 */
export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
