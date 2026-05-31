# OllamaProvider Fetch-Timeout Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the v2 ingestion pipeline from dying at undici's 300s default when running against a local Ollama daemon, via (1) a generous per-provider request timeout and (2) classifying undici timeout cause-codes as transient.

**Architecture:** The `ollama` SDK's `Config` accepts a `fetch?` override. We build a per-instance custom `fetch` that routes through a per-provider undici `Agent` with raised `headersTimeout`/`bodyTimeout` — **no `setGlobalDispatcher`, no global mutation**. `undici` becomes a second optional `peerDependency` alongside `ollama` (the provider is dev/test-only and already requires installing `ollama`; pairing `undici` keeps the scoped, zero-prod-impact posture). When `undici` is absent we degrade gracefully (no custom dispatcher; SDK uses its default fetch); the classify fix is the safety net that catches the timeout regardless. All new code stays under `src/extensions/ollama/` — `src/lib/` keeps its zero-third-party-SDK boundary.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, the `ollama` SDK (optional peer), `undici` (new optional peer), TypeBox.

---

## File Structure

- **Create `src/extensions/ollama/timeout-fetch.ts`** — `buildTimeoutFetch(requestTimeoutMs)`: dynamically imports `undici`, builds a per-instance `Agent` with raised `headersTimeout`/`bodyTimeout`, returns a `fetch`-shaped function that injects the agent as `dispatcher`. Returns `undefined` when `undici` is unavailable or the timeout is `0`/unlimited-by-choice. Independently unit-testable via an injectable undici module.
- **Modify `src/extensions/ollama/types.ts`** — add `requestTimeoutMs?: number` to `TOllamaProviderConfig`; add a structural `TUndiciModule` / `TUndiciAgentCtor` type so `timeout-fetch.ts` doesn't pull the optional peer into the type graph.
- **Modify `src/extensions/ollama/provider.ts`** — wire `requestTimeoutMs` (default), call `buildTimeoutFetch` in `importAndConstructClient`, pass `{ host, fetch }` to `new mod.Ollama(...)`. Add a one-line doc note on the thinking-latency tradeoff (decision (a) — see below).
- **Modify `src/extensions/ollama/errors.ts`** — `classifyOllamaError`: map `.cause.code`/`.code` ∈ {`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_CONNECT_TIMEOUT`} → `TransientLlmError`.
- **Modify `src/extensions/ollama/index.ts`** — export `buildTimeoutFetch` only if it has external value; otherwise leave internal (decision: keep internal — not public surface).
- **Modify `package.json`** — add `undici` to `peerDependencies` + `peerDependenciesMeta` (optional), and to `devDependencies` (so tests + local can construct the Agent).
- **Test `test/extensions/ollama/errors.test.ts`** — three new undici-timeout classify cases.
- **Test `test/extensions/ollama/timeout-fetch.test.ts`** (create) — assert the helper applies the configured timeout to the constructed Agent.
- **Test `test/extensions/ollama/provider.test.ts`** — assert the default `requestTimeoutMs` and an override propagate to the fetch/agent construction (via injected undici module seam).
- **Docs:** `docs/changelogs/upcoming.md`, `docs/release-notes/upcoming.md`, `docs/api-reference.md` (Ollama subpath section), `CLAUDE.md` + `AGENTS.md` (Ollama bullet).

---

## Thinking-observation decision

**Decision (a): leave thinking untouched + add a one-line doc note on the latency tradeoff.** Rationale: a prior core finding showed `think: false` degrades structured-output fidelity (qwen drops the required object wrapper → bare array, fails `Value.Check`). The CR's primary, deterministic bug is the timeout; the thinking knob is a speed-only secondary observation. Exposing an opt-in knob (option b) adds public surface + a fidelity-footgun for a dev-only provider with no demonstrated caller demand. A doc note records the tradeoff without risking fidelity. (If the orchestrator/reviewer prefers option b, it is a small additive follow-up.)

---

## Dependency decision (undici)

`undici` is **not** installed in `proposit-core` and Node's bundled undici is **not** publicly importable (`node:undici` / bare `undici` both fail to resolve). To construct an `Agent` with raised timeouts we must import the real `undici` package. Decision: declare `undici` as a **second optional `peerDependency`** (mirroring `ollama`), dynamically imported inside `src/extensions/ollama/`. This:

