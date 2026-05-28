# Distinct `insufficient_quota` classification (vs. transient `LLM_RATE_LIMITED`)

**Date:** 2026-05-27
**Initiative:** Pipeline Refinement (Area 3 — global AI-budget breaker), slice **S-core**
**Requesting consumer:** `proposit-server` (slice S3 — global quota breaker)
**Target release:** `@proposit/proposit-core@1.4.0` (minor — additive to the public error vocabulary)
**Status:** PROPOSED — awaiting core-dev pickup. User has approved the core-change path (Decision B = B1) over a server-side substring match.

> Authored by `proposit-architect` for the Pipeline Refinement initiative. The server-side breaker that
> consumes this code is specified in `proposit-server/docs/superpowers/specs/2026-05-27-pipeline-refinement-quota-breaker-design.md` (S3).
> Per workspace `CLAUDE.md`: once core publishes `1.4.0`, every consumer (`proposit-server`; `proposit-shared`
> re-exports core types) tarball-validates before the publish is accepted.

---

## Capability changes

`@proposit/proposit-core` is a library — it carries **no** `capabilities.md` (per `capabilities-sdlc` file-locations). The user-facing capability this change _enables_ lives server-side and is documented in slice S3: `proposit-server/src/app/capabilities.md` (Global app shell) — _"AI features become unavailable when the platform AI budget is exhausted"_ (`Missing` → `Supported` when S3 lands). This change-request is the upstream library prerequisite for that capability; it introduces no user-facing surface of its own.

---

## Context

Server slice S3 (Pipeline Refinement, Area 3) builds a **global circuit breaker** that trips on OpenAI **persistent budget exhaustion** (`insufficient_quota`) — disabling AI affordances app-wide, returning `503` + `Retry-After: 24h` on AI routes, and aborting in-flight ingestion. This is **distinct** from a transient rate-limit (HTTP 429 throttling), which is a retryable, self-clearing condition that must **not** trip the breaker.

For the breaker to fire on the right signal, the server needs to reliably tell **persistent quota exhaustion** apart from a **transient rate-limit** at the point where an ingestion pipeline fails. Today it cannot: core collapses both into the identical failure envelope.

This change request was opened after a research pass (`proposit-core-researcher`, 2026-05-27) confirmed the collapse and located every relevant site (file:line below).

## Problem — `insufficient_quota` and transient 429 are indistinguishable in the failure envelope

OpenAI returns **both** transient throttling and persistent budget exhaustion as **HTTP 429**. They differ only in the response **body**: persistent exhaustion carries `{"error":{"type":"insufficient_quota","code":"insufficient_quota",...}}`, whereas transient throttling carries a rate-limit code (e.g. `rate_limit_exceeded`). Core routes purely on HTTP status and discards the body's structured fields.

### 1. The provider classifies on HTTP status alone

`src/extensions/openai/provider.ts:410-438` — `classifyHttpError(status, message)`:

```ts
function classifyHttpError(status: number, message: string): Error {
    if (status >= 500) {
        return new TransientLlmError({ message, status })
    }
    if (status === 429) {
        return new RateLimitLlmError({ message, status })
    } // ← 414-416: any 429
    if (status === 400) {
        return new NonRetryableLlmError({ message, status })
    }
    if (status === 422) {
        return new SchemaValidationLlmError({ message, status })
    }
    return new NonRetryableLlmError({ message, status })
}
```

The signature takes `(status, message)` — **the body is never inspected in structured form.** Every 429 becomes a `RateLimitLlmError`.

### 2. The distinguishing body text exists but is only concatenated into `message`, never parsed

`src/extensions/openai/provider.ts:403-407`:

```ts
const errorBody = await response.text().catch(() => "")
const message = `OpenAI Responses API ${response.status.toString()}: ${
    errorBody || response.statusText
}`
throw classifyHttpError(response.status, message)
```

`errorBody` (containing `insufficient_quota` for the quota case) is captured as **raw text** and concatenated into `message`. It is never `JSON.parse`d; `error.code` / `error.type` are never extracted. The provider uses raw `fetch` (no `openai` SDK error objects), so there is no SDK `APIError.code` either — just the body text.

### 3. The code mapping has no quota branch

`RateLimitLlmError` carries `retryReason = "rate_limit"` (`src/extensions/openai/errors.ts:44-53`). `classifyError` reads only that tag (`src/lib/pipelines/stage-helpers.ts:152-161`), and the code is assigned at `stage-helpers.ts:368-375`:

```ts
const reason = classifyError(err) // "rate_limit"
lastError = {
    reason,
    code: reason === "rate_limit" ? "LLM_RATE_LIMITED" : "LLM_TRANSIENT_ERROR", // ← 371
    message,
}
```

