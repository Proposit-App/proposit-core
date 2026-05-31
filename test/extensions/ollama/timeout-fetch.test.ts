// Unit tests for the per-provider timeout-fetch helper. The helper builds
// a custom `fetch` backed by a per-instance undici `Agent` with raised
// headers/body timeouts — never mutating global state. We inject a fake
// undici module so the test asserts the Agent options without a network
// call.

import { describe, it, expect } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { buildTimeoutFetch } from "../../../src/extensions/ollama/timeout-fetch.js"
import type { TUndiciModule } from "../../../src/extensions/ollama/types.js"

function fakeUndici(captured: { options?: unknown }): TUndiciModule {
    return {
        Agent: class {
            constructor(options: unknown) {
                captured.options = options
            }
        },
        // A passthrough fake `fetch`: records the dispatcher it was
        // handed and resolves a canned 200. Used by the deterministic
        // unit tests that don't make a real network call.
        fetch: ((_input: unknown, _init?: unknown) =>
            Promise.resolve(new Response("{}"))) as unknown as typeof fetch,
    }
}

/** Stand up a throwaway loopback HTTP server returning 200 `{"ok":true}`. */
async function startLoopbackServer(): Promise<{
    url: string
    close: () => Promise<void>
}> {
    const server = http.createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" })
        res.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    return {
        url: `http://127.0.0.1:${port.toString()}/`,
        close: () =>
            new Promise<void>((resolve, reject) =>
                server.close((err) => (err ? reject(err) : resolve()))
            ),
    }
}

describe("buildTimeoutFetch", () => {
    it("builds a fetch backed by an Agent whose headers/body timeouts equal requestTimeoutMs", async () => {
        const captured: { options?: unknown } = {}
        const result = await buildTimeoutFetch(1_200_000, () =>
            Promise.resolve(fakeUndici(captured))
        )
        expect(result).toBeTypeOf("function")
        expect(captured.options).toMatchObject({
            headersTimeout: 1_200_000,
            bodyTimeout: 1_200_000,
        })
    })

    it("returns undefined when requestTimeoutMs is 0 (caller wants the SDK default)", async () => {
        const captured: { options?: unknown } = {}
        const result = await buildTimeoutFetch(0, () =>
            Promise.resolve(fakeUndici(captured))
        )
        expect(result).toBeUndefined()
        expect(captured.options).toBeUndefined()
    })

    it("returns undefined (graceful degradation) when the undici import fails", async () => {
        const result = await buildTimeoutFetch(1_200_000, () =>
            Promise.reject(new Error("Cannot find package 'undici'"))
        )
        expect(result).toBeUndefined()
    })

    it("passes the agent to the undici module's OWN fetch as the `dispatcher` option", async () => {
        const captured: { options?: unknown } = {}
        const builtAgents: unknown[] = []
        let dispatcherSeen: unknown
        // The fake undici module's `fetch` records the dispatcher it was
        // handed — proving the wrapper delegates to `mod.fetch` (the
        // module's own fetch, paired with the module's own Agent) rather
        // than Node's global fetch. The Agent class pushes each built
        // instance into `builtAgents` so the test can assert same-instance
        // pairing without aliasing `this`.
        const mod: TUndiciModule = {
            Agent: class TFakeAgent {
                constructor(options: unknown) {
                    captured.options = options
                    builtAgents.push(this)
                }
            },
            fetch: ((_input: unknown, init?: { dispatcher?: unknown }) => {
                dispatcherSeen = init?.dispatcher
                return Promise.resolve(new Response("{}"))
            }) as unknown as typeof fetch,
        }
        const customFetch = await buildTimeoutFetch(5000, () =>
            Promise.resolve(mod)
        )
        expect(customFetch).toBeTypeOf("function")
        await customFetch?.("http://localhost:11434/api/chat", {})
        // The dispatcher seen by `mod.fetch` is the very Agent built from
        // `mod.Agent` — same-instance pairing, not a foreign dispatcher.
        expect(builtAgents).toHaveLength(1)
        expect(dispatcherSeen).toBe(builtAgents[0])
    })

    // Regression guard for the 1.6.1 dispatcher mismatch: the prior
    // implementation built the wrapper as `globalThis.fetch(input, {
    // dispatcher: agent })` where `agent` came from the separately-
    // installed `undici` package. Node's bundled-undici global fetch
    // REJECTS a foreign-undici Agent as a dispatcher with
    // `UND_ERR_INVALID_ARG` → `TypeError: fetch failed`, so EVERY real
    // request failed instantly. The earlier unit tests passed only
    // because they never fired a real request through the wrapper.
    //
    // This test exercises the wrapper against a real loopback server
    // using the REAL `undici` module (the default importer), so the
    // Agent and the base fetch must come from the same undici instance.
    // It MUST resolve 200 and MUST NOT throw `UND_ERR_INVALID_ARG`.
    it("makes a real request through the wrapper against a loopback server (200, no UND_ERR_INVALID_ARG)", async () => {
        const server = await startLoopbackServer()
        try {
            // Default importer → the real `undici` package. No baseFetch
            // override: the wrapper must source its base fetch from the
            // SAME undici module it took the Agent from.
            const customFetch = await buildTimeoutFetch(5000)
            expect(customFetch).toBeTypeOf("function")

            let response: Response
            try {
                response = await customFetch!(server.url)
            } catch (err) {
                const cause = (err as { cause?: { code?: unknown } }).cause
                throw new Error(
                    `wrapper fetch threw instead of resolving — cause.code=${String(
                        cause?.code
                    )}, message=${
                        err instanceof Error ? err.message : String(err)
                    }`
                )
            }

            expect(response.status).toBe(200)
            const body = (await response.json()) as { ok?: boolean }
            expect(body.ok).toBe(true)
        } finally {
            await server.close()
        }
    })
})
