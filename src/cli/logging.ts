import fs from "node:fs/promises"
import path from "node:path"
import { getLogsDir } from "./config.js"

function logFilePath(): string {
    return path.join(getLogsDir(), "cli.jsonl")
}

/**
 * Append a structured log entry to the CLI log file.
 *
 * Each entry is a single JSON line with a timestamp, event name,
 * and optional data payload.
 */
export async function cliLog(
    event: string,
    data?: Record<string, unknown>
): Promise<void> {
    const entry = {
        timestamp: new Date().toISOString(),
        event,
        ...data,
    }
    const filePath = logFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.appendFile(filePath, JSON.stringify(entry) + "\n")
}
