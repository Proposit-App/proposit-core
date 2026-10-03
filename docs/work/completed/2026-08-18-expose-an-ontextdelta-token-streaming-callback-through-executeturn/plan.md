# Plan — Expose LLM text deltas as a pipeline event

Seven tasks. Tasks 1–2 are the sibling fix, isolated first so it does not
entangle with the delta threading. Tasks 3–5 thread the signal bottom-up, each
leaving the suite green. Task 6 is the consumer-facing event, placed last among
the code tasks because it is the only one with a public-API surface and it
depends on every layer beneath it existing. Task 7 is the documentation block.

Run `pnpm run check` before each commit. The baseline is green (2514 passed, 14
skipped), so any red is this work.

---

## Task 1 — Pin the dropped foreground `onResponseId` (failing test first)

**Modifies:** `test/extensions/openai/provider.test.ts`

Add a test to the existing OpenAI provider suite, beside
`"fires onResponseCreated with the id MID-FLIGHT — before respond() resolves"`
(`:1783`), which builds a provider with **default** options — `stream` unset, so
foreground SSE per `src/extensions/openai/provider.ts:150` — and a mocked
`fetch` returning a stream of `response.created` then `response.completed`.
Assert `onResponseCreated` fires with the created event's id.

Model the fixture on the existing `sseResponse` helper (`:1093`); its
`{ type, response }` shape already covers `response.created`, so no helper
change is needed here.

**Proves:** the test **fails** on the unchanged tree. This was confirmed by a
throwaway probe during spec: the collector came back empty. Run it and read the
failure before writing Task 2. A test that passes here is measuring the wrong
thing.

**Commit:** the failing test is committed with Task 2, not on its own — the
suite must be green at every commit boundary.

## Task 2 — Pass `onResponseId` on the foreground streaming branch

**Modifies:** `src/extensions/openai/openai-http.ts`, `src/lib/llm/types.ts`

One argument. `openai-http.ts:80` reads `readSseEnvelope(response)`; make it
`readSseEnvelope(response, args.onResponseId)`, matching `runBackgroundStream`
at `:257`. The provider already passes `onResponseId: notifyResponseId` into
`fetchResponseEnvelope` (`provider.ts:246`), and `notifyResponseId`
(`provider.ts:195-201`) is already once-only guarded, so nothing else moves.

Reword the JSDoc on `TLlmRequest.onResponseCreated`
(`src/lib/llm/types.ts:53-59`), which currently says the OpenAI provider invokes
it "in background-stream mode" only. It now fires in any streaming mode —
foreground SSE included — and remains uncalled on the poll-only and synchronous
paths.

**Proves:** Task 1's test passes. `pnpm run check` green, in particular
`test/pipelines.test.ts:2956` (`buildLlmRequest` leaves `onResponseCreated`
unset) and the two existing mid-flight tests at
`test/extensions/openai/provider.test.ts:1783` and `:2083`, which are
background-stream and unaffected.

**Covers:** acceptance criterion 8.

## Task 3 — Confirm the delta wire shape, then teach the parser

**Modifies:** `src/extensions/openai/openai-parsing.ts`,
`test/extensions/openai/provider.test.ts`

**First, resolve the spec's one open assumption.** The spec records the delta
frame as event type `response.output_text.delta` with the chunk in a
**top-level** `delta` string field, and could not confirm it from this
environment (`developers.openai.com` is refused by the egress proxy). Confirm it
by one of:

- fetching `https://developers.openai.com/api/llms.txt` and following it to the
  Responses streaming reference, from an environment with egress; or
- running the opt-in live suite with
  `RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=sk-... pnpm exec vitest run test/extensions/openai/provider-live.test.ts`
  and reading an actual frame.

If `delta` turns out to be nested, only this task changes; Tasks 4–6 are
unaffected.

Then: add `{ kind: "delta"; text: string }` to the `TParsedSseEvent` union
(`:25-28`); widen the parsed-data type at `:56-61` to carry `delta?: string`;
add the match in `parseSseEvent` **after** the terminal (`:71-73`) and created
(`:74-76`) checks, so the hot ordering of the two existing families is
unchanged. Add a `readSseEnvelope` parameter for the delta callback beside
`onResponseId` (`:98-101`) and invoke it from `handleEvent` (`:113-125`) with
**no** once-only guard — unlike the id, deltas fire many times.

Widen the `sseResponse` test helper (`:1093`), whose events are typed
`{ type: string; response: unknown }`, so a frame can carry a top-level `delta`.

**Proves:** a new test asserting `readSseEnvelope` over a two-delta-plus-terminal
stream invokes the callback exactly twice, in frame order, and still returns the
terminal envelope. A second test asserting the same stream with **no** callback
returns the identical envelope and throws nothing.

**Covers:** acceptance criterion 1.

## Task 4 — Thread the callback through the HTTP transport

**Modifies:** `src/extensions/openai/openai-http.ts`

