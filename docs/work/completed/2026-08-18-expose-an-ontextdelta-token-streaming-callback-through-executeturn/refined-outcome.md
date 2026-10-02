# Refined outcome: stream LLM text deltas to executeTurn and executePipeline callers

## Decision

**Accepted** on 2026-10-02 by the requester, on the maintainer's behalf, under the maintainer's standing rule that the requester decides what is easy to change later. Logged for the maintainer. Ships in 6.0.0, where the new `TPipelineEvent` member is listed as Breaking.

## Evidence

- A read-only verify assessment found all nine acceptance criteria met. It reproduced the outcome's red runs: the foreground id test before the fix, and the non-string guard, the abort guard and the nested-pipeline prefix each removed. It confirmed the delta wire shape by fetching OpenAI's "Responses streaming events" reference.
- It found one defect, fixed test first before acceptance: a function-tool loop on the default stream reported its first round's id mid-flight, disagreeing with `stage:llm-call` (`a1e09f58`). It also found three gaps:
  - G2, stale comments: fixed;
  - G1, text from earlier tool rounds streaming under the same attempt: documented;
  - G3, the id event not naming its mode: documented through the existing recovery caveat.
- `pnpm run check` passes at `54b6608a`: 2764 tests passed, 13 skipped.

## Not run

The live OpenAI suites (`RUN_LIVE_LLM_TESTS=1`, `provider-live.test.ts` and `provider-live-background-stream.test.ts`) were not run: there was no API key in this session. They are on the maintainer's pre-release list.

## Capability ledger and taxonomy

The ledger is empty, and no taxonomy entry changes (the spec's capability section).

## Follow-ups

None filed. Two possible later additions are both additive and are noted in `outcome.md`: marking tool-round boundaries in the delta stream, and an `onTextDelta` callback for `reconnectStream`.

## Closeout

Resolution `done`. Merged into `feat/response-arguments` for 6.0.0; not pushed or published by this session.
