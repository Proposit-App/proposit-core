# Upcoming changelog

> **Working draft for `@proposit/proposit-core@1.0.0`.** Commit ranges
> below cover Phase A of the grammar-tiers/core branch. Phase B–F
> commits append before the publish commit renames this file to
> `v1.0.0.md`.

## Cross-repo dependencies

- Requires `@proposit/shared@^0.9.0` (the version introducing
  `/schemas/grammar` with `TGrammarTier`, `TGrammarRuleCode`, and
  `TViolation`).
- Downstream consumers (`proposit-server`, `proposit-mobile`) bump both
  `@proposit/shared` and `@proposit/proposit-core` deps in lockstep
  after 1.0.0 publishes.

## Cross-repo planning artifacts

- `docs/superpowers/briefings/grammar-tiers-core-agenda.md` — per-repo
  briefing (orchestrator-authored from the cross-repo design spec).
- `docs/superpowers/plans/grammar-tiers-core-plan.md` — implementation
  plan with bite-sized TDD steps for Phases A–F.

## Phase A — Scaffold (commits fe4ba5d…e99358b)

- `fe4ba5d` Add per-repo briefing and core implementation plan.
- `098e86e` Correct stale `@proposit/shared` version reference
  (`^0.3.0` → `^0.9.0`) in the plan. The briefing inherited an outdated
  baseline from the workspace-root CLAUDE.md (shared was actually at
  0.8.0, not 0.2.x). Orchestrator corrected the spec/briefing/workspace
  CLAUDE.md in parallel.
- `2d13032` Add local stubs for the shared wire-format types
  (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) in
  `src/lib/grammar/types.ts`. Phase B0 replaces the stub body with a
  re-export from `@proposit/shared/schemas/grammar`; the path is
  unchanged so downstream files don't need to rewrite imports.
- `5231fcd` Chore: apply prettier formatting to the briefing and plan.
- `27dda8e` Scaffold the `src/lib/grammar/` tree — `validators/context.ts`
  (pure-data `TValidatorContext` view), per-tier validator modules
  (`structural.ts`, `evaluable.ts`, `derivable.ts`, `presentable.ts`,
  each with one stub function per rule returning `[]`), and the
  top-level `validate.ts` dispatcher implementing the spec §7.1
  four-case union. Codes `E-2` and `D-7` are intentionally reserved
  (commented, no stub).
- `404dec4` Scaffold the new `docs/Proposit_Grammar.md` (initially as
  `Proposit_Grammar.draft.md`) with the spec §11 ToC; preserve the
  formula-string parser grammar from the pre-1.0 doc in §1.
- `e99358b` Scaffold per-rule test files with `it.todo` entries for
  every Structural/Evaluable/Derivable/Presentable rule and the
  dispatcher — 110 todos register; 1395 baseline tests preserved.

## Phase A — Documentation (commits aba2e2b…3a8c96a)

While Phase B was blocked on `@proposit/shared@0.9.0` publishing,
authored the spec-derived doc content in the new `Proposit_Grammar.md`
and rewrote the `CLAUDE.md`/`AGENTS.md` "Key design rules" section.

- `aba2e2b` `Proposit_Grammar.md` §2 — four-tier model (definitions,
  subset chain, enforcement gates, "Derivable" naming note).
- `1b73434` `Proposit_Grammar.md` §3 — rule inventory. All 30 rules
  (S-1..S-14, E-1+E-3..E-7, D-1..D-6, P-1..P-5) with statement,
  invalid/valid examples, and validator function name.
- `d49436d` `Proposit_Grammar.md` §4 (engine behavior + AN-1..AN-4) and
  §5 (`normalize(tier?)` contract) with worked AST-before/after
  examples per AN rule and normalize scenario.
- `7f1beb8` `Proposit_Grammar.md` §6 (validation output reference —
  `TViolation` shape, `TGrammarRuleCode` namespace, example responses,
  engine-error-vs-grammar-rule namespace distinction) and §7 (migration
  notes pre-1.0 → 1.0 with concrete before/after code snippets for
  every removed API).
