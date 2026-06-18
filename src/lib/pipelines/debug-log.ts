// Opt-in verbose debug logging for the pipeline framework + the
// OpenAI provider. Gated on the `PROPOSIT_PIPELINE_DEBUG` env var —
// when unset, every helper here is a zero-cost no-op (the gate is
// evaluated lazily per call, so toggling the env var mid-process is
// honored).
//
// **Why this module exists.** The v1.3.0 segmentation truncation
// regression took two rounds of reproduction with no actionable
// breadcrumbs in the logs — the framework's existing
// `stage:llm-call` event captures the right data on the event bus
// but consumers had to be wired up to surface it. This module gives
// devs a one-flag escape hatch: set the env var, re-run the
// failing pipeline, get structured per-call diagnostics on stderr
// without modifying any consumer code.
//
// **What it does NOT do.** It does not change any existing log
// emission, the public API, or stage outputs. Every emission is
// behind the env-var gate; when the gate is closed the helpers
// don't even touch the event payload. Heavy logger deps (winston,
// pino, etc.) are deliberately avoided — `console.debug` is the
// transport, prefixed lines are the structure.
//
// **Output shape.** Every line starts with the prefix
// `[proposit/pipeline]` so consumers can grep/filter. The next
// segment is the event kind (e.g. `[stage:start]`,
// `[llm:request]`); the remainder is a JSON-stringified record of
// the diagnostic fields. Sample:
//
//     [proposit/pipeline] [pipeline:start] {"pipelineId":"argument-ingestion-scholar","pipelineVersion":"1.0.0","stageCount":12,"rootStages":["segmentation"]}
//     [proposit/pipeline] [stage:start] {"stageId":"segmentation","deps":[]}
//     [proposit/pipeline] [llm:request] {"stageId":"segmentation","model":"gpt-5.4-mini","maxOutputTokens":8192,"systemPromptLen":876,"userMessageLen":15601,"systemPromptHead":"<!-- stage-id: segmentation -->\\nYou are the first stage of an argument-ingestion pipeline..."}
//     [proposit/pipeline] [llm:response] {"stageId":"segmentation","status":"completed","outputTextLen":4218,"tokenUsage":{"input":4012,"output":1056,"reasoning":0}}
//     [proposit/pipeline] [stage:end] {"stageId":"segmentation","status":"completed","durationMs":3127,"tokenUsage":{"input":4012,"output":1056,"reasoning":0}}

/** Env var that gates every emission. Public + namespaced. */
export const PROPOSIT_PIPELINE_DEBUG_ENV_VAR = "PROPOSIT_PIPELINE_DEBUG"

/** Line prefix on every emission; useful for grep/filter. */
export const PROPOSIT_PIPELINE_DEBUG_PREFIX = "[proposit/pipeline]"

/**
 * Truthy when the env var is set to `"1"`, `"true"`, or `"yes"`
 * (case-insensitive). Anything else is off — including `"0"`,
 * `"false"`, the empty string, and `undefined`.
 *
 * Re-read on every call so a consumer can flip the var mid-process.
 *
 * **Browser-safety.** `src/lib/` must not import or reference Node-
 * only globals (`process`, `Buffer`, `__dirname`, …) — this module
 * therefore reaches the env via a `globalThis` indirection guarded
 * by `typeof`. In a browser/Expo bundle the chain resolves to
 * `undefined` and the function returns `false`, leaving the gate
 * permanently closed for non-Node consumers (which is the right
 * outcome — debug logging is a Node-side dev affordance).
 */
export function isDebugEnabled(): boolean {
    const nodeProcess = (
        globalThis as {
            process?: { env?: Record<string, string | undefined> }
        }
    ).process
    const raw = nodeProcess?.env?.[PROPOSIT_PIPELINE_DEBUG_ENV_VAR]
    if (typeof raw !== "string") return false
    const v = raw.toLowerCase()
    return v === "1" || v === "true" || v === "yes"
}

/** Cap on prompt-head excerpts in `[llm:request]` emissions. */
const PROMPT_HEAD_BYTES = 200

/** Cap on raw-text dumps in `[llm:response]` (failure-branch) emissions. */
const RAW_OUTPUT_DUMP_BYTES = 2048

function head(value: string, capBytes: number): string {
    if (value.length <= capBytes) return value
    return value.slice(0, capBytes) + "…<truncated>"
}

