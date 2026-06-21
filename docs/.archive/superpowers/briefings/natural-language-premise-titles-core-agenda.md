# Natural-language premise titles — proposit-core agenda

## Capability changes

Cross-repo capability "Read premises titled in natural-language prose" is currently **Missing** (declared in the orchestration product layer and in `proposit-server`'s `raw_text` import `capabilities.md`). This core slice is the implementation that enables the flip to **Supported**; the flip itself happens server-side after consumer-validation. `proposit-core` is a library and carries NO `capabilities.md` — there is no caps file to edit in this repo.

## Goal

Premise titles produced by the ingestion extension must read as natural-language prose composed from the LLM-authored claim titles — mirroring how the argument title is already built — instead of serializing the compiled symbolic formula.

## Root cause (confirmed; verify line numbers, they may drift)

- `src/extensions/argument-ingestion/shared/finalize-response-v2.ts`, `buildPremiseTitle(formula, roleHint)` (~:120-137): prefixes the role (`Support:`/`Conclusion:`/`Joint support →`/`Derivation:`) and string-serializes `formula`, truncating at 50 chars.
- The happy path (~:251-257) builds `finalPremises` as `{ miniId, formula, title: buildPremiseTitle(p.formula, p.roleHint) }` over `compilation.premises`.
- `formula` is built in `src/extensions/argument-ingestion/shared/stages/formula-compilation.ts` (~:140-151) by joining variable SYMBOLS (e.g. `Hormuz_Too_Risky`, `No_Offramp`, or `Pnn` fallbacks) with operator words.
- The sibling `buildArgumentTitle(canonicalClaims, conclusionMiniId)` (~:139-154) reads naturally because it reuses the conclusion CLAIM's LLM-authored `title` (falling back to `axiom`, then `"Argument"`).
- The pure engine (`src/lib/`) is metadata-free — do NOT add titling there. All titling lives in this `extensions/argument-ingestion/` layer.

## Desired output

A support premise whose formula is `Hormuz_Too_Risky implies No_Offramp` should title as:
`If "Forcing Hormuz open is too risky" then "No realistic off-ramp exists"`

## Available data in `finalizeResponseV2` (verify exact shapes)

Within `finalizeResponseV2` you already have: `canon.canonicalClaims` (each with `miniId` + LLM-authored `title`/`axiom`), `variables` (the `variable-assignment` stage output — maps assigned symbol ↔ claim), and `compilation` (the `formula-compilation` output — `premises` with `formula` strings + `roleHint`). Build a symbol→claim-title map (symbol → claim `miniId` → claim `title`) and compose prose from the premise's logical structure. INVESTIGATE `formula-compilation.ts` to see whether each premise carries a structured expression tree (preferred — walk it) or only the formula string (then map symbols→quoted titles + operator-words→connectives). Walking structure is more robust than string-substitution; choose based on what the stage actually exposes, and justify the choice in your hand-back.

## Composition rules

- Substitute each variable with its bound claim's `title` (quoted), and render operators as natural-language connectives: `implies` → `If <ant> then <cons>`; `iff` → `<a> if and only if <b>`; `and` → `<a> and <b>`; `or` → `<a> or <b>`; `not` → `it is not the case that <x>` (or `not <x>` — your call, justify). Match the root-operator shape (e.g. root `implies` ⇒ `If … then …`).
- The machine `formula` field MUST remain byte-for-byte unchanged. ONLY `title` changes.
- Role prefix: the display layer renders a "Conclusion" chip separately, so a textual `Conclusion:`/`Support:` prefix on the prose title is likely redundant — propose DROPPING it; flag the decision for the reviewer/human-check. (If you keep any prefix, justify.)
- Truncation: the current 50-char cap is what mangled the output. Do NOT silently truncate readable prose. Prefer no cap; if a cap is genuinely needed, cap generously and on a word boundary.
- Defensive fallback: if a variable has no resolvable claim title (e.g. a `Pnn` symbol fallback), fall back to the symbol rather than throwing.

## Scope

- FORWARD-ONLY. No backfill of existing persisted arguments. No DB/migration concerns (that's a consumer concern and explicitly out of scope).
- Do NOT touch `src/lib/`. Do NOT change the `formula` field. Do NOT change `TParsedArgumentResponse`'s shape (server's `mapPremise` forwards `title` verbatim and must keep working).

## Method (rigid)

- FAILING TEST FIRST: add a test reproducing the formula-style titles for a representative multi-premise argument — at least one `support` (`implies`), one `joint-support` (`and`), and the `conclusion` — asserting the new prose output. Find where the existing v2-finalize / ingestion tests live and colocate appropriately. Then implement until green.
- The composition is deterministic over already-authored claim titles → NO live-LLM test needed for this slice (a live end-to-end import smoke runs later at the server validation gate).
- Keep the full suite green: `pnpm -C /Users/brian/Projects/Proposit-App/proposit-core run check` (typecheck + lint + test + build). ~1714 tests pass at v1.4.0 — keep them green and add coverage.
- Update `docs/changelogs/upcoming.md` (commit-hash range) and `docs/release-notes/upcoming.md` (plain-language, user-facing) per core's documentation-sync.

## Boundaries / hand-back

- Work ONLY on branch `premise-titles/prose-composition`. Implement + tests + docs. Then STOP — do NOT bump the version, do NOT merge to main, do NOT tag, do NOT publish. The orchestrator runs the `proposit-core-reviewer` dual-review + a human-check, then coordinates the `v1.5.0` version/merge/tag and the consumer-side tarball validation before the user publishes.
- Report back to the orchestrator (your final message): branch name + commit range; the failing-test→green trail; your prose-composition design decisions (structure-walk vs string-substitution, role-prefix drop/keep, truncation policy, operator connectives, not-handling); exact files touched; the `pnpm run check` result (paste the tail); and any deviations from this agenda for the reviewer to scrutinize.
