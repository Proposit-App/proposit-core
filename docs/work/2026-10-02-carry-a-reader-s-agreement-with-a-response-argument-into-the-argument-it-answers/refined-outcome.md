# Refined outcome: carry a reader's agreement with a response argument into the argument it answers

## Decision

**Accepted** on 2026-10-02 by the requester, on the maintainer's behalf, under the maintainer's standing rule that the requester decides what is easy to change later. Logged for the maintainer.

## Evidence

- A read-only verify assessment checked acceptance criteria 1-13 and found all of them met, apart from one case criterion 2 asks for that cannot be built (`outcome.md`).
- Six further probes found no wrong carried values:
  - a claim inside the expression and elsewhere in the argument;
  - a link inside a premise that is bound into another premise;
  - two links fixing one claim through different variables;
  - a target response whose links bind into a premise-bound expansion;
  - merging a response target's result while the reader also holds variables;
  - whether an axiom can be carried.
- Two problems it found were fixed before acceptance:
  - `pnpm run check` failed on unformatted taxonomy files (`ef8541c1`);
  - a claim that the lookup could not resolve was carried, and could make `evaluate` throw if it was an axiom. Such a link is now reported `unknownClaim` (`4c87202c`, test first).
- Three tests were strengthened, and the documentation completed (`f2bdb70c`).
- `pnpm run check` passes at `f2bdb70c`: 3031 tests passed, 13 skipped.
- The timing at the 16-claim limit (about 265 ms for 10 links) was accepted by the requester. It runs once per reader action, matching what the maintainer accepted for the checks.
- Development tarball 3 (sha256 `44303ae8…`) was built from `3600b672` and sent to the consumer.

## Capability ledger and taxonomy

The ledger is empty. The taxonomy gained `carried-value` and `answer-carrying` (`df781419`, formatted in `ef8541c1`).

## Follow-ups

- `2026-10-02-decide-whether-accepting-a-non-conditional-conclusion-root-is-the-reader-s-assertion`: blocked on the maintainer. Its outcome may let reinforces of non-conditional roots be carried later.
- `2026-10-02-let-a-reader-hold-a-whole-premise-true-or-false-during-evaluation`: would let `notExpressible` shapes be carried, in a later additive release.
- The combined 6.0.0 review, once the maintainer settles the release's scope.

## Closeout

Resolution `done`. The work stays on `feat/response-arguments` until 6.0.0 is ready, and is not pushed or published by this session.
