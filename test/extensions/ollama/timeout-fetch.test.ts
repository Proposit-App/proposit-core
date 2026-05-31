// Unit tests for the per-provider timeout-fetch helper. The helper builds
// a custom `fetch` backed by a per-instance undici `Agent` with raised
// headers/body timeouts — never mutating global state. We inject a fake
// undici module so the test asserts the Agent options without a network
// call.

import { describe, it, expect } from "vitest"
import { buildTimeoutFetch } from "../../../src/extensions/ollama/timeout-fetch.js"
import type { TUndiciModule } from "../../../src/extensions/ollama/types.js"

function fakeUndici(captured: { options?: unknown }): TUndiciModule {
    return {
        Agent: class {
            constructor(options: unknown) {
                captured.options = options
            }
        },
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

    it("passes the agent to the underlying fetch as the `dispatcher` option", async () => {
        const captured: { options?: unknown } = {}
        let dispatcherSeen: unknown
        const fakeFetch = ((
            _input: unknown,
            init?: { dispatcher?: unknown }
        ) => {
            dispatcherSeen = init?.dispatcher
            return Promise.resolve(new Response("{}"))
        }) as unknown as typeof fetch
        const customFetch = await buildTimeoutFetch(
            5000,
            () => Promise.resolve(fakeUndici(captured)),
            fakeFetch
        )
        expect(customFetch).toBeTypeOf("function")
        await customFetch?.("http://localhost:11434/api/chat", {})
        expect(dispatcherSeen).toBeDefined()
    })
})
