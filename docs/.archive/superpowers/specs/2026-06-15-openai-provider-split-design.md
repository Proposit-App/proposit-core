# Design: Split `src/extensions/openai/provider.ts` into focused modules

**Date:** 2026-06-15
**Type:** Internal refactor — no public API or behavior change.
**Origin:** First triaged worklist item in `docs/inbox/2026-06-15-lib-extensions-architecture-review.md`.

## Problem

`src/extensions/openai/provider.ts` is 1,589 lines. It holds the provider factory plus the full HTTP transport, SSE/envelope parsing, public retrieval API, tool translation, schema-name derivation, and HTTP-error classification. The factory + `respond` closure is the only part that captures config state; everything below it is already top-level functions taking explicit `args` objects, so the split is mechanical and low-risk.

## Module layout (all under `src/extensions/openai/`)

| File                        | Source range in provider.ts | Contents                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider.ts` (remains)     | 1–454                       | `createOpenAiResponsesProvider` factory + `respond` closure + `TCreateOpenAiResponsesProviderOptions`                                                                                                                                                                        |
| `openai-retrieval.ts` (new) | 455–810                     | `retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse`, `TResponseStatus`, `TRetrievedResponse`                                                                                                                                                 |
| `openai-http.ts` (new)      | 769–1228                    | `resolveFetch`, `fetchResponseEnvelope`, `envelopeToRetrievedResponse`, `parseJsonOrThrowTransient`, `abortError`, `abortableDelay`, `getResponseById`, `cancelBackground`, `isTerminalBackgroundStatus`, `runBackgroundStream`, `runBackground`, `callOnce`, `isAbortError` |
| `openai-parsing.ts` (new)   | 1246–1493                   | `parseSseEvent`, `readSseEnvelope`, `pickFunctionCalls`, `extractAssistantText`, `safeParseJson`, `extractUsage`, `mergeUsage`, `TParsedSseEvent`                                                                                                                            |
| `openai-tools.ts` (new)     | 1494–1589                   | `translateTools`, `findFunctionHandler`, `deriveSchemaName`, `sanitizeName`, `canonicalJson`, `shortHash`                                                                                                                                                                    |
| `errors.ts` (existing)      | 1179–1245                   | `classifyHttpError`, `formatIncompleteMessage` move in alongside the existing error classes                                                                                                                                                                                  |

(Ranges are approximate seams; the exact `resolveFetch`/`envelopeToRetrievedResponse` pair at 769–812 belongs with the HTTP layer even though it precedes the `-- HTTP --` banner.)

## Dependency layering (acyclic)

```
types.ts / errors.ts          (base: error classes + classification)
        ^
openai-parsing.ts             (SSE/envelope/usage parsing)
        ^
openai-http.ts                (transport; uses parsing + errors)
        ^
openai-retrieval.ts  +  provider.ts   (both depend on http + parsing)

openai-tools.ts               (depends only on types.ts + structured-output.ts)
```

No module imports `provider.ts`, so there is no cycle. `openai-http.ts` imports from `openai-parsing.ts` and `errors.ts`; `openai-retrieval.ts` imports from `openai-http.ts` and `openai-parsing.ts`; `provider.ts` imports from all of http/parsing/tools/errors.

## Public API preservation

The public surface is defined by `src/extensions/openai/index.ts` and the `./extensions/openai` subpath in `package.json`. Neither the subpath nor the exported symbol set changes:

- `createOpenAiResponsesProvider`, `TCreateOpenAiResponsesProviderOptions` — still re-exported from `./provider.js`.
- `retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse`, `TResponseStatus`, `TRetrievedResponse` — re-exported from `./openai-retrieval.js` instead of `./provider.js` (barrel updated; consumer-visible names unchanged).
- Error classes, `TOpenAiFetch`, `typeboxToOpenAiSchema`, `TOpenAiJsonSchema` — unchanged.

Consumers (`proposit-server`, the CLI) see an identical surface.

## Internal-export note

Functions currently file-private (`function foo()`) that are called across the new module boundaries gain an `export` keyword (e.g. `callOnce`, `readSseEnvelope`, `classifyHttpError`, `translateTools`, `extractUsage`). They are **not** added to the barrel, so they remain internal-by-convention rather than public API.

## Constraints

- All relative imports in moved code must end in `.js` (repo ESM rule).
- `src/extensions/` SDK-coupling boundary is unaffected — no new SDK imports; the optional `openai`/`undici` peer deps stay where they are.
- Naming follows the `brain-style` TypeScript sub-skill; verify types via the TypeScript language server.

## Verification

- `pnpm run check` (typecheck + lint + test) is the gate.
- The existing `test/extensions/openai/` suite — including background-stream + reconnect coverage — must stay green with no edits.
- No new tests: this is a behavior-preserving move. If any test imports a now-moved symbol directly (rather than via the barrel), update its import path only.

## Out of scope

- No logic changes, no signature changes, no new features.
- The `argument-engine.ts` / `premise-engine.ts` splits (deferred to `docs/inbox/2026-06-15-engine-class-decomposition.md`).
