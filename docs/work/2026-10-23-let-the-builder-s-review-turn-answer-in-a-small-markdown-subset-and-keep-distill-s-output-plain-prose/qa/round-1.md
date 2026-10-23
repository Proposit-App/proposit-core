---
verdict: accepted
judges: 1
---

# QA round 1

**Environment.** The QA plan names the consumer app, which is not part of this repository and does not yet render Markdown. The scenarios were run instead against the real model (`gpt-6-sol`, OpenAI Responses API) through the built 6.0.2 library (`dist/`, same source as the published tag). A short script used `createConversation`, `createReviewTurn` and `createDistillTurn`, exactly as a consumer calls them. Each reply below was printed as raw text, so every Markdown marker would be visible. This ran on 2026-10-23, after 6.0.2 had already been published; it should have run before.

Test argument: "Cities should ban cars from their downtown cores. Car traffic causes most of the air pollution downtown, and pollution harms residents' health. Pedestrian zones also increase foot traffic for local shops."

## 1. Reviewer formatting: passed

There were four review turns on the argument (three in separate conversations, one opening a chat) and one follow-up turn in the chat. Every reply used only a numbered list, and one used *italic* ("cause *most* downtown air pollution"). No headings, links, images, tables, block quotes or code appeared in any of them.

## 2. Reviewer questions: passed, with one case not observed

Each of the five replies asked two or three questions, and every one put them in a numbered list. No reply asked a single question, so the "a single question stays a plain sentence" case was not observed. That is a rule about a reply the model produced none of here. The prompt contains the instruction, and a test pins it.

## 3. Distilled text: passed

In the chat, the user's own reply used a numbered list, a bulleted item, **bold** and *italic*. The distill turn returned:

> Cities should ban cars from downtown cores because car traffic causes most downtown air pollution, according to the city's air-quality survey, and that pollution harms residents' health. Pedestrian zones increase foot traffic for local shops. The ban allows delivery vans before 10 a.m. and preserves permit access for residents with disabilities.

It is plain prose: no asterisks, list numbers or bullets. It also folds in the user's Markdown-formatted answers.

## Not tested

- The simulate turn, which is unchanged.
- How the consumer renders the Markdown, which is the consumer's own work.
- Whether the model complies across many runs. These are prompt instructions, not enforced.