/**
 * Internal emitter. Always goes through `console.debug` so consumers
 * that capture stderr (the Node default for `console.debug`) pick it
 * up automatically.
 */
function emit(eventKind: string, payload: Record<string, unknown>): void {
    // The payload is JSON-stringified rather than spread into the
    // console call so consumers see a single line per emission.
    // `console.debug` writes to stderr by default in Node.
    console.debug(
        `${PROPOSIT_PIPELINE_DEBUG_PREFIX} [${eventKind}] ${JSON.stringify(payload)}`
    )
}

// -- Public helpers ----------------------------------------------------

export function debugPipelineStart(args: {
    pipelineId: string
    pipelineVersion: string
    stageCount: number
    rootStages: readonly string[]
}): void {
    if (!isDebugEnabled()) return
    emit("pipeline:start", args)
}

export function debugPipelineEnd(args: {
    pipelineId: string
    status: "completed" | "failed"
    output: "present" | "null"
    durationMs: number
    tokenUsage?: { input: number; output: number; reasoning?: number }
}): void {
    if (!isDebugEnabled()) return
    emit("pipeline:end", args)
}

export function debugStageStart(args: {
    stageId: string
    deps: readonly string[]
}): void {
    if (!isDebugEnabled()) return
    emit("stage:start", args)
}

export function debugStageEnd(args: {
    stageId: string
    status: "completed" | "skipped" | "failed"
    durationMs: number
    outputPresence: "present" | "null-or-undefined"
    tokenUsage?: { input: number; output: number; reasoning?: number }
}): void {
    if (!isDebugEnabled()) return
    emit("stage:end", args)
}

export function debugLlmRequest(args: {
    stageId: string | null
    model: string
    maxOutputTokens?: number
    reasoningEffort?: string
    systemPromptLen: number
    userMessageLen: number
    systemPromptHead: string
    userMessageHead: string
}): void {
    if (!isDebugEnabled()) return
    emit("llm:request", {
        stageId: args.stageId,
        model: args.model,
        maxOutputTokens: args.maxOutputTokens,
        reasoningEffort: args.reasoningEffort,
        systemPromptLen: args.systemPromptLen,
        userMessageLen: args.userMessageLen,
        systemPromptHead: head(args.systemPromptHead, PROMPT_HEAD_BYTES),
        userMessageHead: head(args.userMessageHead, PROMPT_HEAD_BYTES),
    })
}

export function debugLlmResponse(args: {
    stageId: string | null
    status?: string
    incompleteReason?: string
    outputTextLen?: number
    tokenUsage: { input: number; output: number; reasoning?: number }
    rawResponseId?: string
}): void {
    if (!isDebugEnabled()) return
    emit("llm:response", args)
}

/**
 * Surfaces when the last-resort safety net truncates an over-long
 * field — i.e. the model overshot its declared `maxLength` and the
 * length steering (shrunk wire `maxLength` + budget hint) did not keep
 * it under the cap. Emits the field's JSON-pointer path, the limit, and
 * the original length (not the value) so a dev can see whether steering
 * is still letting overshoots through after it lands.
 */
export function debugMaxLengthTruncation(args: {
    stageId: string | null
    instancePath: string
    limit: number
    originalLength: number
}): void {
    if (!isDebugEnabled()) return
    emit("output:truncated", args)
}

/**
 * Failure-branch dump. Surfaces when the provider catches a thrown
 * error after the HTTP roundtrip (e.g. JSON parse failure on a
 * truncated payload). The `rawText` is capped to
 * `RAW_OUTPUT_DUMP_BYTES` to keep the line manageable while
 * preserving the head where the truncation usually shows up.
 */
export function debugLlmFailure(args: {
    stageId: string | null
    model: string
    errorName: string
    errorMessage: string
    status?: string
    incompleteReason?: string
    rawText?: string
    tokenUsage?: { input: number; output: number; reasoning?: number }
}): void {
    if (!isDebugEnabled()) return
    emit("llm:failure", {
        stageId: args.stageId,
        model: args.model,
        errorName: args.errorName,
        errorMessage: args.errorMessage,
        status: args.status,
        incompleteReason: args.incompleteReason,
        rawText:
            args.rawText !== undefined
                ? head(args.rawText, RAW_OUTPUT_DUMP_BYTES)
                : undefined,
        tokenUsage: args.tokenUsage,
    })
}