Add the optional delta callback to `fetchResponseEnvelope`'s args object
(`:40-51`) and pass it into `readSseEnvelope` on **both** streaming branches:
the foreground path at `:80` (now passing two callbacks after Task 2) and
`runBackgroundStream` at `:257`. `runBackground` (`:260-346`) and the
non-streaming fall-through at `:82-92` take no callback — neither holds a
stream.

**Proves:** `pnpm run check` green. No new behaviour is observable yet; nothing
supplies the callback. The task exists separately so the transport widening is
reviewable apart from the public-type change in Task 5.

**Covers:** no criterion of its own — it is the prerequisite Task 5's criteria 2
and 3 are asserted through. If it is skipped, those criteria cannot pass.

## Task 5 — Add `onTextDelta` to `TLlmRequest`

**Modifies:** `src/lib/llm/types.ts`, `src/extensions/openai/provider.ts`,
`test/extensions/openai/provider.test.ts`

Add `onTextDelta?: (text: string) => void` to `TLlmRequest` (`:37-78`), with
JSDoc stating: fired once per assistant-output-text chunk as it arrives; fired
zero times on non-streaming paths and by the chat-completions provider; **not**
accumulated by the provider; and fired again from the start on a retried attempt,
so a consumer accumulating text must key on the attempt.

In `provider.ts`, pass `req.onTextDelta` into the `fetchResponseEnvelope` call
(`:236-247`), beside `onResponseId: notifyResponseId` at `:246`. Pass it
directly — no wrapper. The once-only guard that `notifyResponseId` needs
(`:195-201`) is exactly what deltas must not have.

**Proves:** two tests in the provider suite. A default-options provider (so
foreground SSE) over a two-delta stream, called with `onTextDelta`, invokes it
twice in order, both invocations completing before `respond()` resolves — use
the gated-terminal pattern already established at `:1783`. The same fixture with
`onTextDelta` unset returns a `TLlmResponse` deep-equal to today's and throws
nothing.

**Covers:** acceptance criteria 2 and 3.

## Task 6 — Emit `stage:llm-text-delta`

**Modifies:** `src/lib/pipelines/types.ts`,
`src/lib/pipelines/llm-stage-helpers.ts`, `test/mocks/llm.ts`,
`test/pipelines.test.ts`, `test/conversation.test.ts`

Add the event to the `TPipelineEvent` union (`src/lib/pipelines/types.ts:122-207`),
placed between the `stage:llm-response-created` variant (`:164-182`) and
`stage:llm-call` (`:183-207`):

```ts
| {
      kind: "stage:llm-text-delta"
      stageId: string
      /** 1, 2, ... — the attempt these deltas belong to. */
      attempt: number
      /** One chunk of assistant output text, as the provider emitted it. */
      delta: string
      at: number
  }
```

In `runLlmStageAttempt` (`src/lib/pipelines/llm-stage-helpers.ts`), assign
`req.onTextDelta` at the same seam that already assigns `onResponseCreated`
(`:522-523`), closing over `cfg.id` and `attempt` and calling `ctx.emit`. No
dedupe flag — the `responseIdEmitted` pattern at `:506-509` is deliberately not
copied. `buildLlmRequest` (`:245`) continues to leave the field unset, for the
reason its JSDoc already gives at `:241-243`: the loop owns the per-attempt
binding.

Give the mock provider delta support: add an optional `deltas?: string[]` to the
`"ok"` and `"schema-invalid"` members of `TMockResponse`
(`test/mocks/llm.ts:38-45`), invoked via `req.onTextDelta` in `respond` before
the response resolves. Both members need it — the retry test in the proof below
uses a `schema-invalid` first attempt.

**Proves:** four tests.

- `test/pipelines.test.ts`, beside the existing
  `"llmStage — stage:llm-request event"` suite (`:1844`): a stage whose mock
  fires two deltas yields exactly two `stage:llm-text-delta` events carrying the
  stage's `stageId` and `attempt: 1`, ordered after `stage:llm-request` and
  before `stage:llm-call`.
- Same file: a stage whose first attempt is `schema-invalid` with deltas and
  whose second is `ok` with deltas yields delta events carrying `attempt: 1`
  then `attempt: 2`.
- Same file, `executePipeline` with an `onEvent` collector receives the events —
  the signal is not `executeTurn`-only.
- `test/conversation.test.ts`, in the `describe("executeTurn")` suite (`:75`):
  `executeTurn` with an `onEvent` collector and a delta-firing mock receives the
  events, and a turn aborted mid-stream via `deps.signal` receives none after
  the abort resolves while the stage still surfaces as `skipped`.

`turn.ts` is **not** in this task's file list and is not modified: `executeTurn`
already forwards `deps.onEvent` into `executeStage` (`:174`) and `ctx.emit` is
wired to it (`src/lib/pipelines/single-stage.ts:186`).

**Covers:** acceptance criteria 4, 5, 6 and 7.

