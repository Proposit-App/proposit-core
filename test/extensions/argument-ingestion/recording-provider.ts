// `RecordingLlmProvider` — recorded-replay TLlmProvider for golden
// corpus fixtures.
//
// Mode is controlled by the `INGESTION_TEST_RECORD` env var:
//
//   - `INGESTION_TEST_RECORD=1` → record mode. Each `respond` call
//     delegates to the supplied `underlying` provider (the real
//     OpenAI provider in practice); request + response are appended
//     to `recorded-llm.json` under the fixture directory.
//
//   - unset → replay mode. Each `respond` call computes the request
//     hash and looks up the matching recorded entry. On hash miss,
//     throws `RecordedPromptStaleError`; the prompt-drift guard
//     described in spec §11.3.
//
// The hash is computed from a stable JSON serialization of the
// non-volatile request fields: `{ model, systemPrompt, userMessage,
// outputSchema }`. Volatile fields (`signal`, `_typeMarker`,
// `tools.handler`, etc.) are excluded.
//
// File format (`recorded-llm.json`):
//
//   {
//     "version": 1,
//     "records": [
//       { "hash": "<sha256-hex>", "stageId": "<id>",
//         "request": { ...stable summary... },
//         "response": { "output": ..., "tokenUsage": {...}, "rawResponseId": "..." } }
//     ]
//   }
//
// One JSON file per fixture. Records are appended in record mode and
// looked up by hash in replay mode.

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import type {
    TLlmProvider,
    TLlmRequest,
    TLlmResponse,
} from "../../../src/lib/llm/types.js"

const DEFAULT_RECORDED_FILE = "recorded-llm.json"
const FILE_VERSION = 1
const STAGE_ID_MARKER = /<!--\s*stage-id:\s*([^\s>]+)\s*-->/

export class RecordedPromptStaleError extends Error {
    public readonly stageId: string
    public readonly hash: string

    constructor(args: { stageId: string; hash: string; message: string }) {
        super(args.message)
        this.name = "RecordedPromptStaleError"
        this.stageId = args.stageId
        this.hash = args.hash
    }
}

export type TRecordedRequest = {
    model: string
    systemPrompt: string
    userMessage: string
    outputSchema: unknown
}

export type TRecordedResponse = {
    output: unknown
    tokenUsage: { input: number; output: number; reasoning?: number }
    rawResponseId?: string
}

export type TRecordedEntry = {
    hash: string
    stageId: string | null
    request: TRecordedRequest
    response: TRecordedResponse
}

export type TRecordedFile = {
    version: number
    records: TRecordedEntry[]
}

export type TCreateRecordingLlmProviderOptions = {
    /** Directory containing the fixture's recorded-llm file. */
    fixtureDir: string
    /** Mode override; defaults to env-driven (`INGESTION_TEST_RECORD=1`). */
    mode?: "record" | "replay"
    /** Underlying provider invoked in record mode. Required when mode === "record". */
    underlying?: TLlmProvider
    /**
     * File name (relative to `fixtureDir`) holding the recorded
     * records. Defaults to `recorded-llm.json` (the v1 default).
     * v2 callers pass `v2-recorded-llm.json` to keep v1 + v2 recordings
     * side-by-side in the same fixture directory.
     */
    fileName?: string
}

export function recordingMode(): "record" | "replay" {
    return process.env.INGESTION_TEST_RECORD === "1" ? "record" : "replay"
}

/**
 * Stable JSON serialization with sorted object keys. Used to compute
 * the request hash so prompt rephrasings, schema tweaks, or model
 * changes all surface as a hash miss in replay mode.
 */
function stableStringify(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) => {
        if (v !== null && typeof v === "object" && !Array.isArray(v)) {
            const obj = v as Record<string, unknown>
            // Skip function values — they don't serialize and they
            // shouldn't participate in identity (handlers are bound
            // per-call, not part of the request shape).
            const sorted: Record<string, unknown> = {}
            for (const key of Object.keys(obj).sort()) {
                const entry = obj[key]
                if (typeof entry === "function") continue
                sorted[key] = entry
            }
            return sorted
        }
        return v
    })
}

