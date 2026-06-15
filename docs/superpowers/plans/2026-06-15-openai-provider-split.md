# OpenAI Provider Module Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 1,589-line `src/extensions/openai/provider.ts` into focused, dependency-layered modules without changing public API or runtime behavior.

**Architecture:** Move already-pure top-level helpers out of `provider.ts` into `openai-parsing.ts`, `openai-http.ts`, `openai-tools.ts`, `openai-retrieval.ts`, and the existing `errors.ts`. The factory + `respond` closure stay in `provider.ts`. Layering is acyclic: `types`/`errors` ← `parsing` ← `http` ← `retrieval`/`provider`; `tools` depends only on `types`/`structured-output`. The public barrel (`index.ts`) is updated so the exported symbol set is byte-for-byte identical to consumers.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, pnpm. `brain-style` naming. Verify types with the TypeScript language server.

**Spec:** `docs/superpowers/specs/2026-06-15-openai-provider-split-design.md`

---

## Working notes for the executor

- **This is a move refactor.** Do not rewrite or "improve" any moved function body — cut and paste verbatim, then add the `export` keyword if the symbol is now consumed across a module boundary. Any logic change is out of scope.
- **The safety net is the existing suite**, not new tests. Write no new test files. The gate after every task is `pnpm run check` (typecheck + lint + test) passing.
- **The test suite must keep passing after every single commit.** Because each moved symbol is still imported by `provider.ts` (and siblings), every task leaves the build green on its own.
- **ESM rule:** every relative import you add must end in `.js` (e.g. `"./openai-parsing.js"`).
- **Symbol inventory** (current line ranges in `provider.ts`, for locating — line numbers drift as you cut, so locate by name):
  - parsing (≈1246–1493): `parseSseEvent`, `readSseEnvelope`, `pickFunctionCalls`, `extractAssistantText`, `safeParseJson`, `extractUsage`, `mergeUsage`, type `TParsedSseEvent`
  - classification (≈1179–1245): `classifyHttpError`, `formatIncompleteMessage`
  - tools (≈1494–1589): `translateTools`, `findFunctionHandler`, `deriveSchemaName`, `sanitizeName`, `canonicalJson`, `shortHash`
  - http (≈769–1228): `resolveFetch`, `fetchResponseEnvelope`, `envelopeToRetrievedResponse`, `parseJsonOrThrowTransient`, `abortError`, `abortableDelay`, `getResponseById`, `cancelBackground`, `isTerminalBackgroundStatus`, `runBackgroundStream`, `runBackground`, `callOnce`, `isAbortError`
  - retrieval (≈455–810): `retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse`, types `TResponseStatus`, `TRetrievedResponse`
- **Before each cut**, grep for the symbol to find every call site you must keep wired:
  `grep -rn "<symbol>" src/extensions/openai test/extensions/openai`

---

## Task 1: Extract response/SSE parsing → `openai-parsing.ts`

**Files:**
- Create: `src/extensions/openai/openai-parsing.ts`
- Modify: `src/extensions/openai/provider.ts` (remove the moved symbols; add an import)
- Test: `test/extensions/openai/` (existing — no edits expected)

- [ ] **Step 1: Inventory call sites**

Run: `grep -rn "parseSseEvent\|readSseEnvelope\|pickFunctionCalls\|extractAssistantText\|safeParseJson\|extractUsage\|mergeUsage\|TParsedSseEvent" src/extensions/openai test/extensions/openai`
Note every file that references these — those imports must resolve after the move.

- [ ] **Step 2: Create `openai-parsing.ts` and move the functions**

Cut the seven functions + the `TParsedSseEvent` type verbatim from `provider.ts` into the new file. Move any `import` lines they need (from `./types.js`, `./errors.js`, etc.) to the new file's header; keep the `.js` suffix. Add `export` to every symbol consumed elsewhere (at minimum `readSseEnvelope`, `extractAssistantText`, `pickFunctionCalls`, `extractUsage`, `mergeUsage`, `safeParseJson` — confirm against Step 1 grep). Keep truly-local helpers unexported.

- [ ] **Step 3: Re-wire `provider.ts`**

Add to `provider.ts` imports:

```ts
import {
    readSseEnvelope,
    extractAssistantText,
    pickFunctionCalls,
    extractUsage,
    mergeUsage,
    safeParseJson,
} from "./openai-parsing.js"
```

(Trim this list to exactly the symbols `provider.ts` still references per Step 1.)

- [ ] **Step 4: Run the gate**