- keeps the SDK-coupled-optional-peer pattern (matches the `lib/` vs `extensions/` dep split rule);
- keeps `src/lib/` free of `undici` (grep-proof boundary: `grep -r "undici" src/lib/` returns nothing);
- requires no production cost (the Ollama provider is dev/test-only; production stays on OpenAI which never touches this code);
- degrades safely: if a consumer installs `ollama` but not `undici`, the provider still works on the SDK's default fetch (300s) and the **classify fix retries** the timeout instead of failing non-retryable.

`undici` also goes in `devDependencies` so the repo's own tests + live runs get the raised timeout.

---

### Task 1: Classify undici timeout cause-codes as transient (deterministic, TDD red-first)

**Files:**

- Test: `test/extensions/ollama/errors.test.ts` (add cases to the existing `classifyOllamaError` describe block)
- Modify: `src/extensions/ollama/errors.ts:186` (the `ECONNRESET`/`ETIMEDOUT`/`EPIPE` branch region)

- [ ] **Step 1: Write the failing tests**

Add to the `describe("classifyOllamaError — failure-mode mapping", ...)` block in `test/extensions/ollama/errors.test.ts`:

```typescript
it("undici UND_ERR_HEADERS_TIMEOUT (direct code) → TransientLlmError (transient)", () => {
    const result = classifyOllamaError(
        errWith({ code: "UND_ERR_HEADERS_TIMEOUT" })
    )
    expect(result).toBeInstanceOf(TransientLlmError)
    expect((result as TransientLlmError).retryReason).toBe("transient")
    expect(result.code).toBe(LLM_TRANSIENT_ERROR)
})

it("undici UND_ERR_BODY_TIMEOUT (direct code) → TransientLlmError", () => {
    const result = classifyOllamaError(
        errWith({ code: "UND_ERR_BODY_TIMEOUT" })
    )
    expect(result).toBeInstanceOf(TransientLlmError)
    expect((result as TransientLlmError).retryReason).toBe("transient")
})

it("undici UND_ERR_CONNECT_TIMEOUT (direct code) → TransientLlmError", () => {
    const result = classifyOllamaError(
        errWith({ code: "UND_ERR_CONNECT_TIMEOUT" })
    )
    expect(result).toBeInstanceOf(TransientLlmError)
    expect((result as TransientLlmError).retryReason).toBe("transient")
})

it("a `fetch failed` wrapper whose .cause.code is UND_ERR_HEADERS_TIMEOUT → Transient (the real-world v2 fan-out failure)", () => {
    const cause = errWith({ code: "UND_ERR_HEADERS_TIMEOUT" })
    const wrapper = new Error("fetch failed") as Error & { cause?: unknown }
    wrapper.cause = cause
    const result = classifyOllamaError(wrapper)
    expect(result).toBeInstanceOf(TransientLlmError)
    expect((result as TransientLlmError).retryReason).toBe("transient")
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run test/extensions/ollama/errors.test.ts`
Expected: the four new cases FAIL — current code routes an unrecognized `UND_ERR_*` code to `NonRetryableLlmError` (the safe default), so `toBeInstanceOf(TransientLlmError)` fails.

- [ ] **Step 3: Implement the classification**

In `src/extensions/ollama/errors.ts`, replace the existing transient-connection branch:

```typescript
// Mid-stream socket drop / transient connection loss — retryable.
if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EPIPE") {
    return new TransientLlmError({
        message: `Transient connection error talking to the Ollama daemon (${code}): ${message}`,
    })
}
```

with (adds the undici timeout cause-codes alongside the bare-`ETIMEDOUT` path; both are transient):

```typescript
// Mid-stream socket drop / transient connection loss — retryable.
// Includes undici's timeout cause-codes: a long local thinking-model
// generation that outruns the dispatcher's headers/body timeout (or a
// connect timeout) is transient against a still-working daemon, NOT a
// deterministic failure. The framework's default `retryOn: ["transient"]`
// then retries instead of dying `LLM_NON_RETRYABLE_ERROR`.
if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "UND_ERR_HEADERS_TIMEOUT" ||
    code === "UND_ERR_BODY_TIMEOUT" ||
    code === "UND_ERR_CONNECT_TIMEOUT"
) {
    return new TransientLlmError({
        message: `Transient connection error talking to the Ollama daemon (${code}): ${message}`,
    })
}
```