### 4. The envelope the server consumes loses everything but a substring

`LlmStageRetryExhaustedError` (`stage-helpers.ts:127-150`, fields `{ stageId, reason, code, attempts, message, failureContext }`) is converted to a `TProcessingFailure` at `src/lib/pipelines/execute.ts:433-440`:

```ts
if (err instanceof LlmStageRetryExhaustedError) {
    failures.push({
        stage: stage.id,
        code: err.code,            // "LLM_RATE_LIMITED" — identical for quota + transient
        message: err.message,      // "OpenAI Responses API 429: {...insufficient_quota...}"
        severity: "error",
        context: err.failureContext,   // undefined on the rate-limit path
    })
```

`TProcessingFailure` (`src/lib/pipelines/types.ts:102-108`):

```ts
export type TProcessingFailure = {
    stage: string
    code: string
    message: string
    severity: "warning" | "error"
    context?: Record<string, unknown>
}
```

**Net:** for a quota 429 the server receives `code: "LLM_RATE_LIMITED"` (identical to a transient 429), `context: undefined`, and the only quota signal is the unparsed substring inside `message`. The HTTP status (429) is dropped entirely (`RateLimitLlmError` has a `status` field at `errors.ts:45-46`, but it is never threaded onward). Matching `message.includes("insufficient_quota")` server-side is brittle: it depends on OpenAI's body wording staying stable and is asserted nowhere as a contract.

## Proposed change (in core)

Introduce a distinct, structured classification for `insufficient_quota` so the server matches a stable **code** rather than a substring. The change is **smaller than this CR's first draft implied** (confirmed by the core-reviewer dual-review, 2026-05-27): it is confined to the OpenAI extension (`provider.ts`, `errors.ts`) + the pipeline stage-helper layer (`stage-helpers.ts`: `classifyError`, the `TRetryReason` union, the code mapping) + a constant module and the public barrels. **`execute.ts` needs ZERO edits** (see item 4). Coordinated edits:

### 1. Parse the 429 body and extract the provider error code

`src/extensions/openai/provider.ts:403-407` — attempt a `JSON.parse` of `errorBody` and extract `error.code` / `error.type`, passing the discriminator into `classifyHttpError`:

```ts
const errorBody = await response.text().catch(() => "")
const message = `OpenAI Responses API ${response.status.toString()}: ${
    errorBody || response.statusText
}`
// Best-effort structured extraction; never throws on malformed bodies.
let providerErrorCode: string | undefined
try {
    const parsed = JSON.parse(errorBody) as {
        error?: { code?: string; type?: string }
    }
    providerErrorCode = parsed.error?.code ?? parsed.error?.type
} catch {
    providerErrorCode = undefined
}
throw classifyHttpError(response.status, message, providerErrorCode)
```

### 2. Add a `providerErrorCode` param + quota branch to `classifyHttpError`

`src/extensions/openai/provider.ts:410-438`:

```ts
function classifyHttpError(
    status: number,
    message: string,
    providerErrorCode?: string
): Error {
    if (status >= 500) {
        return new TransientLlmError({ message, status })
    }
    if (status === 429) {
        if (providerErrorCode === "insufficient_quota") {
            return new QuotaExhaustedLlmError({ message, status }) // ← NEW: persistent budget exhaustion
        }
        return new RateLimitLlmError({ message, status }) // transient throttle — unchanged
    }
    if (status === 400) {
        return new NonRetryableLlmError({ message, status })
    }
    if (status === 422) {
        return new SchemaValidationLlmError({ message, status })
    }
    return new NonRetryableLlmError({ message, status })
}
```

**Fallback discipline:** any 429 whose body is unparseable, or lacks `insufficient_quota`, stays `RateLimitLlmError`. The safe default is "transient + retryable," never a false quota trip.

### 3. New error class `QuotaExhaustedLlmError` (fail-fast via PATH B + `retryOn` exclusion)

`src/extensions/openai/errors.ts` — mirror `RateLimitLlmError`, carrying a distinct `retryReason` and an **optional** `status` (matches the sibling error family — see P2):

```ts
export class QuotaExhaustedLlmError extends Error {
    readonly retryReason = "quota_exhausted" as const
    readonly status?: number
    constructor({ message, status }: { message: string; status?: number }) {
        super(message)
        this.name = "QuotaExhaustedLlmError"
        this.status = status
    }
}
```