- `3dfe031` Soften AN-3 promotion semantics and repair-primitive
  references in §§4–5 to admit the deferred-to-implementation
  decisions (per orchestrator guardrail).
- `3a8c96a` Rewrite `AGENTS.md` (`CLAUDE.md` symlink) "Key design rules"
  for the four-tier model. Status banner explaining the section
  anticipates the 1.0 surface landing across Phase B–D.

## Phase B — Validators (pending)

_To be filled in as commits land._

- B0: Swap local stubs for `@proposit/shared@^0.9.0` imports.
- B1: Implement Structural validators S-1..S-14 (TDD per rule).
- B2: Implement Evaluable validators E-1, E-3..E-7 (TDD per rule).
- B3: Implement Derivable validators D-1..D-6 (TDD per rule).
- B4: Implement Presentable validators P-1..P-5 (TDD per rule).
- B5: `validate(tier)` dispatcher tests covering the spec §7.1
  four-case short-circuit semantics.

## Phase C — Engine surface (pending)

_To be filled in as commits land._

- C1: Add `behavior` + `setBehavior()` on `ArgumentEngine`.
- C2: AN post-hook (AN-1..AN-4) as the single uniform post-mutation
  hook gated on `behavior`.
- C3: `normalize(tier?)` global pass.
- C4: Repair primitives.
- C5: Promote Structural rules to throw-on-violation in mutations
  (S-8, S-9, S-12, S-13, S-14).
- C6: Split `populateFromSupports` → `populateFromCitations` +
  `populateFromAxioms`.
- C7: `fromSnapshot`/`fromData` accept any Structural state.
- C8: Naked-Q derivation premises are an evaluation no-op (was: throw).

## Phase D — Removal (pending)

_To be filled in as commits land._

- D1: Delete `src/lib/core/managed-derivation-premise-engine.ts`.
- D2: Delete `src/lib/types/grammar.ts` (`grammarConfig`,
  `autoNormalize`, `enforceFormulaBetweenOperators`,
  `TGrammarConfig`, `TAutoNormalizeConfig`, `DEFAULT_GRAMMAR_CONFIG`,
  `PERMISSIVE_GRAMMAR_CONFIG`, `resolveAutoNormalize`).
- D3: Delete `LOAD_GRAMMAR_CONFIG` / `STRICT_GRAMMAR_CONFIG`.
- D4: Delete `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` constant.
- D5: Update every public interface JSDoc + add engine-error-vs-
  grammar-rule namespace comment.

## Phase E — Documentation finalize (pending)

_To be filled in as commits land._

- E1: Replace `docs/Proposit_Grammar.md` (renaming the draft into
  place; deleting the pre-1.0 file).
- E2: Rewrite `README.md` for the 1.0.0 public face.
- E3: Finalize `CLAUDE.md`/`AGENTS.md` "Key design rules" (drop the
  transitional status banner once the implementation lands).
- E4: Update `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`,
  `examples/arguments/*.yaml`.
- E5: Full pass over `docs/api-reference.md`.
- E6: Finalize release notes + this changelog (rename `upcoming.md` →
  `v1.0.0.md`; start fresh `upcoming.md` files).

## Phase F — Publish (pending)

_To be filled in at publish time._

- F1: Pre-publish baseline check (`pnpm run check`, smoke test,
  examples test all green).
- F2: SendMessage team-lead for publish authorization.
- F3: `pnpm version major` (→ 1.0.0); rename upcoming → v1.0.0.
- F4: `pnpm publish --access public` (human enters OTP).
- F5: `git tag v1.0.0`; push branch + tag; open PR; merge.
- F6: Post `READY: @proposit/proposit-core@1.0.0 published. Server and
mobile can bump.` on broker thread `grammar-tiers`.
