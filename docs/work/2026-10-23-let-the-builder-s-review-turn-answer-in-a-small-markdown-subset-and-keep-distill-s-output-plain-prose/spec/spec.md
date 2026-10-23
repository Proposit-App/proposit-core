# Spec

## Capability changes

None in the capabilities ledger: it records no builder capability (`tcw capabilities search builder` and `… search review` return nothing). The change is to two prompts' wording, with no change to any type, schema, export, or the CLI.

## Problem

The review turn's system prompt (`src/extensions/builder/review.ts:30-34`) says nothing about formatting. A consumer that renders replies as Markdown therefore gets whatever the model picks: possibly headings, code or tables it will not render, and the two or three questions as run-on prose rather than a list. Its last line, "Respond as a single message — do NOT attempt to parse or structure the argument. Just ask questions." (`review.ts:34`), can be read as discouraging any structure in the reply, a list included.

The distill turn's system prompt (`src/extensions/builder/distill.ts:76-98`) asks for "a single coherent prose passage" (`distill.ts:89`) but does not mention formatting. Once the review turn's replies, and users' own messages, carry Markdown, the model may carry that formatting into `argumentText`, which goes to the ingestion pipeline as plain text.

## Goals

1. The review turn's system prompt allows Markdown limited to bulleted lists, numbered lists, bold, italic, and paragraphs separated by blank lines; forbids headings, links, images, tables, block quotes, and code (inline or fenced); and asks for two or more questions as a numbered list, with a single question as a plain sentence.
2. The review prompt's "single message" line is reworded so that "structure" refers to the argument, not the reply.
3. The distill turn's system prompt tells the model to write plain prose with no Markdown or other formatting, even where the conversation uses it.

## Non-goals

- Any change to `src/extensions/builder/simulate.ts`.
- An option to turn the formatting on or off.
- Checking or stripping Markdown from either turn's output in code. These are prompt instructions; the model's compliance is not enforced.
- Any change to output schemas: the review reply stays in `uncategorizedText` of `ParsedArgumentResponseSchema`; distill stays `{ argumentText }`.

## Design

**Review prompt** (`review.ts`). The system prompt becomes:

> You are a Socratic reviewer helping to strengthen a propositional argument. Examine the user's argument below and ask probing questions that challenge its assumptions, evidence, and logical structure.
>
> Your goal is to help the user build a more rigorous, well-supported argument through guided questioning. Provide at most 2-3 focused questions per turn.
>
> Respond as a single message. Do not try to parse the argument or restate it in a structured form; just ask questions.
>
> You may format your reply with Markdown, limited to bulleted or numbered lists, \*\*bold\*\*, \*italic\*, and paragraphs separated by blank lines. Do not use headings, links, images, tables, block quotes, or code, inline or fenced. When you ask two or more questions, put them in a numbered list; a single question is a plain sentence.

The first two paragraphs are unchanged. The `**bold**` and `*italic*` markers are written literally in the prompt, so the model sees the syntax meant.

**Distill prompt** (`distill.ts`). One bullet is added to the `## Instructions` list, after the "single coherent prose passage" bullet:

> - Write plain prose with no Markdown or other formatting, even where the conversation uses it.

Nothing else in either file changes, apart from the review file's header and JSDoc if they describe the reply's form (they do not today: `review.ts:1-5, 12-18`).

**Tests** go in `test/conversation/conversation.test.ts`'s `builder turns` block. Each runs the turn through `executeTurn` with a provider that records `req.systemPrompt`, and checks the recorded prompt for the required sentences.

**Documentation.** `docs/changelogs/upcoming.md` and `docs/release-notes/upcoming.md` get an entry. No other documentation entry fires: `docs/api-reference.md` and the skill docs name the builder turns without describing their prompts (`skills/proposit-core/docs/pipelines.md:133`, `skills/proposit-core/SKILL.md:84`).

**Release.** 6.0.2, a patch.

## Acceptance criteria

1. The system prompt the review turn sends contains the sentence "You may format your reply with Markdown, limited to bulleted or numbered lists, \*\*bold\*\*, \*italic\*, and paragraphs separated by blank lines."
2. It contains "Do not use headings, links, images, tables, block quotes, or code, inline or fenced."
3. It contains "When you ask two or more questions, put them in a numbered list; a single question is a plain sentence."
4. It contains "Do not try to parse the argument or restate it in a structured form; just ask questions." and no longer contains "parse or structure the argument".
5. The system prompt the distill turn sends contains "Write plain prose with no Markdown or other formatting, even where the conversation uses it."
6. `git diff <base> -- src/extensions/builder/simulate.ts` is empty.
7. Criteria 1-5 are pinned by tests that fail on the code before the change.
8. `pnpm run check` passes.
9. `package.json` version is `6.0.2`.

## Risks

- The model may still use forbidden formatting or skip the numbered list; the prompt asks, nothing enforces. Accepted: the consumer renders only the subset and the request asks for prompt changes only.
- The simulate turn reads the reviewer's replies and may copy their Markdown into simulated user messages. Accepted by the requester: user messages may contain Markdown now, and distill is told to write plain prose.
- The distill instruction could in principle change distill's output where it was already plain; the instruction only restates what "prose passage" already asked, so the risk is low.