Note: `nodeCodeOf` already probes one level of `.cause`, so the wrapper case is covered by the same `code` check.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run test/extensions/ollama/errors.test.ts`
Expected: PASS (all existing + four new).

- [ ] **Step 5: Commit**

```bash
git -C /Users/brian/Projects/Proposit-App/proposit-core add src/extensions/ollama/errors.ts test/extensions/ollama/errors.test.ts
git -C /Users/brian/Projects/Proposit-App/proposit-core commit -m "fix(ollama): classify undici timeout cause-codes as transient

UND_ERR_HEADERS_TIMEOUT / UND_ERR_BODY_TIMEOUT / UND_ERR_CONNECT_TIMEOUT
now map to TransientLlmError so the default retryOn:[\"transient\"] policy
retries instead of failing LLM_NON_RETRYABLE_ERROR. Fixes the v2 fan-out
dying at undici's 300s default on long local thinking-model stages."
```

---

### Task 2: `buildTimeoutFetch` helper + types

**Files:**

- Create: `src/extensions/ollama/timeout-fetch.ts`
- Modify: `src/extensions/ollama/types.ts` (add `requestTimeoutMs` + undici structural types)
- Test: `test/extensions/ollama/timeout-fetch.test.ts` (create)

- [ ] **Step 1: Add the undici structural types + `requestTimeoutMs` config field**

In `src/extensions/ollama/types.ts`, append a structural undici-module type (keeps the optional peer out of the type graph). The undici `Agent` constructor accepts `{ headersTimeout, bodyTimeout, connectTimeout }` (all ms). Add near the bottom, before `TOllamaProviderConfig`:

```typescript
/**
 * Structural slice of the `undici` module the timeout-fetch helper uses.
 * Modeled (not imported) so the optional `undici` peer stays out of the
 * type graph — same pattern as {@link TOllamaModule} for the `ollama` peer.
 */
/* eslint-disable @typescript-eslint/naming-convention */
export type TUndiciAgentOptions = {
    headersTimeout?: number
    bodyTimeout?: number
    connectTimeout?: number
}
export type TUndiciDispatcher = object
export type TUndiciModule = {
    Agent: new (options: TUndiciAgentOptions) => TUndiciDispatcher
}
/* eslint-enable @typescript-eslint/naming-convention */
```

Then add the `requestTimeoutMs` field to `TOllamaProviderConfig` (after `numCtx`, before `maxToolCallRounds`):

```typescript
    /**
     * Per-request HTTP timeout in milliseconds, applied via a
     * **per-provider** undici `Agent` (raised `headersTimeout` +
     * `bodyTimeout`) passed as the `ollama` SDK client's `fetch`
     * dispatcher. Defaults to **1_200_000 (20 min)** — local thinking
     * models legitimately take many minutes per structured-extraction
     * stage, and undici's 300s default aborts them mid-generation with a
     * `UND_ERR_HEADERS_TIMEOUT` `fetch failed`.
     *
     * **No global state is mutated** — the raised timeout is scoped to
     * this provider's client only (never `setGlobalDispatcher`). Requires
     * the optional `undici` peer; if it is not installed the provider
     * falls back to the SDK's default fetch (300s) and relies on
     * `classifyOllamaError` retrying the resulting timeout as transient.
     *
     * Set `0` to disable the custom dispatcher entirely (use the SDK
     * default). A finite positive value is recommended.
     */
    requestTimeoutMs?: number
```

- [ ] **Step 2: Write the failing test for `buildTimeoutFetch`**

Create `test/extensions/ollama/timeout-fetch.test.ts`:

```typescript
// Unit tests for the per-provider timeout-fetch helper. The helper builds
// a custom `fetch` backed by a per-instance undici `Agent` with raised
// headers/body timeouts — never mutating global state. We inject a fake
// undici module so the test asserts the Agent options without a network
// call.

import { describe, it, expect, vi } from "vitest"
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
        await customFetch!("http://localhost:11434/api/chat", {})
        expect(dispatcherSeen).toBeDefined()
    })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run test/extensions/ollama/timeout-fetch.test.ts`
Expected: FAIL — `buildTimeoutFetch` does not exist (import error / module not found).

- [ ] **Step 4: Implement `buildTimeoutFetch`**

Create `src/extensions/ollama/timeout-fetch.ts`:

```typescript
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
            // Node's global fetch honors; it is not in the lib.dom RequestInit
            // type, hence the structural widening.
            ...({ dispatcher: agent } as object),
        })) as typeof fetch

    return timeoutFetch
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run test/extensions/ollama/timeout-fetch.test.ts`
Expected: PASS (all four cases).

- [ ] **Step 6: Commit**

```bash
git -C /Users/brian/Projects/Proposit-App/proposit-core add src/extensions/ollama/timeout-fetch.ts src/extensions/ollama/types.ts test/extensions/ollama/timeout-fetch.test.ts
git -C /Users/brian/Projects/Proposit-App/proposit-core commit -m "feat(ollama): add per-provider buildTimeoutFetch (raised undici Agent timeouts)

