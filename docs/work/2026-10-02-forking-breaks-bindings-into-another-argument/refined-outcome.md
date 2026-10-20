# Refined outcome: forking breaks bindings into another argument

## Decision

**Accepted** on 2026-10-02 by the requester, on the maintainer's behalf, under the maintainer's standing rule that the requester decides what is easy to change later. Logged for the maintainer.

The first verification ended in rework (`rework.md`). This acceptance is of the reworked item.

## Evidence

- The four sites in the spec are fixed in 5.4.3: forking (`fork.ts`), `getVariablesBoundToPremise`, the circularity check, and changeset ordering. Each new test was seen failing on the code from before the fix, with the message `outcome.md` records. The fix is intact on `feat/response-arguments`.
- Rework, on `feat/response-arguments`, shipping in 6.0.0:
  - `0d985319`: the fifth site, `wireEmptyBoundPremiseCheck`. It no longer warns `EXPR_BOUND_PREMISE_EMPTY` for a binding into another argument. Two tests failed first.
  - `5261f311`: criterion 1's internal half is pinned. A one-run mutation of `fork.ts` showed that only this test catches a lost version reset.
  - `109f3642` and `3ebbe462`: changelog, release notes and README.
- `pnpm run check` passes at `d1edb268`: 2946 tests passed, 13 skipped.

## Unconfirmed

Whether the consumer validated the 5.4.3 tarball before publication is **unconfirmed**. The only record is the consumer re-pinning after publication.

## Capability ledger

The ledger is empty (`tcw capabilities list` prints nothing). This bug fix changes no capability.

## Follow-ups

None. The rework leaves no deferred work.

## Closeout

Resolution `done`. The 5.4.3 part is already on `main`. The rework commits reach `main` with `feat/response-arguments` in 6.0.0.