## Task 7 — Documentation Sync

**Modifies:** `docs/api-reference.md`, `docs/release-notes/upcoming.md`,
`docs/changelogs/upcoming.md`

See the block below. One pass over the finished diff.

**Covers:** acceptance criterion 9 in full — `pnpm run check` green across
typecheck, prettier, eslint, the whole vitest suite, and the build.

---

## Documentation Sync

Every declared entry was evaluated. Three fire.

**Fires — `docs/api-reference.md` [Public-API].** Four edits:

- The `TPipelineEvent` row of the types table (`:1947`) lists the union members
  by `kind`; add `stage:llm-text-delta`.
- The `executeStage` per-stage event list (`:1888`) enumerates what it emits;
  add the new kind.
- Add per-event prose after the `stage:llm-response-created` paragraph
  (`:1960`), following the house pattern of the `stage:llm-request` paragraph at
  `:1958` — payload, since-version, ordering. State the retry rule outright: a
  retried attempt re-streams from the beginning, so a consumer accumulating text
  resets when `attempt` changes. Update the ordering line at `:1958` to
  `stage:start → stage:llm-request → [stage:llm-response-created] →
  stage:llm-text-delta* → stage:llm-call → stage:end`.
- Reword `:1960`'s "background+stream mode" claim about mid-flight id delivery,
  which Task 2 makes true of foreground streaming too. Keep the contrast with
  the poll-only and synchronous paths, which is unchanged.

**Fires — `docs/release-notes/upcoming.md` [Public-API].** Written for consumers
of the package: a new pipeline event carrying assistant text as it streams, what
it takes to observe it (an `onEvent` handler — no new dependency, no option),
the retry reset rule, and the modes where it does not fire (poll-only
background, launch/complete, chat-completions). Note the foreground mid-flight
id fix in the same entry, since it changes a documented guarantee.

**Fires — `docs/changelogs/upcoming.md` [Any-Code-Change].** Technical, grouped
by category. The new event and `TLlmRequest.onTextDelta` under added; the
foreground `onResponseId` fix under fixed.

**Does not fire, and why:**

- `README.md` and `README.md#invalid-constructions`, `CLI_EXAMPLES.md`,
  `scripts/smoke-test.sh` — all `[Public-CLI-API]` / `[Validation-Rules]`. No
  CLI command, flag or behaviour changes, and no validation rule moves. The
  README carries one incidental mention of the pipeline framework and documents
  no event.
- `AGENTS.md` `[Routing]` — its description scopes it to a **new**
  easy-to-violate invariant or a **new** canonical doc route. Neither appears:
  the delta-versus-id callback distinction is a local property of one function,
  documented at its declaration, and `docs/api-reference.md` is already the
  route for pipeline events.
- The four `*.interfaces.ts` entries, `proposit-core.ts`, `argument-library.ts`,
  `fork-library.ts`, `fork-namespace.ts` — all `[Public-Engine-API]` /
  `[Public-API]` for the argument engines and libraries. This work touches the
  pipeline and LLM layers only; no engine signature moves.
- `examples/arguments/*.yaml` `[Argument-Schema]` — no schema under
  `src/lib/schemata/` or `src/cli/schemata.ts` changes.

## Verification

What the suite cannot check, and what to do instead.

- **The real wire shape.** Every test in this plan uses a hand-built fixture, so
  the whole suite passes against a *wrong* shape — it would simply never fire.
  Task 3 gates on confirming the shape against OpenAI's reference or a live run
  before the fixtures are written. This is the one place where green means
  nothing on its own.
- **End-to-end against the live API.** After Task 6, run
  `RUN_LIVE_LLM_TESTS=1 OPENAI_API_KEY=sk-... pnpm exec vitest run test/extensions/openai/provider-live.test.ts test/extensions/openai/provider-live-background-stream.test.ts`
  and confirm deltas arrive from a real response and that the background-stream
  suite still passes with the foreground fix in place. Costs tokens; CI runs
  neither.
- **That the consumer can actually use it.** The point of the work is a
  consumer's streaming feature. Nothing in this repository proves the seam is
  usable from the consumer's call to `executeTurn`, which today passes only
  `{ llm }`. Confirm by writing the few lines that would go there against a
  tarball build before completing this item; do not adopt the consumer's work
  here.
- **Hot-path cost.** The added per-frame work is one string comparison plus, when
  opted in, one call. No benchmark exists in this repository and adding one is
  out of scope. Read the diff for accumulation or allocation in `handleEvent`
  instead — there should be neither.

## Notes

- Adding a member to `TPipelineEvent` is source-compatible for producers but
  breaks a consumer whose `switch` over `kind` is exhaustive with no `default`.
  That decides the release bump at cut time; it is not a design question and no
  task addresses it.
- No task is blocked by another work item, so nothing needs
  `tcw work edit --blocked-by`. The dependency runs the other way: the
  consumer's streaming item is blocked on this one.
