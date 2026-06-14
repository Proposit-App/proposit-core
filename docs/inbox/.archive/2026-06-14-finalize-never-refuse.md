# Change request: basics parse should never refuse a half-baked argument

## Problem

`finalizeFinalization` in proposit-server (`src/services/tasks/executors/argument-build.ts`)
throws "Argument finalization failed: <failureText>" whenever `BasicsArgumentParser.validate()`
returns a `failureText`. That `failureText` is produced by the LLM following `CORE_PROMPT`
(`src/lib/parsing/prompt-builder.ts`): "argument: … or null if the text cannot be parsed",
"If the input text cannot be reasonably interpreted as a propositional argument, set argument
to null and provide an explanation in failureText."

The Argument Builder must NOT refuse. A user is free to finalize a half-baked argument — even
just a conclusion with no supporting reasoning — and continue editing manually or publish it.
Completeness feedback will be delivered later by a separate proofreading feature, not by refusing
the finalize.

## Proposed change

Revise `CORE_PROMPT` so the basics parse always produces a best-effort structured argument:
extract whatever structure exists; a lone conclusion → a single conclusion premise/claim; do not
populate `failureText` for "not a well-formed argument". Reserve `argument: null` / `failureText`
for input with genuinely no extractable proposition (e.g. empty/garbage).

## Blast radius (please confirm acceptable)

`buildParsingPrompt(BasicsParsingSchema)` / `CORE_PROMPT` is shared by (a) the argument-builder
finalize, (b) the CLI `parse` command, and (c) the legacy v1-single-shot ingestion. The DEFAULT
v2 multi-stage ingestion has its OWN refusal logic (`finalize-response-v2`,
`FINALIZE_V2_FAILURE_TEXTS`) and is unaffected. If refusal must be preserved for some basics
consumer while relaxing the builder, an opt-in parameter is the alternative — but the requested
path is the prompt change.

## Test cases

- Conclusion-only text → non-null argument with a single conclusion; no failureText.
- A rambling "preferences and reflections" passage → best-effort argument; no failureText.
- Genuinely empty / non-propositional garbage → still allowed to fail.

## Consumer impact & adoption (proposit-server)

After a core release, proposit-server bumps the core dep. `finalizeFinalization` already calls
`parser.build(validated, { strict: false })` when `failureText` is null, so no server logic change
is expected beyond a regression test that a conclusion-only finalize succeeds.
