import { errorExit } from "./output.js"
import { readVersionMeta } from "./storage/arguments.js"

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