Run: `pnpm run check`
Expected: PASS (typecheck clean, lint clean, all `test/extensions/openai/*` green). If lint flags formatting, run `pnpm run prettify` and re-check.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/openai/openai-parsing.ts src/extensions/openai/provider.ts
git commit -m "refactor(openai): extract SSE/response parsing to openai-parsing"
```

---

## Task 2: Move HTTP-error classification → `errors.ts`

**Files:**
- Modify: `src/extensions/openai/errors.ts` (add the two functions)
- Modify: `src/extensions/openai/provider.ts` (remove them; import them back)

- [ ] **Step 1: Inventory call sites**

Run: `grep -rn "classifyHttpError\|formatIncompleteMessage" src/extensions/openai test/extensions/openai`

- [ ] **Step 2: Move `classifyHttpError` + `formatIncompleteMessage` into `errors.ts`**

Cut both functions verbatim from `provider.ts` into `errors.ts` (below the error-class definitions, since they construct those classes). Add `export` to both. Ensure `errors.ts` imports anything they need (e.g. response-envelope types from `./types.js`). Confirm no import cycle: `errors.ts` must NOT import from `provider.ts`, `openai-http.ts`, or `openai-retrieval.ts`.

- [ ] **Step 3: Re-wire `provider.ts`**

Add the two names to the existing `import { ... } from "./errors.js"` line in `provider.ts`:

```ts
import {
    /* existing error-class imports … */
    classifyHttpError,
    formatIncompleteMessage,
} from "./errors.js"
```

- [ ] **Step 4: Run the gate**

Run: `pnpm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/openai/errors.ts src/extensions/openai/provider.ts
git commit -m "refactor(openai): move HTTP-error classification into errors module"
```

---

## Task 3: Extract tool translation + schema derivation → `openai-tools.ts`

**Files:**
- Create: `src/extensions/openai/openai-tools.ts`
- Modify: `src/extensions/openai/provider.ts`

- [ ] **Step 1: Inventory call sites**

Run: `grep -rn "translateTools\|findFunctionHandler\|deriveSchemaName\|sanitizeName\|canonicalJson\|shortHash" src/extensions/openai test/extensions/openai`

- [ ] **Step 2: Create `openai-tools.ts` and move the functions**

Cut `translateTools`, `findFunctionHandler`, `deriveSchemaName`, `sanitizeName`, `canonicalJson`, `shortHash` verbatim into the new file. Move their imports (tool/spec types from `./types.js`, `TSchema` from typebox, `typeboxToOpenAiSchema` from `./structured-output.js`). Export `translateTools` and `findFunctionHandler` (consumed by `provider.ts`); leave `sanitizeName`/`canonicalJson`/`shortHash`/`deriveSchemaName` unexported unless Step 1 shows external use.

- [ ] **Step 3: Re-wire `provider.ts`**

```ts
import { translateTools, findFunctionHandler } from "./openai-tools.js"
```

- [ ] **Step 4: Run the gate**

Run: `pnpm run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/openai/openai-tools.ts src/extensions/openai/provider.ts
git commit -m "refactor(openai): extract tool translation + schema derivation to openai-tools"
```

---

## Task 4: Extract HTTP transport → `openai-http.ts`

**Files:**
- Create: `src/extensions/openai/openai-http.ts`
- Modify: `src/extensions/openai/provider.ts`

- [ ] **Step 1: Inventory call sites**

Run: `grep -rn "resolveFetch\|fetchResponseEnvelope\|envelopeToRetrievedResponse\|parseJsonOrThrowTransient\|abortError\|abortableDelay\|getResponseById\|cancelBackground\|isTerminalBackgroundStatus\|runBackgroundStream\|runBackground\|callOnce\|isAbortError" src/extensions/openai test/extensions/openai`

Note: several of these are also called by the retrieval functions still in `provider.ts` (they move in Task 5). Exporting them now keeps both consumers wired.

- [ ] **Step 2: Create `openai-http.ts` and move the functions**

Cut the 13 HTTP-layer functions verbatim into the new file. Add imports at its header:

```ts
import { readSseEnvelope } from "./openai-parsing.js"
import { classifyHttpError } from "./errors.js"
```

(plus any error classes / `./types.js` types they construct or reference). Export every symbol that Step 1 shows is used by `provider.ts` or the retrieval functions — at minimum `callOnce`, `runBackground`, `runBackgroundStream`, `fetchResponseEnvelope`, `getResponseById`, `cancelBackground`, `resolveFetch`, `envelopeToRetrievedResponse`, `abortableDelay`. Keep `abortError`/`isAbortError`/`isTerminalBackgroundStatus`/`parseJsonOrThrowTransient` unexported if only used inside `openai-http.ts`.

- [ ] **Step 3: Re-wire `provider.ts`**

Import the subset `provider.ts` still uses (the `respond` closure calls `callOnce`, `runBackground`, `runBackgroundStream`):

```ts
import {
    callOnce,
    runBackground,
    runBackgroundStream,
} from "./openai-http.js"
```

(Add others if Step 1 shows `provider.ts` references them.)

- [ ] **Step 4: Run the gate**

Run: `pnpm run check`
Expected: PASS. Watch specifically for the background-stream / reconnect tests — they exercise `runBackgroundStream` and `readSseEnvelope` across the new boundary.

- [ ] **Step 5: Commit**

```bash
git add src/extensions/openai/openai-http.ts src/extensions/openai/provider.ts
git commit -m "refactor(openai): extract HTTP transport to openai-http"
```

---

## Task 5: Extract public retrieval API → `openai-retrieval.ts` + update barrel

**Files:**
- Create: `src/extensions/openai/openai-retrieval.ts`
- Modify: `src/extensions/openai/provider.ts`
- Modify: `src/extensions/openai/index.ts` (barrel)

- [ ] **Step 1: Inventory call sites**

Run: `grep -rn "retrieveResponse\|reconnectStream\|cancelResponse\|submitBackgroundResponse\|TResponseStatus\|TRetrievedResponse" src/extensions/openai test/extensions/openai`

- [ ] **Step 2: Create `openai-retrieval.ts` and move the functions + types**

Cut `retrieveResponse`, `reconnectStream`, `cancelResponse`, `submitBackgroundResponse` and the `TResponseStatus`, `TRetrievedResponse` types verbatim into the new file. Add its imports (from `openai-http.js`: `fetchResponseEnvelope`, `getResponseById`, `cancelBackground`, `resolveFetch`, `envelopeToRetrievedResponse`, `abortableDelay`; from `openai-parsing.js`: `readSseEnvelope`; error classes from `./errors.js`; `./types.js` types). Keep all four functions and both types `export`ed (they are public API).

- [ ] **Step 3: Update the barrel `index.ts`**

Change the retrieval re-export to source from the new module. The exported names must stay identical:

```ts
export { createOpenAiResponsesProvider } from "./provider.js"
export {
    retrieveResponse,
    reconnectStream,
    cancelResponse,
    submitBackgroundResponse,
} from "./openai-retrieval.js"
export type { TCreateOpenAiResponsesProviderOptions } from "./provider.js"
export type { TRetrievedResponse, TResponseStatus } from "./openai-retrieval.js"
```

(Leave the `errors.js`, `types.js`, and `structured-output.js` re-exports untouched.)

- [ ] **Step 4: Confirm `provider.ts` no longer needs to export the retrieval symbols**

If `provider.ts` had `export` on those four functions/two types, they are gone now. Verify `provider.ts` still compiles and only exports `createOpenAiResponsesProvider` + `TCreateOpenAiResponsesProviderOptions`.

- [ ] **Step 5: Run the gate**

Run: `pnpm run check`
Expected: PASS.

- [ ] **Step 6: Verify the public surface is unchanged**

Run: `pnpm run build && node -e "import('./dist/extensions/openai/index.js').then(m => console.log(Object.keys(m).sort().join('\n')))"`
Expected: the printed key set includes exactly `cancelResponse, createOpenAiResponsesProvider, reconnectStream, retrieveResponse, submitBackgroundResponse` plus the unchanged error classes and `typeboxToOpenAiSchema`. Compare against `git show HEAD~5:src/extensions/openai/index.ts` to confirm no symbol was dropped or added.

- [ ] **Step 7: Commit**

```bash
git add src/extensions/openai/openai-retrieval.ts src/extensions/openai/provider.ts src/extensions/openai/index.ts
git commit -m "refactor(openai): extract public retrieval API to openai-retrieval"
```

---

## Task 6: Final verification + line-count check

**Files:** none (verification only)

- [ ] **Step 1: Full check**

Run: `pnpm run check`
Expected: PASS.

- [ ] **Step 2: CLI smoke test**

Run: `pnpm run build && bash scripts/smoke-test.sh`
Expected: smoke test passes (confirms the extension still loads end-to-end).

- [ ] **Step 3: Confirm decomposition landed**

Run: `wc -l src/extensions/openai/*.ts`
Expected: `provider.ts` is now ~450 lines; `openai-http.ts`, `openai-parsing.ts`, `openai-tools.ts`, `openai-retrieval.ts` exist and are focused; no file regressed back over ~500 except by intent.

- [ ] **Step 4: Documentation Sync check**

Per CLAUDE.md, the OpenAI provider is not in the tracked-docs list, but add a changelog line: append to `docs/changelogs/upcoming.md` a `refactor(openai)` entry with the commit-hash range for this work. No release-notes entry needed (no user-facing change). Commit:

```bash
git add docs/changelogs/upcoming.md
git commit -m "docs(changelog): record openai provider module split"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** every module in the spec table maps to a task (parsing→T1, errors→T2, tools→T3, http→T4, retrieval+barrel→T5); public-API preservation verified in T5 step 6; verification gate in T6. ✓
- **Placeholder scan:** no TBD/TODO; the only "trim this list per grep" instructions are deliberate (exact import sets depend on the live grep, which each task runs first). ✓
- **Type/name consistency:** symbol names are taken verbatim from the current `provider.ts` inventory and reused identically across tasks. ✓
- **Ordering:** bottom-up by dependency layer, so every commit compiles and the suite stays green. ✓