function hashRequest(req: TRecordedRequest): string {
    const stable = stableStringify(req)
    return crypto.createHash("sha256").update(stable).digest("hex")
}

function buildRecordedRequest<T>(req: TLlmRequest<T>): TRecordedRequest {
    return {
        model: req.model,
        systemPrompt: req.systemPrompt,
        userMessage: req.userMessage,
        // outputSchema is a TypeBox TSchema (plain JSON-serializable
        // object); we serialize via JSON.parse(JSON.stringify(...))
        // to strip any symbol-keyed Typebox metadata that wouldn't
        // round-trip through the recorded file.
        outputSchema: JSON.parse(JSON.stringify(req.outputSchema)) as unknown,
    }
}

function extractStageId(systemPrompt: string): string | null {
    const m = STAGE_ID_MARKER.exec(systemPrompt)
    return m ? m[1] : null
}

function readRecordedFile(filePath: string): TRecordedFile {
    if (!fs.existsSync(filePath)) {
        return { version: FILE_VERSION, records: [] }
    }
    const raw = fs.readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as TRecordedFile
    if (parsed.version !== FILE_VERSION) {
        throw new Error(
            `${filePath}: unsupported version ${String(
                parsed.version
            )}; expected ${String(FILE_VERSION)}.`
        )
    }
    return parsed
}

function writeRecordedFile(filePath: string, file: TRecordedFile): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, JSON.stringify(file, null, 2) + "\n", "utf-8")
}

export function createRecordingLlmProvider(
    options: TCreateRecordingLlmProviderOptions
): TLlmProvider {
    const mode = options.mode ?? recordingMode()
    const filePath = path.join(
        options.fixtureDir,
        options.fileName ?? DEFAULT_RECORDED_FILE
    )

    if (mode === "record") {
        if (!options.underlying) {
            throw new Error(
                "RecordingLlmProvider record mode requires an `underlying` provider."
            )
        }
        const underlying = options.underlying
        // In-memory append; we flush after every call so a crash
        // mid-recording still preserves earlier records.
        const file = readRecordedFile(filePath)
        return {
            async respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>> {
                const recordedReq = buildRecordedRequest(req)
                const hash = hashRequest(recordedReq)
                const stageId = extractStageId(req.systemPrompt)
                const response = await underlying.respond(req)
                const entry: TRecordedEntry = {
                    hash,
                    stageId,
                    request: recordedReq,
                    response: {
                        output: response.output,
                        tokenUsage: response.tokenUsage,
                        rawResponseId: response.rawResponseId,
                    },
                }
                // Replace any earlier record with the same hash (e.g.,
                // re-recording the same fixture overwrites old data).
                const existingIdx = file.records.findIndex(
                    (r) => r.hash === hash
                )
                if (existingIdx >= 0) {
                    file.records[existingIdx] = entry
                } else {
                    file.records.push(entry)
                }
                writeRecordedFile(filePath, file)
                return response
            },
        }
    }

    // replay mode
    const file = readRecordedFile(filePath)
    const byHash = new Map<string, TRecordedEntry>()
    for (const entry of file.records) {
        byHash.set(entry.hash, entry)
    }
    return {
        async respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>> {
            // Even in replay mode we honor the abort signal so
            // cancellation tests work end-to-end. The await-yield
            // here also matches the async signature of the real
            // provider so timing-sensitive tests don't see a sync
            // resolve.
            await Promise.resolve()
            if (req.signal?.aborted) {
                const abortErr = new Error("aborted")
                abortErr.name = "AbortError"
                throw abortErr
            }
            const recordedReq = buildRecordedRequest(req)
            const hash = hashRequest(recordedReq)
            const stageId = extractStageId(req.systemPrompt) ?? "<unknown>"
            const entry = byHash.get(hash)
            if (!entry) {
                throw new RecordedPromptStaleError({
                    stageId,
                    hash,
                    message: `RECORDED_PROMPT_STALE: stage ${stageId} — prompt has changed since recording; re-record with INGESTION_TEST_RECORD=1. Expected hash ${hash} not present in ${filePath}.`,
                })
            }
            return {
                output: entry.response.output as T,
                tokenUsage: entry.response.tokenUsage,
                rawResponseId: entry.response.rawResponseId,
            }
        },
    }
}