**Fail-fast is achieved via PATH B + `retryOn` exclusion — NOT by subclassing `NonRetryableLlmError`.** (Reviewer correction: `NonRetryableLlmError` flows **PATH A**, which hard-codes `code: "LLM_NON_RETRYABLE_ERROR"` — that would defeat the distinct-code goal.) The mechanism mirrors how `rate_limit` is already handled:

1. Extend `classifyError` (`src/lib/pipelines/stage-helpers.ts:152-161`; the mapping at `:157`) to recognize `QuotaExhaustedLlmError` → return `"quota_exhausted"`.
2. The reason flows through **PATH B** — the reason-specific code assignment at `:368-375` (item 4).
3. **Fail-fast:** `"quota_exhausted"` is **absent from `policy.retryOn`**, so the attempt loop hits the `break` at `stage-helpers.ts:376` on attempt 1 — no further attempts. (Same control flow any reason-not-in-`retryOn` already takes.) **Do NOT add `"quota_exhausted"` to any default `retryOn`.**

### 4. Add `"quota_exhausted"` to `TRetryReason` + map it to the distinct code (no `execute.ts` edits)

- **`TRetryReason` union (`stage-helpers.ts:40`) MUST gain `"quota_exhausted"`** — it is the type of `lastError.reason`, `LlmStageRetryExhaustedError.reason`, and `emitRetry`'s parameter; omitting it is a compile error. (Reviewer-added edit site — easy to miss.)
- Code assignment at `stage-helpers.ts:368-375` (PATH B):

```ts
code:
    reason === "quota_exhausted" ? LLM_QUOTA_EXHAUSTED :   // imported constant (item 5)
    reason === "rate_limit"      ? "LLM_RATE_LIMITED" :
                                   "LLM_TRANSIENT_ERROR",
```

- **`execute.ts` needs ZERO changes** (reviewer correction). There is exactly **one** terminal catch — `LlmStageRetryExhaustedError` (`execute.ts:433-447`). The fail-fast `break` from item 3 funnels through the unconditional throw at `stage-helpers.ts:392` into that same catch, which already copies `err.code` into `TProcessingFailure.code`. So `LLM_QUOTA_EXHAUSTED` propagates with no new branch. The earlier "BOTH terminal paths" language was wrong — **there is no second 'non-retryable' terminal branch; do not hunt for one.**
- Optionally also set `context: { httpStatus: 429, providerErrorCode: "insufficient_quota" }` as belt-and-suspenders, but the load-bearing contract is the `code`.

### 5. Export the code constant (SDK-free layer) + the error class (both barrels)

`TProcessingFailure.code` is bare `string` (`types.ts:102-108`), so the server otherwise hardcodes the literal. Two exports (reviewer-refined):

