---
from: .
initiative: 2026-06-22-public-engine-api-patchexpressionappfields-core-api-server-adoption
---

# Link existing patchExpressionAppFields item to epic; add public ArgumentEngine.patchExpressionAppFields + publish

**Core (producing) slice** of epic
`2026-06-22-public-engine-api-patchexpressionappfields-core-api-server-adoption`.

The full design already exists as the backlog item
`2026-06-21-public-engine-api-patchexpressionappfields-stop-reaching-into-engine-internals`
(proposed API, implementation sketch, and test cases in its `content.md`). On
processing this doc:

1. **Link, don't duplicate.** `tcw work edit
   2026-06-21-public-engine-api-patchexpressionappfields-stop-reaching-into-engine-internals
   --initiative 2026-06-22-public-engine-api-patchexpressionappfields-core-api-server-adoption`.
2. Implement `ArgumentEngine.patchExpressionAppFields(expressionId, fields)`
   per that item + the epic spec at
   `../docs/work/backlog/2026-06-22-public-engine-api-patchexpressionappfields-core-api-server-adoption/spec.md`
   (engine-level placement; patch-and-mark-dirty; throws on unknown id; 4 tests).
3. Update Public-Engine-API JSDoc + `docs/api-reference.md` +
   release-notes/changelog; prepare a **patch** release.
4. **Do not publish yet** — publish is gated on consumer-side validation (the
   server validates the candidate tarball first, per ORCHESTRATOR-AGENTS.md).
   Land code + docs + tests; the orchestrator runs the gate, then core publishes.

