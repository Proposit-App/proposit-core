# Ingestion pipelines author premise titles

Epic: [Premise titles name the inference, not restate it](tcw://W/proposit-app/2026-08-04-premise-titles-name-the-inference-not-restate-it)

## Product changes

A premise's title is currently a lossless restatement of the rows a consumer
renders directly beneath it. Both Scribe and Scholar should instead emit a
short **noun phrase naming the inferential move**.

Claim titles are sentences asserting a proposition; premise titles are noun
phrases naming a move. That grammatical split is deliberate — it is what stops
a premise title from collapsing into a restatement of its consequent claim's
title, which is already the first row a consumer renders under the header.

```
before   If "The many are not authoritative" and "The many cannot do greatest evil" then "Zeal can be dangerous"
after    Limits of the crowd's power

before   Socrates must not escape                     (conclusion premise)
after    The case against escape
```

## Technical changes

### Root cause

`buildPremiseTitle` (`src/extensions/pipelines/base/finalize-response-v2.ts:479`)
composes the title deterministically: it walks the premise's source relation
and emits `If <and-joined antecedent claim titles> then <consequent claim
title>`. The conclusion premise has no source relation — it is synthesized from
a bare symbol — so it resolves that symbol to its claim title verbatim.

Both pipelines funnel through `finalizeResponseV2`, so both produce identical
titles. **No prompt generates these today**; the work is to add LLM authorship
where there currently is none.

### Proposed fix

Extend existing structured outputs rather than adding a stage. Costs **zero new
LLM calls** — roughly ten output tokens per relation.

1. **`src/extensions/pipelines/base/stages/schemas.ts:221`** — add
   `title: Type.String()` to each entry of `RelationExtractionOutputSchema`.
2. **`schemas.ts:246` + `:259`** — add `title: Type.String()` to
   `ConclusionSelectionLlmOutputSchema` and `ConclusionSelectionOutputSchema`,
   alongside the existing `rationale`.
3. **`base/stages/relation-extraction.ts`** — a prompt bullet for the per-relation
   title: noun phrase, names the move, not a sentence restating the consequent.
4. **`base/stages/conclusion-selection.ts`** — the same bullet for the
   conclusion premise's title.
5. **`ingestion/scribe/structure-stage.ts`** — Scribe's `structure` stage emits
   relations *and* conclusion candidates in one call, so it needs both bullets
   and both schema fields; its adapters republish into the same stage slots, so
   nothing downstream changes.
6. **`finalize-response-v2.ts:479`** — `buildPremiseTitle` prefers the authored
   title; today's composition stays as the fallback.

### Clamp in code, not in the schema

Trim and length-clamp the authored title where it is read. OpenAI's strict
structured-output mode does not enforce string `maxLength`, so the schema
cannot be the guard — prompt for brevity, then clamp. An over-long title must
be clamped, never rejected: a rejection throws away a paid pipeline run.

### Fallback

Compose as today when the authored title is missing, empty, or whitespace. That
branch also covers Scribe's degraded path, where `selectFallbackConclusion`
picks the conclusion from the relation graph and no model-authored title
exists for it.

### Accepted risk

Today's title cannot be wrong — it is derived from the formula. An authored
gloss can drift from the premise it labels, and it sits above the truth in the
reading order. Accepted knowingly at the epic level: the title is user-editable
before publish, which caps the damage.

## Consumer impact

`proposit-server` and `proposit-mobile` read `premise.title` through
`buildTextTree` and render it as a header above the premise's rows; several
other surfaces (search results, version diff, inspect sheets, the gear menu)
use it as the premise's name. No consumer code changes — the field's shape is
unchanged, only its content.

Additive schema change. Core **minor**.

## Test cases

- A relation carrying a `title` yields that title on the premise it produces.
- A relation with a missing / empty / whitespace-only `title` falls back to the
  `If … then …` composition, unchanged from today.
- The conclusion premise takes its title from `conclusion-selection`.
- The conclusion premise falls back to the conclusion claim's title when
  `selectFallbackConclusion` supplied the pick and no authored title exists.
- An over-long authored title is clamped, and the run still succeeds.
- Scribe and Scholar produce the same title-resolution behavior — they share
  `finalizeResponseV2`, so one fixture per pipeline through finalize is enough.

## Meta changes

- `docs/release-notes/upcoming.md` + `docs/changelogs/upcoming.md`.
- `docs/api-reference.md` if the stage output schemas are documented there.
