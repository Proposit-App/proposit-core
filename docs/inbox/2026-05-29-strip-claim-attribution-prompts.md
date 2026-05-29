# Strip attributive framing from ingestion claim prose (in-code LLM prompts)

## Context

Filed by the orchestrator on behalf of the human (2026-05-29). Argument
ingestion is producing claim text wrapped in an **attributive reporting
frame** — claims come out as *"The author claims that rain wets the
ground"* instead of the bare proposition *"Rain wets the ground"*. The
human confirmed the desired output form: **strip the attribution, keep
the existing third-person, present-tense, declarative voice.** This is
NOT a request to switch to first-person grammar — the bare proposition
stays third-person declarative; only the reporting wrapper is removed.

## Problem

The in-code prompts already instruct third-person declarative voice but
**no instruction forbids attributive framing**, so the model
spontaneously prepends reporting clauses ("The author claims…", "The
author argues…", "The author believes/contends/asserts…", "According to
the author…"). The fix is to add an explicit anti-attribution clause to
the claim-prose guidance: emit the proposition itself as a standalone
declarative sentence; never prepend a reporting/attributive frame
referring to "the author" / "the writer" / "the speaker".

### Currently-shipping path (primary)

`proposit-server` drives ingestion through `buildParsingPrompt` →
`CORE_PROMPT` in `src/lib/parsing/prompt-builder.ts`. The relevant
guidance is the "Writing Style" section (around lines 87-89):

```
## Writing Style
When formulating claims, write in third person, present tense, active
voice. Each claim should be a clear, standalone declarative sentence.
```

This already says third-person declarative — yet the output carries the
attribution wrapper, because nothing forbids it. **This is the highest-
priority edit: it is the prompt the server uses in production today.**

### v2 multi-stage pipeline (lockstep)

`src/extensions/argument-ingestion/stages/claim-canonicalization.ts:71`
carries the parallel style rule for the v2 pipeline:

```
- Claim titles + bodies are written in third-person, present-tense, active voice.
```

The v2 pipeline is not yet the server default (per the workspace ledger,
server adoption is downstream), but it must get the same anti-attribution
clause so the defect doesn't reappear when v2 becomes default. Also
review the citation title/body guidance (line 73) and the `axiom` prose
field guidance — citation claims summarizing a source ("NASA reports
temperature rise") are legitimately attributive *to the cited source*
and should NOT be flattened; only **author-attribution** of the user's
own claims is the target. Be careful to preserve the citation-claim
convention (title = "what the source asserts") while still removing
"the author cites…"-style wrappers.

## Desired behavior

For every in-code prompt that emits user-facing claim/proposition prose:

- **Do:** emit the proposition as a standalone third-person, present-
  tense, declarative sentence. *"Rain wets the ground."*
- **Don't:** prepend author-attributive frames — *"The author claims
  that…"*, *"The author argues…"*, *"The writer believes…"*,
  *"According to the author…"*, etc.
- **Preserve:** citation claims keep their "what the cited source
  asserts" framing (that attribution is to the external source, not the
  argument's author, and is intentional). Axiomatic claim `axiom` prose
  stays a bare self-evident proposition.

## Scope — audit EVERY in-code prompt (human's explicit request)

The human asked for a sweep of **all** LLM prompts defined in code, not
just the obvious claim emitters. Audit each ingestion-stage system
prompt (and any other in-code prompt) for author-attribution language in
the portions that shape **output prose**, and add the anti-attribution
clause where output prose is produced. Known files to start from
(non-exhaustive — confirm by grepping `src/` for `*_SYSTEM_PROMPT`,
`CORE_PROMPT`, and `buildPrompt`):

- `src/lib/parsing/prompt-builder.ts` — `CORE_PROMPT` (PRIMARY, active path)
- `src/extensions/argument-ingestion/stages/claim-canonicalization.ts`
- `src/extensions/argument-ingestion/stages/claim-type-classification.ts`
- `src/extensions/argument-ingestion/stages/claim-mention-extraction.ts`
- `src/extensions/argument-ingestion/stages/relation-extraction.ts`
- `src/extensions/argument-ingestion/stages/segmentation.ts`
- `src/extensions/argument-ingestion/stages/axiom-indicator-detection.ts`
- `src/extensions/argument-ingestion/stages/citation-source-detection.ts`
- `src/extensions/argument-ingestion/stages/conclusion-selection.ts`
- `src/extensions/argument-ingestion/stages/variable-assignment.ts`
- `src/extensions/argument-ingestion/stages/claim-reference-validation.ts`
- `src/extensions/argument-ingestion/v1-single-shot.ts`
- `src/extensions/argument-ingestion/v2-multi-stage.ts`
- `src/extensions/argument-ingestion/shared/finalize-response.ts` /
  `finalize-response-v2.ts`

**Distinguish two uses of "the author" in these prompts:**

1. **Model-instruction text** — e.g. "extract any span that asserts a
   proposition the author is making", "if the author doesn't argue from
   S to T, don't emit a relation". This is fine — it describes the input
   to the model and should be left alone.
2. **Output-prose guidance** — anything that governs the natural-language
   text the model writes into `title` / `body` / `axiom` (or the v1
   claim text). This is where the anti-attribution clause belongs.

Only category (2) needs editing. Do not strip "author" references from
category (1) — that would change extraction semantics.

## Out of scope (cannot fix in code)

`proposit-server` also invokes two OpenAI-**dashboard-hosted** prompts by
ID (`GPT_ARGUMENT_BUILDER_REVIEW_PROMPT_ID`,
`GPT_ARGUMENT_BUILDER_SIMULATE_USER_PROMPT_ID`, see
`src/services/tasks/executors/argument-build.ts`). These are not in code
and are not claim-transcription prompts (review / simulate-user
features), so they are out of scope for this change. The human will
adjust them in the OpenAI dashboard separately if needed.

## Test cases

LLM output is non-deterministic, so the load-bearing tests are
deterministic prompt-string assertions plus an opt-in live check:

1. **Deterministic (required):** for each edited prompt, assert the
   built/exported prompt string contains the anti-attribution clause
   (e.g. a substring test on `CORE_PROMPT` and on each `*_SYSTEM_PROMPT`,
   and on `buildParsingPrompt(BasicsParsingSchema)` output). This guards
   against regression if the prompt is later rewritten.
2. **Live LLM (opt-in, `RUN_LIVE_LLM_TESTS=1`):** feed a fixture input
   whose natural phrasing invites attribution (e.g. "I think rain wets
   the ground, and the author goes on to say clouds form from
   evaporation") and assert no produced claim `title`/`body` starts with
   an author-attributive frame (regex against a small banned-prefix
   list: `^(the author|the writer|the speaker|according to the
   author)\b` etc., case-insensitive). Keep the assertion lenient enough
   to avoid flakiness on legitimate citation titles.

Follow the repo's bug-repro convention: add the failing (or
prompt-assertion) test before editing the prompts.

## Impact on consumers

`@proposit/proposit-core`'s `buildParsingPrompt` is consumed by
`proposit-server` (active ingestion path). This is a behavioral change to
a published package, so it goes through the standard chain, coordinated
by the orchestrator:

1. Implement + dual-review here (`proposit-core-dev` →
   `proposit-core-reviewer`).
2. Patch bump (`pnpm version patch`), rotate `upcoming.md` release
   notes + changelog.
3. **Consumer-side validation** (orchestrator-dispatched): tarball
   (`pnpm pack`) → install into `proposit-server` → `pnpm run
   check:full` + a live ingestion smoke confirming claims no longer
   carry attribution wrappers.
4. Publish, then `proposit-server` bumps the `@proposit/proposit-core`
   dep and reverts the `file:` pin.

## Documentation sync

- `docs/release-notes/upcoming.md` — user-facing note: ingested claims
  no longer prefixed with "The author claims…".
- `docs/changelogs/upcoming.md` — developer changelog entry with commit
  range.
- `README.md` only if the ingestion/prompt behavior is documented there
  (check the Concepts/usage sections).