A per-instance undici Agent with raised headers/body timeouts, passed as
the SDK client's fetch dispatcher — no global mutation. Adds
requestTimeoutMs to TOllamaProviderConfig (default 20 min) + structural
undici types so the optional peer stays out of the type graph."
```

---

### Task 3: Wire `requestTimeoutMs` into the provider

**Files:**

- Modify: `src/extensions/ollama/provider.ts`
- Test: `test/extensions/ollama/provider.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

The provider builds the timeout-fetch only on the real-import path (`importAndConstructClient`), which is bypassed when a `client` is injected. To test the wiring without a daemon, add an **injectable undici importer + Ollama module** seam to the provider config (test-only), mirroring the existing `client` seam. Add to `test/extensions/ollama/provider.test.ts`:

```typescript
describe("OllamaProvider — per-provider request timeout", () => {
    it("constructs the SDK client with a custom fetch backed by a default 20-min undici Agent", async () => {
        const capturedAgentOptions: { value?: unknown } = {}
        const capturedOllamaConfig: { value?: unknown } = {}

        const fakeUndici = {
            Agent: class {
                constructor(options: unknown) {
                    capturedAgentOptions.value = options
                }
            },
        }
        const fakeOllamaModule = {
            Ollama: class {
                constructor(config: unknown) {
                    capturedOllamaConfig.value = config
                }
                chat() {
                    return Promise.resolve({
                        message: {
                            role: "assistant",
                            content: '{"answer":"ok"}',
                        },
                        prompt_eval_count: 1,
                        eval_count: 1,
                    })
                }
                abort() {}
            },
        }

        const provider = new OllamaProvider({
            importUndici: () => Promise.resolve(fakeUndici),
            importOllama: () => Promise.resolve(fakeOllamaModule),
        })

        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })

        expect(capturedAgentOptions.value).toMatchObject({
            headersTimeout: 1_200_000,
            bodyTimeout: 1_200_000,
        })
        // The SDK client was constructed with a custom fetch.
        expect(
            (capturedOllamaConfig.value as { fetch?: unknown }).fetch
        ).toBeTypeOf("function")
    })

    it("honors an explicit requestTimeoutMs override on the Agent", async () => {
        const capturedAgentOptions: { value?: unknown } = {}
        const fakeUndici = {
            Agent: class {
                constructor(options: unknown) {
                    capturedAgentOptions.value = options
                }
            },
        }
        const fakeOllamaModule = {
            Ollama: class {
                constructor() {}
                chat() {
                    return Promise.resolve({
                        message: {
                            role: "assistant",
                            content: '{"answer":"ok"}',
                        },
                        prompt_eval_count: 1,
                        eval_count: 1,
                    })
                }
                abort() {}
            },
        }

        const provider = new OllamaProvider({
            requestTimeoutMs: 600_000,
            importUndici: () => Promise.resolve(fakeUndici),
            importOllama: () => Promise.resolve(fakeOllamaModule),
        })
        await provider.respond({
            model: "qwen3.6:latest",
            systemPrompt: "s",
            userMessage: "u",
            outputSchema: simpleSchema,
        })
        expect(capturedAgentOptions.value).toMatchObject({
            headersTimeout: 600_000,
            bodyTimeout: 600_000,
        })
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/extensions/ollama/provider.test.ts -t "per-provider request timeout"`
Expected: FAIL — `importUndici`/`importOllama` config fields don't exist; the provider's `importAndConstructClient` doesn't build a timeout fetch.

