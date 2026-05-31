// Per-provider request-timeout fetch for the Ollama provider.
//
// Local thinking models (e.g. qwen3.6 with thinking on) legitimately take
// many minutes per structured-extraction stage; undici's 300s default
// `headersTimeout`/`bodyTimeout` aborts them mid-generation with a
// `TypeError: fetch failed` whose `.cause.code` is `UND_ERR_HEADERS_TIMEOUT`.
//
// This builds a custom `fetch` that routes through a **per-instance** undici
// `Agent` with raised timeouts, passed to the `ollama` SDK client as its
// `fetch`. It deliberately does NOT call `setGlobalDispatcher` — a library
// must not mutate global state. `undici` is an optional peer (same posture
// as `ollama`); when it is unavailable, this returns `undefined` and the
// provider falls back to the SDK's default fetch (the `classifyOllamaError`
// transient-timeout mapping then makes the resulting 300s timeout retryable
// rather than fatal).
//
// CRITICAL — pair the Agent with its OWN fetch. The raised-timeout `Agent`
// is constructed from the separately-installed `undici` package, so the
// `dispatcher` must be handed to *that same module's* `fetch` (`mod.fetch`),
// NOT to Node's bundled-undici global `fetch`. Node's global `fetch` rejects
// a foreign-undici `Agent` dispatcher with `UND_ERR_INVALID_ARG`
// (`TypeError: fetch failed`), which would make every Ollama request fail
// instantly when `undici` is installed. Never mix the two undici instances.
//
// Scoped to `src/extensions/ollama/` — `src/lib/` never imports `undici`.

import type { TUndiciModule } from "./types.js"

type TUndiciImporter = () => Promise<TUndiciModule>

const defaultUndiciImporter: TUndiciImporter = () =>
    import("undici") as unknown as Promise<TUndiciModule>

/**
 * Build a `fetch`-shaped function backed by a per-instance undici `Agent`
 * whose `headersTimeout` and `bodyTimeout` are raised to `requestTimeoutMs`.
 *
 * The returned wrapper delegates to **the imported undici module's own
 * `fetch`** (`mod.fetch`), passing the `Agent` as its `dispatcher`. The base
 * fetch and the dispatcher MUST come from the same undici instance — handing
 * this Agent to Node's bundled-undici global `fetch` is rejected with
 * `UND_ERR_INVALID_ARG`. See the file header.
 *
 * Returns `undefined` when `requestTimeoutMs <= 0` (caller opted out) or
 * when the optional `undici` peer cannot be imported (graceful fallback to
 * the SDK's default fetch — Node's global fetch with no dispatcher, which
 * works; the raised timeout is simply lost and `classifyOllamaError` maps
 * any resulting timeout to a retryable transient error).
 *
 * @param requestTimeoutMs raised headers/body timeout in milliseconds
 * @param importUndici injectable importer (test seam); defaults to `import("undici")`
 */
export async function buildTimeoutFetch(
    requestTimeoutMs: number,
    importUndici: TUndiciImporter = defaultUndiciImporter
): Promise<typeof fetch | undefined> {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
        return undefined
    }

    let mod: TUndiciModule
    try {
        mod = await importUndici()
    } catch {
        // undici not installed — degrade to the SDK default fetch. The
        // classify-timeout mapping keeps the resulting timeout retryable.
        return undefined
    }

    const agent = new mod.Agent({
        headersTimeout: requestTimeoutMs,
        bodyTimeout: requestTimeoutMs,
        connectTimeout: requestTimeoutMs,
    })

    // Pair the Agent with undici's OWN fetch — never Node's global fetch,
    // which rejects a foreign-undici Agent dispatcher.
    const undiciFetch = mod.fetch

    const timeoutFetch = ((
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
    ) =>
        undiciFetch(input, {
            ...init,
            // `dispatcher` is an undici-specific RequestInit extension that
            // undici's fetch honors; it is not in the lib.dom RequestInit
            // type, hence the structural widening.
            ...({ dispatcher: agent } as object),
        })) as typeof fetch

    return timeoutFetch
}
