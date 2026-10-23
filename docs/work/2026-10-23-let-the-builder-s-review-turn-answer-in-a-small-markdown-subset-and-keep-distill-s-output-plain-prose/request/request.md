# Request

## What and why

A consumer of the builder extension (`src/extensions/builder/`) is going to render the builder chat's messages as Markdown, and will let users format their own messages with it. Two of the builder's prompts need to change to match:

1. **Review turn** (`createReviewTurn`, `review.ts`). Its system prompt says nothing about formatting, so the model may use any Markdown or none. The consumer wants replies limited to a small subset: bulleted lists, numbered lists, **bold**, *italic*, and paragraphs separated by blank lines. No headings, links, images, tables, block quotes, or code, inline or fenced. When the reviewer asks two or more questions, they come as a numbered list; a single question stays a plain sentence. The existing line "Respond as a single message — do NOT attempt to parse or structure the argument. Just ask questions." is reworded so that "structure" plainly refers to the argument, not to the reply, and cannot be read as discouraging a list.
2. **Distill turn** (`createDistillTurn`, `distill.ts`). The conversation it reads may now contain that Markdown, in the user's messages and in the reviewer's replies. Its `argumentText` output feeds the ingestion pipeline and must stay plain prose, exactly as today.

## Product changes

- Changes: the review turn's reply may use the Markdown subset above, and puts two or more questions in a numbered list.
- Changes: the distill turn is told explicitly to write plain prose even when the conversation uses Markdown. Its output is meant to be unchanged.
- Adds or removes: none. No type, schema, or export changes; the review reply still lands in the structured output's `uncategorizedText` string.

## Out of scope

- The simulate turn (`simulate.ts`): unchanged, byte for byte.
- An option to switch the formatting on or off: the instructions are built into the prompts, since the builder has one consumer.
- Rendering or stripping Markdown anywhere in core.

## Constraints

- Released as 6.0.2, a patch (prompt behaviour only).
- Not published to npm directly: a tarball is validated against the consumer first.
- Commit, changelog and release-note wording must be public-safe.

## References

- Requester's comments on this item (2026-10-23): the agreed wording, the two later additions, and the acceptance list.
- asked; none provided beyond those.
