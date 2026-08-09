# Refined outcome — accepted

Accepted at the publish window for `@proposit/proposit-core` v4.0.0.

## Decision

Accepted as delivered. The spec's twelve acceptance criteria are each covered by
a named test, with AC-5 corrected in place (the criterion as written contradicted
itself; the correction and both readings are pinned by sibling tests). No scope
was added or dropped.

## Evidence

- `pnpm run check` on merged `main` (`c9cef18`): typecheck, prettier, eslint,
  **2401 passed / 12 skipped across 86 files**, build and typedoc clean.
- `bash scripts/smoke-test.sh` exit 0 against a fresh build (recorded in
  `outcome.md`).
- Merged to `main` fast-forward; `v4.0.0` tagged at the release commit.

## Deferred follow-ups

- **Struck-premise rendering** is a client question, not a core one. Covered by
  the consumer slices of the same initiative (shared review-flow semantics,
  server premise-header control row, mobile client parity), all closing in this
  same window.
- **`getVariableIdForClaim` returns one variable for a claim that binds several**
  — found while building the attribution map, escalated separately rather than
  folded in.

## Closeout

- No version cut of its own: v4.0.0 was cut by this item and later absorbed the
  contested-value work as well, since it was never published.
- Capabilities: none declared; `proposit-core` is a library node with no
  user-facing surface of its own.