- **Code constant in the SDK-free layer.** Define `export const LLM_QUOTA_EXHAUSTED = "LLM_QUOTA_EXHAUSTED" as const` in a `src/lib/pipelines/` module (the SDK-free layer — so the server can import the constant without pulling in the OpenAI extension), re-export via `lib/pipelines/index.ts` → `lib/index.ts:131`. **Recommend exporting the sibling codes** (`LLM_RATE_LIMITED`, `LLM_TRANSIENT_ERROR`, …) as constants too, so `stage-helpers.ts` and consumers stop using bare string literals. The server (S3) imports `LLM_QUOTA_EXHAUSTED` from `@proposit/proposit-core`.
- **Export `QuotaExhaustedLlmError` from BOTH barrels** — `src/extensions/openai/index.ts` (the extension's public surface) **and** the re-export block at `src/lib/index.ts:165-170` (the documented public error family). This is documented public surface, not mechanical parity. (The `status?: number` shape in item 3 matches the sibling error family.)

## Test cases (in core, post-fix)

1. **Quota 429 → distinct code.** A mocked 429 response whose body is `{"error":{"type":"insufficient_quota","code":"insufficient_quota","message":"You exceeded your current quota"}}` classifies to `QuotaExhaustedLlmError`; the stage fails **fail-fast** (no retry attempts beyond the first — assert attempt count == 1); the resulting `TProcessingFailure.code === "LLM_QUOTA_EXHAUSTED"`.
2. **Transient 429 → unchanged.** A mocked 429 whose body is `{"error":{"code":"rate_limit_exceeded",...}}` (or any non-quota code) still classifies to `RateLimitLlmError`; retry behavior is unchanged (retries up to `maxAttempts`); the resulting code is `LLM_RATE_LIMITED`. (Regression guard — the existing transient path must not change.)
3. **Unparseable 429 body → safe default.** A mocked 429 whose body is non-JSON (`"<html>429 Too Many Requests</html>"`) or `""` falls back to `RateLimitLlmError` / `LLM_RATE_LIMITED` — never a false quota trip.
4. **429 with `{"error":{}}` (no code/type) → safe default.** Missing discriminator → `RateLimitLlmError`.
5. **Code constant export.** `import { LLM_QUOTA_EXHAUSTED } from "@proposit/proposit-core"` (via `lib/index.ts`) resolves and equals `"LLM_QUOTA_EXHAUSTED"`; `QuotaExhaustedLlmError` is importable from the same barrel.
6. **Quota stays non-retryable even when `rate_limit` IS retryable (P3).** With a stage policy of `retryOn: ["rate_limit"]`, a quota 429 still fails fast on attempt 1 (assert attempt count == 1) — proving fail-fast comes from `"quota_exhausted"`'s **absence from `retryOn`**, not from a hard-coded branch.
7. **Transient attempt-count pin (P3).** A transient 429 (rate-limit body) under the default policy retries the expected number of attempts (pin the count, e.g. `maxAttempts`) — regression guard that the new quota branch did not alter transient retry behavior.

These extend the existing OpenAI-provider + stage-helper classification tests; no quota fixtures exist today (grep-confirmed: 0 hits for `insufficient_quota`/`quota` across `src/` + `test/`), so they are net-new.

> **Reviewer false-positive (do NOT act on):** the qwen pass suggested a `|| "rate_limit"` fallback on the parsed `providerErrorCode`. Rejected — the `??`-chain on the already-read `errorBody` (item 1) is correct; a `|| "rate_limit"` would mis-default unparseable bodies toward a _reason_ rather than letting `classifyHttpError`'s 429-default (`RateLimitLlmError`) handle it. The existing safe-default discipline (items 1-2 + test 3/4) is correct as written.

## Impact on the server (slice S3)

- After core publishes `1.4.0` and the server bumps its dep, S3's breaker trip-detection reads `failure.code === LLM_QUOTA_EXHAUSTED` (imported constant) at the ingestion failure point in `src/services/tasks/executors/argument-create.ts` (the bridge that already inspects pipeline failures) → sets the durable breaker flag.
- No server-side substring matching of `failure.message` is needed; the brittle path (Decision B2) is avoided entirely.
- The transient `LLM_RATE_LIMITED` path is untouched, so existing retry behavior and any existing server handling of rate-limits are unaffected.

## Release shape + cross-repo coordination

- `@proposit/proposit-core@1.4.0` — minor. Additive: new `QuotaExhaustedLlmError` class + new `LLM_QUOTA_EXHAUSTED` code value + the constant exports. No change to existing `LLM_RATE_LIMITED` / `LLM_TRANSIENT_ERROR` behavior.
- **Edit surface (reviewer-confirmed, smaller than first draft):** `src/extensions/openai/provider.ts` (parse 429 body + `classifyHttpError` quota branch), `src/extensions/openai/errors.ts` (new class, `status?`), `src/extensions/openai/index.ts` (barrel export), `src/lib/pipelines/stage-helpers.ts` (`classifyError` :157, `TRetryReason` :40, code mapping :368-375), a `src/lib/pipelines/` constant module + `lib/pipelines/index.ts`, and `src/lib/index.ts` (re-exports :131 + :165-170). **`src/lib/pipelines/execute.ts` is NOT touched.**
- **Bundling note:** if the Area-2 retry research (in flight) determines core needs a single-stage re-execution capability, that core work bundles into this same `1.4.0` publish (the orchestrator is tracking this; a follow-up section will be appended here or a sibling change-request opened, per the orchestrator's call).
- **Consumer tarball-validation gate (workspace `CLAUDE.md`):** before `pnpm publish`, `proposit-server` (+ `proposit-shared` re-export check) install the `proposit-core-1.4.0.tgz` and run their full verification gate. The behavioral change (new classification) is exactly the kind of "touches code that runs in a consumer" change the gate exists for — do not skip it.

## References

- Overview: `proposit-orchestration/docs/superpowers/specs/2026-05-27-pipeline-refinement-overview.md` (Area 3).
- S3 server spec (consumer): `proposit-server/docs/superpowers/specs/2026-05-27-pipeline-refinement-quota-breaker-design.md`.
- Code anchors (current `main`): `src/extensions/openai/provider.ts:403-438`, `src/extensions/openai/errors.ts:44-53`, `src/lib/pipelines/stage-helpers.ts:127-161,368-375`, `src/lib/pipelines/execute.ts:433-440`, `src/lib/pipelines/types.ts:102-108`.
- Prior art for a core classification change shipped for the pipeline: `proposit-core@1.3.1` (segmentation truncation + per-reason incomplete classification).
