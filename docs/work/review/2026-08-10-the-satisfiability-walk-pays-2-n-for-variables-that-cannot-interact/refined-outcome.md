# Refined outcome — accepted

Accepted by the user on 2026-08-10. `5431f0d..e892cc7`, four commits on `main`.

## The open question in `outcome.md` is now closed

The outcome recorded a real weakness: every fixture in `examples/arguments/` is
four or five variables, two of the four measurable ones do not decompose at all,
and the argument this work was written for — the one hitting the
10,000-assignment cap in `proposit-server` — is not in this repository. The
saving was proven correct and proven never-worse, but not proven to matter.

It was measured after acceptance was requested, in a browser, against the local
server. **Constructive Dilemma: The Innovator's Dilemma** — 4 premises, 11
claims, 23 variables in the snapshot — was driven through a full review to the
results stage and the exhaustive check run twice. Same argument, same saved
review, same client build; the only difference was which `@proposit/proposit-core`
was installed:

| Core | What the reader is told |
| --- | --- |
| published `4.0.0` | "The check stopped before it could finish, so nothing is settled either way — this argument is too large to search exhaustively." |
| this branch, via tarball | "Valid — no failing cases found." |

The check now finishes where it used to give up, on a real published argument.

Two limits on that claim, stated so it is not read as more than it is. It is
**one** argument, not a survey. And the mechanism is the enumeration falling
under the assignment cap — the conclusion-only-variable drop plus grouping — not
the per-group ceiling, which never came into play at this size. The
`SATISFIABILITY_VARIABLE_CEILING` change remains proven only by unit test.

## What the decision rested on

`pnpm run check` green: **2424 passed / 12 skipped across 92 files**, baseline
2408, the 16 new tests accounting for the difference exactly. No existing test
was edited — which matters more here than the count, because `evaluateArgument`
calls this on every evaluation, so 2408 pre-existing tests are the guard on the
hot path.

**The discriminating check is the reason to trust the suite.** Dropping the
`boundPremiseId` recursion from the closure — the plausible simplification —
fails exactly 2 tests out of 2436, both in this item's own file, and produces a
*wrong `true`*: a contradictory premise set reported satisfiable, which
un-suppresses derivation argument-wide. Nothing pre-existing catches it. The
forced-true breakage, by contrast, was already covered by an existing test. One
of the two risky halves had no guard at all before this item.

## Consumer validation

All three consumers were built against the core tarball before this closeout,
**verified by content rather than version** — the tarball is still stamped
`4.0.0`, so the version string proves nothing; `partitionIntoGroups` was grepped
out of each installed `node_modules`.

| Consumer | Result |
| --- | --- |
| `@proposit/shared` | 1202 passed |
| `proposit-server` | 3979 passed, production build compiled |
| `proposit-mobile` | 1169 passed, 0 lint errors |

All three pin `^4.0.0`, so `4.0.1` reaches them without a repin.

## Closeout choices

**Merge route.** Direct on `main`, no branch, no PR — one repo, four commits.

**Documentation.** Complete at implementation time; four Documentation Sync
entries fired as predicted, and `argument-engine.interfaces.ts` was re-checked
and correctly did not.

**Version.** `4.0.1`, cut after this item closes and covering both of today's
core items. `@proposit/shared` is deliberately **not** bumped: zero commits since
`v0.65.1` and an empty `upcoming.md`, so a bump would publish a byte-identical
package.

**Follow-ups.** None from this item. The citation sibling filed at the previous
item's closeout is unaffected.

## Observed during verification, not filed

`CLEAR REVIEW` in `proposit-server` does not clear the review. Used to tidy up
the test review, it confirmed through its dialog and re-rendered the panel, but
the `argumentReviews` row survived with all 4 claim assignments and 3 operator
assignments intact, across a reload. The test review was removed directly
instead and the argument left at zero reviews.

Left unfiled pending a judgment that belongs to the server node: "clear" may
mean the wizard draft rather than the record. Raised with the user rather than
buried here.
