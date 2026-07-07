# Outcome — proposit-core batched public-API exports + cleanup follow-ups

Verified against `proposit-core@2.4.3`. Every concrete deliverable shipped
incrementally across prior releases; no code change was required to close this
item. Evidence below.

## Deliverables

| Item | Status | Evidence |
|---|---|---|
| Export `isNakedQTree` / `isNakedQDerivationPremise` | ✅ Shipped | `src/lib/index.ts:111` |
| Export `isLlmStage()` predicate | ✅ Shipped | `src/lib/index.ts:139` (already recorded in request) |
| Surface TypeBox runtime values for `TProcessingFailure` + `TLlmTokenUsage` | ✅ Shipped | `ProcessingFailureSchema` (`index.ts:151`) + `LlmTokenUsageSchema` (`index.ts:172`) exported as runtime values; inferred types alongside |
| Fix four typedoc build warnings (`ExpressionManager`, `TOpenAiFetch`, `TPopulateResult`, `TClaimCreateInput`) | ✅ Clean | `pnpm run build` / `pnpm exec typedoc` emit zero warnings; tree stays clean |
| Dedup `openai` provider onto shared raw-`fetch` HTTP helper | ⏭️ Skipped (won't do) | See rationale |

## Dedup skip rationale

The request tagged this "fast-follow; gate on test coverage, else fast-follow
after." On inspection the two transports share almost nothing:

- `src/extensions/openai/openai-http.ts` — OpenAI **Responses** API: SSE
  streaming, foreground/background dispatch, submit-then-poll background loop,
  reconnect-stream.
- `src/extensions/chat-completions/http.ts` — a single synchronous POST to
  `/v1/chat/completions`, no SSE, no background, timeout via
  `AbortSignal.timeout`.

The only overlap is `resolveFetch` + error classification, both already small
and local. Forcing a shared helper would couple a streaming/background
transport to a synchronous one for a few lines of savings — a net loss in
clarity. Decision: **do not extract a shared helper.** Revisit only if a third
provider appears that genuinely shares the Responses-shaped wire interaction.

## Consumer follow-ups (out of scope, separate repos)

The exports above unblock consumers dropping local re-implementations; those
drops happen in the consumer repos, not here:

- `@proposit/shared` still carries a local `isNakedQDerivationPremise`
  re-impl (`src/engine/review/evaluation.ts:33`) that can now import the core
  export. Track in a `proposit-shared` item if desired.

## Capabilities / product delta

None. All changes are internal library public-API surface and dev-facing
typedoc — no user-facing capability change. tcw-capabilities gate: no-op.