- [ ] **Step 3: Add the test-seam importer fields to `TOllamaProviderConfig`**

In `src/extensions/ollama/types.ts`, add to `TOllamaProviderConfig` (after `client`), the two injectable importers used by `importAndConstructClient`:

```typescript
    /**
     * Injectable `ollama`-module importer. Test seam — defaults to
     * `import("ollama")`. Lets tests assert the SDK client is constructed
     * with the timeout-fetch without touching the real package.
     */
    importOllama?: () => Promise<TOllamaModule>
    /**
     * Injectable `undici`-module importer. Test seam — defaults to
     * `import("undici")`. See {@link requestTimeoutMs}.
     */
    importUndici?: () => Promise<import("./types.js").TUndiciModule>
```

(If the self-referential `import("./types.js")` is awkward for the linter, use `TUndiciModule` directly since it's declared in the same file: `importUndici?: () => Promise<TUndiciModule>`.)

- [ ] **Step 4: Wire the timeout-fetch into `importAndConstructClient`**

In `src/extensions/ollama/provider.ts`:

1. Add imports + default constant + field:

```typescript
import { buildTimeoutFetch } from "./timeout-fetch.js"
```

```typescript
// Generous per-request timeout for local thinking models. undici's 300s
// default aborts long structured-extraction generations with
// UND_ERR_HEADERS_TIMEOUT; 20 min gives qwen3.6-with-thinking room. The
// timeout is applied via a PER-PROVIDER undici Agent (never global state)
// — see ./timeout-fetch.ts and TOllamaProviderConfig.requestTimeoutMs.
const DEFAULT_REQUEST_TIMEOUT_MS = 1_200_000
```

Add a field + constructor wiring:

```typescript
    private readonly requestTimeoutMs: number
```

```typescript
this.requestTimeoutMs =
    this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
```

2. Replace `importAndConstructClient`:

```typescript
    private async importAndConstructClient(): Promise<TOllamaClient> {
        const baseUrl = this.config.baseUrl ?? DEFAULT_BASE_URL
        const importOllama =
            this.config.importOllama ??
            (() => import("ollama") as unknown as Promise<TOllamaModule>)
        let mod: TOllamaModule
        try {
            mod = await importOllama()
        } catch (err) {
            throw new Error(
                "OllamaProvider: the optional `ollama` package is not installed. " +
                    "Run `pnpm add ollama` (it is declared as an optional peerDependency) " +
                    "or pass a pre-built `client` via the provider config. " +
                    `Original import error: ${
                        err instanceof Error ? err.message : String(err)
                    }`
            )
        }
        // Per-provider raised-timeout fetch (no global mutation). Falls
        // back to the SDK default fetch when undici is unavailable or the
        // caller set requestTimeoutMs to 0.
        const timeoutFetch = await buildTimeoutFetch(
            this.requestTimeoutMs,
            this.config.importUndici
        )
        const sdkConfig: { host: string; fetch?: typeof fetch } = {
            host: baseUrl,
        }
        if (timeoutFetch) {
            sdkConfig.fetch = timeoutFetch
        }
        return new mod.Ollama(sdkConfig)
    }
```

3. Update the `TOllamaModule.Ollama` constructor signature in `src/extensions/ollama/types.ts` to accept the optional `fetch`:

```typescript
export type TOllamaModule = {
    Ollama: new (config: {
        host: string
        fetch?: typeof fetch
    }) => TOllamaClient
}
```

4. Add the one-line thinking-latency doc note in the provider's top comment block (decision (a)). After the `reasoningEffort` bullet in the header comment, add:

```typescript
//   * Thinking is left ON (the SDK/model default) — a prior finding showed
//     `think: false` degrades structured-output fidelity (the model drops
//     the required object wrapper → bare array, failing Value.Check). This
//     trades latency (thinking-on stages can run several minutes) for
//     correctness; the generous requestTimeoutMs default accommodates it.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run test/extensions/ollama/provider.test.ts`
Expected: PASS (existing + new "per-provider request timeout" block).

- [ ] **Step 6: Commit**

```bash
git -C /Users/brian/Projects/Proposit-App/proposit-core add src/extensions/ollama/provider.ts src/extensions/ollama/types.ts test/extensions/ollama/provider.test.ts
git -C /Users/brian/Projects/Proposit-App/proposit-core commit -m "feat(ollama): apply per-provider requestTimeoutMs to the SDK client fetch

importAndConstructClient now builds a raised-timeout undici Agent (default
20 min) and passes it as the ollama SDK client's fetch — scoped per
provider, no global dispatcher mutation. Adds injectable import seams for
testing and a thinking-latency doc note."
```

---

### Task 4: package.json — undici optional peer + devDependency

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add undici to peerDependencies, peerDependenciesMeta, devDependencies**

In `package.json`:

- under `peerDependencies`, add `"undici": ">=6.0.0"` alongside `"ollama"`;
- under `peerDependenciesMeta`, add `"undici": { "optional": true }` alongside `"ollama"`;
- under `devDependencies`, add the installed undici (let pnpm pick the version).

Run (installs into devDeps + regenerates lockfile):

```bash
cd /Users/brian/Projects/Proposit-App/proposit-core && pnpm add -D undici
```

Then hand-edit `peerDependencies` + `peerDependenciesMeta` to add the optional `undici` entries (pnpm add -D only touches devDependencies).

- [ ] **Step 2: Verify undici now resolves + the Agent constructs**

Run: `cd /Users/brian/Projects/Proposit-App/proposit-core && node -e "const {Agent}=require('undici'); new Agent({headersTimeout:1000}); console.log('undici OK')"`
Expected: `undici OK`

- [ ] **Step 3: Commit**

```bash
git -C /Users/brian/Projects/Proposit-App/proposit-core add package.json pnpm-lock.yaml
git -C /Users/brian/Projects/Proposit-App/proposit-core commit -m "build(ollama): declare undici as an optional peer + devDependency

Mirrors the ollama optional-peer posture. undici is needed to construct the
per-provider raised-timeout Agent; dev/test-only, never a production cost
(production stays on the OpenAI provider)."
```

---

### Task 5: Documentation sync

**Files:**

- Modify: `docs/changelogs/upcoming.md`
- Modify: `docs/release-notes/upcoming.md`
- Modify: `docs/api-reference.md` (Ollama subpath section ~line 1559-1578)
- Modify: `CLAUDE.md` (Ollama bullet, line 133)
- Modify: `AGENTS.md` (Ollama bullet, line 133 — keep identical to CLAUDE.md)

- [ ] **Step 1: Changelog**

Append to the `## Docs`-less area of `docs/changelogs/upcoming.md` — add a `## Fixed` and `## Added` section above `## Docs`:

```markdown
## Fixed

- `src/extensions/ollama/errors.ts`: `classifyOllamaError` now maps undici timeout cause-codes (`UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_CONNECT_TIMEOUT`) — including when wrapped as a `fetch failed` `.cause.code` — to `TransientLlmError` (`retryReason: "transient"`). Previously these fell through to the `NonRetryableLlmError` default, so a long local-thinking-model generation that outran undici's 300s default killed the whole v2 ingestion run instead of retrying.

## Added

- `src/extensions/ollama/timeout-fetch.ts` + `TOllamaProviderConfig.requestTimeoutMs` (default 20 min): the `OllamaProvider` now applies a generous per-request HTTP timeout via a **per-provider** undici `Agent` (raised `headersTimeout`/`bodyTimeout`) passed as the `ollama` SDK client's `fetch` dispatcher — **no global state mutation** (no `setGlobalDispatcher`). `undici` is a new optional `peerDependency` (mirroring `ollama`); when absent the provider falls back to the SDK default fetch and the transient-timeout classification keeps the timeout retryable.
```

- [ ] **Step 2: Release notes**

Replace the body of `docs/release-notes/upcoming.md` with a user-facing entry:

```markdown
# Upcoming release notes

## Local Ollama: long thinking-model stages no longer fail at 5 minutes

Running the v2 ingestion pipeline against a local Ollama daemon (e.g. `qwen3.6:latest` with thinking on) could fail after exactly ~5 minutes with an "Unclassified Ollama error: fetch failed" — the whole run dying mid-way. That was the HTTP client's hidden 300-second default cutting off a generation that was still legitimately running.

Two fixes:

- The Ollama provider now sets a **generous 20-minute per-request timeout** (configurable via `requestTimeoutMs`), scoped to that provider only — local thinking models often need several minutes per stage.
- A timeout that does occur is now treated as **transient and retried**, instead of being mistaken for a permanent failure that aborts the run.

This makes local-Ollama development on real, non-trivial inputs reliable. Production is unaffected (it uses OpenAI).
```

- [ ] **Step 3: api-reference.md**

In the `### @proposit/proposit-core/extensions/ollama` section, update the `TOllamaProviderConfig` code block to include `requestTimeoutMs`, and add a paragraph documenting it + the transient-timeout classification. Change the config block (~line 1568):

```typescript
type TOllamaProviderConfig = {
    baseUrl?: string // daemon base URL, default http://localhost:11434
    client?: TOllamaClient // pre-built SDK client; primarily a test seam
    numCtx?: number // → options.num_ctx, default 32768
    requestTimeoutMs?: number // per-provider HTTP timeout, default 1_200_000 (20 min)
    maxToolCallRounds?: number // function-tool agent-loop cap, default 6
}
```

Add after the `numCtx` paragraph (before the **Error classes** paragraph):

```markdown
**`requestTimeoutMs` (default `1_200_000` = 20 min)** raises the HTTP client timeout for long local generations. Local thinking models (e.g. `qwen3.6` with thinking on) routinely take several minutes per structured-extraction stage; the underlying HTTP stack (undici) defaults to a 300s `headersTimeout`/`bodyTimeout` that would abort them mid-generation with a `UND_ERR_HEADERS_TIMEOUT` `fetch failed`. The provider applies the raised timeout via a **per-provider** undici `Agent` passed as the SDK client's `fetch` — it never calls `setGlobalDispatcher`, so no global state is mutated. This requires the optional `undici` peer (declared alongside `ollama`); if `undici` is not installed, the provider falls back to the SDK's default fetch and `classifyOllamaError` retries the resulting timeout (see below). Set `requestTimeoutMs: 0` to opt out of the custom dispatcher.

`classifyOllamaError` additionally maps undici's timeout cause-codes — `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `UND_ERR_CONNECT_TIMEOUT` (including when surfaced as a `fetch failed` `.cause.code`) — to `TransientLlmError`, so the framework's default `retryOn: ["transient"]` policy retries a timeout rather than failing it `LLM_NON_RETRYABLE_ERROR`.
```

Update the **Error classes** paragraph's `classifyOllamaError` sentence to mention the timeout cause-codes alongside `ECONNRESET`/cold-load: append ` Undici timeout cause-codes (\`UND_ERR_HEADERS_TIMEOUT\` / \`UND_ERR_BODY_TIMEOUT\` / \`UND_ERR_CONNECT_TIMEOUT\`) are also classified transient.` to that sentence.

- [ ] **Step 4: CLAUDE.md + AGENTS.md Ollama bullet**

In **both** `CLAUDE.md` and `AGENTS.md` (identical line 133 bullet), append to the end of the Ollama-provider bullet:

```markdown
**`requestTimeoutMs` knob (`TOllamaProviderConfig`, default 1_200_000 = 20 min) → per-provider undici `Agent` (`headersTimeout`/`bodyTimeout`) passed as the SDK client's `fetch`:** local thinking models outrun undici's 300s default; the raised timeout is **per-provider, never `setGlobalDispatcher`** (a library must not mutate global state). Lives in `src/extensions/ollama/timeout-fetch.ts`; `undici` is a second optional `peerDependency` (dynamically imported, scoped to `extensions/ollama/` — never `src/lib/`); when absent the provider degrades to the SDK default fetch. `classifyOllamaError` also maps undici timeout cause-codes (`UND_ERR_HEADERS_TIMEOUT`/`UND_ERR_BODY_TIMEOUT`/`UND_ERR_CONNECT_TIMEOUT`, including a wrapped `fetch failed` `.cause.code`) → `TransientLlmError` so the default `retryOn: ["transient"]` retries instead of dying `LLM_NON_RETRYABLE_ERROR`. Thinking is intentionally left ON (a prior finding showed `think: false` degrades structured-output fidelity) — the generous timeout accommodates the latency.
```

Make the two edits byte-identical.

- [ ] **Step 5: Prettify + commit docs**

```bash
cd /Users/brian/Projects/Proposit-App/proposit-core && pnpm prettify
git -C /Users/brian/Projects/Proposit-App/proposit-core add docs/changelogs/upcoming.md docs/release-notes/upcoming.md docs/api-reference.md CLAUDE.md AGENTS.md
git -C /Users/brian/Projects/Proposit-App/proposit-core commit -m "docs(ollama): document requestTimeoutMs + transient-timeout classification"
```

---

### Task 6: Archive the change-request + full check

**Files:**

- Move: `docs/inbox/2026-05-31-ollama-provider-fetch-timeout.md` → `docs/inbox/.archive/`

- [ ] **Step 1: Archive the CR**

```bash
mkdir -p /Users/brian/Projects/Proposit-App/proposit-core/docs/inbox/.archive
git -C /Users/brian/Projects/Proposit-App/proposit-core add docs/inbox/2026-05-31-ollama-provider-fetch-timeout.md
git -C /Users/brian/Projects/Proposit-App/proposit-core mv docs/inbox/2026-05-31-ollama-provider-fetch-timeout.md docs/inbox/.archive/2026-05-31-ollama-provider-fetch-timeout.md
```

(The file is currently untracked; `git add` it first so `git mv` tracks the move. If `git mv` on a freshly-added file is awkward, use a plain `mv` then `git add` both paths.)

- [ ] **Step 2: Run the full check gate**

Run: `pnpm -C /Users/brian/Projects/Proposit-App/proposit-core run check`
Expected: typecheck + lint + test + build all green. Note: `scripts/smoke-test.sh` step-5 is a known pre-existing failure unrelated to this work and is NOT part of `pnpm run check`.

- [ ] **Step 3: Commit the archive**

```bash
git -C /Users/brian/Projects/Proposit-App/proposit-core add docs/inbox/.archive/2026-05-31-ollama-provider-fetch-timeout.md
git -C /Users/brian/Projects/Proposit-App/proposit-core commit -m "docs(inbox): archive ollama-provider-fetch-timeout CR (implemented)"
```

---

## Self-Review

**Spec coverage:**

- MUST-fix 1 (configurable generous timeout, per-provider dispatcher, no global mutation, undici scoped to extensions, dependency decision) → Tasks 2, 3, 4. ✓
- MUST-fix 2 (classify undici timeout cause-codes transient, keep bare ETIMEDOUT) → Task 1 (ETIMEDOUT branch retained, UND*ERR*\* added). ✓
- Thinking observation (decision a — leave on + doc note) → Task 3 step 4. ✓
- TDD targets (classify cases red-first; provider applies configured/default timeout) → Tasks 1, 2, 3 each red-first. ✓
- Docs (changelog, release-notes, CLAUDE.md/AGENTS.md, api-reference) → Task 5. ✓
- CR archive → Task 6. ✓
- Boundaries: branch off main (done), no version-bump/tag/publish, keep check green → Task 6 step 2. ✓

**Type consistency:** `buildTimeoutFetch(requestTimeoutMs, importUndici?, baseFetch?)` signature consistent across Task 2 (def + tests) and Task 3 (call site passes `this.requestTimeoutMs, this.config.importUndici`). `TUndiciModule` defined in types.ts (Task 2) and consumed in timeout-fetch.ts + tests. `TOllamaModule.Ollama` constructor widened to accept `fetch?` (Task 3 step 3). `requestTimeoutMs`/`importUndici`/`importOllama` config fields all on `TOllamaProviderConfig`.

**Placeholder scan:** No TBDs; all code shown.
