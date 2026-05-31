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
// Scoped to `src/extensions/ollama/` — `src/lib/` never imports `undici`.

import type { TUndiciModule } from "./types.js"

type TUndiciImporter = () => Promise<TUndiciModule>

const defaultUndiciImporter: TUndiciImporter = () =>
    import("undici") as unknown as Promise<TUndiciModule>

/**
 * Build a `fetch`-shaped function backed by a per-instance undici `Agent`
 * whose `headersTimeout` and `bodyTimeout` are raised to `requestTimeoutMs`.
 *
 * Returns `undefined` when `requestTimeoutMs <= 0` (caller opted out) or
 * when the optional `undici` peer cannot be imported (graceful fallback to
 * the SDK's default fetch).
 *
 * @param requestTimeoutMs raised headers/body timeout in milliseconds
 * @param importUndici injectable importer (test seam); defaults to `import("undici")`
 * @param baseFetch the fetch to delegate to (test seam); defaults to global `fetch`
 */
export async function buildTimeoutFetch(
    requestTimeoutMs: number,
    importUndici: TUndiciImporter = defaultUndiciImporter,
    baseFetch: typeof fetch = fetch
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

    const timeoutFetch = ((
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
    ) =>
        baseFetch(input, {
            ...init,
            // `dispatcher` is an undici-specific RequestInit extension that
            // Node's global fetch honors; it is not in the lib.dom
            // RequestInit type, hence the structural widening.
            ...({ dispatcher: agent } as object),
        })) as typeof fetch

    return timeoutFetch
}
