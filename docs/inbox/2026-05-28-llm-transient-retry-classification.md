# Change request: classify `LLM_TRANSIENT_ERROR` as retryable in the default pipeline retry policy

**From:** `proposit-server`
**Date:** 2026-05-28
**Impact area:** `@proposit/proposit-core` pipeline framework + OpenAI extension — default retry-policy classification
**Current core version observed:** `1.4.0`

## Problem

The `relation-extraction` stage in the v2 ingestion pipeline fails terminally on the first attempt with a `LLM_TRANSIENT_ERROR`. Server-side diagnostic logging (added in `proposit-server` slice E, commit `dc681cb7`, `[ingestion][retry]` + `[ingestion][failed]` log lines in the executor bridge) confirms the framework does **not** emit `stage:retry` events for this error class — the failure propagates straight to `result.output === null` and the task settles as `PIPELINE_FAILED`.

### Reproduction (taskId `c4fde4ba-4b65-47ef-a0ca-abdc4be06d6f`, 2026-05-28)

Stage durations: created `2026-05-28T20:34:20Z`, settled FAILED `2026-05-28T20:48:37Z` → ~14 minutes. The relation-extraction OpenAI call hung and then surfaced `fetch failed` after a long network wait.

**Diagnostic logs captured (verbatim):**

```
[ingestion][failed] {
  taskId: 'c4fde4ba-4b65-47ef-a0ca-abdc4be06d6f',
  failures: [
    {
      stage: 'relation-extraction',
      code: 'LLM_TRANSIENT_ERROR',
      message: 'Network error calling OpenAI: fetch failed',
      severity: 'error'
    }
  ]
}
```

**NOTE:** zero `[ingestion][retry]` log lines fired for this stage before the failure — the retry pathway is the diagnostic discriminator and it was silent. The pipeline failed on attempt 1.

### Final task envelope

```json
{
    "id": "c4fde4ba-4b65-47ef-a0ca-abdc4be06d6f",
    "status": 3,
    "errorData": {
        "code": "PIPELINE_FAILED",
        "message": "[relation-extraction/LLM_TRANSIENT_ERROR] Network error calling OpenAI: fetch failed"
    },
    "completedOn": "2026-05-28T20:48:37.709Z"
}
```

## Root cause hypothesis

`LLM_TRANSIENT_ERROR` is **not** in the framework's default set of retryable error codes. The OpenAI extension wraps fetch-level failures (network errors, socket resets, connection timeouts) into this code, but the retry-policy classifier rejects it as terminal rather than transient.

A fetch failure IS by definition transient — the same call sequence frequently succeeds on the next attempt — so this looks like a classification gap rather than a policy decision.

## Proposed fix

Two options, in preference order:

1. **Add `LLM_TRANSIENT_ERROR` to the framework's default retryable error-code set.** Smallest blast radius — every consumer benefits automatically. Backoff defaults (existing policy) handle the timing.

2. **Expose a per-stage `retryableCodes: TErrorCode[]` configuration** that callers can pass via the extension's stage overrides. More flexibility but requires every consumer (proposit-server, future mobile, future SDK callers) to opt in.

Option 1 is strongly preferred — the consumer can't reasonably opt in to "retry network failures"; that should be the default.

## Test case

A unit test in `proposit-core` that:

1. Spins up a pipeline with a stage that throws `LLM_TRANSIENT_ERROR` on attempts 1 and 2, succeeds on attempt 3.
2. Asserts the pipeline succeeds (3 attempts taken total) instead of failing on attempt 1.
3. Asserts `stage:retry` events fire for attempts 1 → 2 and 2 → 3.

A second test asserting the existing retry policy's max-attempts boundary still works (a stage that throws `LLM_TRANSIENT_ERROR` indefinitely eventually settles as FAILED after `maxAttempts` retries, with `severity: "error"` failures recorded).

## Impact on `proposit-server`

Once shipped + published:

1. Bump the `@proposit/proposit-core` dependency.
2. The `relation-extraction` flakiness self-resolves — transient network failures get retried inside the framework and the user-facing import path stops emitting `PIPELINE_FAILED` for what should be a re-try-able blip.
3. No server-side code change needed.

The `[ingestion][retry]` and `[ingestion][failed]` diagnostic logs in `argument-create.ts` (slice E commit `dc681cb7`) stay in place — once retries fire, the operator log will surface the retry timing so we can confirm the fix is doing useful work and tune `maxAttempts` / backoff if the same failure persists.

## Workaround until upstream ships

None practical at the server layer — the retry classification lives inside the framework's error-code policy table and the server has no interception point. Users will continue to see occasional `PIPELINE_FAILED` results on imports until this lands.

## Tracking

- Server-side spec slice E: `proposit-server/docs/superpowers/specs/2026-05-28-pipeline-refinement-post-v0.17.2-design.md`
- Server-side plan slice E: `proposit-server/docs/superpowers/plans/2026-05-28-pipeline-refinement-slice-E-relation-extraction-investigation.md`
- Diagnostic log commit (server): `dc681cb7`
- Outcome branch chosen: **Branch A — classification gap**
