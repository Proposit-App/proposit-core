# proposit-core — Grammar Tiers Agenda

**Cross-repo spec:** `/Users/brian/Projects/Proposit-App/docs/superpowers/specs/2026-05-13-grammar-tiers-design.md` — read first. This briefing is core's slice and is the largest of the four per-repo slices.

**Initiative status:** publish-ready (2026-05-15). All Phases A–D and the publish-prep cycle are complete on branch `grammar-tiers/core` at HEAD `6e1192a`. `package.json` is at `1.0.0` with the local `v1.0.0` tag created by `pnpm version major`. The branch awaits **`pnpm publish --access public`** (human OTP, orchestrator-coordinated). After publish: push branch + tag, PR to main, post `READY:` on broker thread `grammar-tiers` so shared/server/mobile can resume. _(Original status note, retained for context: core publishes **first** — owns the wire-format definitions; shared re-exports from core afterwards. Design restructure 2026-05-14 moved types from shared to core to match existing dep direction.)_

## Capability changes

Core exposes no user-facing capabilities directly. Its part of this initiative is engine surface area — `validate(tier)`, `normalize(tier?)`, the `behavior` setting, the new rule-code namespace, and the mutation contract — that _enables_ the per-app capability changes in spec §1. No `capabilities.md` files are authored in this repo; the spec's per-repo capability authoring tasks land in `proposit-server` and `proposit-mobile` instead.

## Where core fits

You publish **first**. The wire-format types (`TGrammarTier`, `TGrammarRuleCode`, `TViolation`) live in this repo — defined as TypeBox schemas + derived TS types in core's own source. Shared 0.9.0 publishes _after_ you with re-exports of those types + a 422 response envelope (`GrammarViolationsResponseSchema`) composing your `TViolation`. Server + mobile then bump both deps.

Current baseline: `@proposit/proposit-core@0.12.3` on main + public npm. This work is a **major version bump** — likely `1.0.0`, or a clearly-documented `0.13.0` if you decide to stay pre-1.0. The old `grammarConfig` / `autoNormalize` API is **removed, not deprecated** (no migration period; we are the only known consumer and the CLI updates in lockstep).

## Work items

The spec §10.1 lists the work at sketch level. This briefing fleshes it out.

### 1. Wire format imports

**Core IS the single source of truth for the wire format.** Define `TGrammarTier`, `TGrammarRuleCode`, and `TViolation` as TypeBox schemas + derived TypeScript types in core's own source — likely in `src/lib/grammar/types.ts` (your Phase A stub becomes the real exports, no swap needed). Export them from the public API via the lib barrel. There is no `@proposit/shared` dependency to add — shared depends on core (existing peer-dep direction), not the reverse.

The TypeBox schemas can be pulled directly from `proposit-shared-dev`'s `grammar-tiers/shared` branch — they were authored there before the design restructure. Specifically: `proposit-shared/src/schemas/grammar/{tier,rule-code,violation,index}.ts` + tests under `proposit-shared/src/schemas/__tests__/grammar-*.test.ts`. Translate to core's source/test layout. The 422 response envelope (`proposit-shared/src/schemas/api/grammar-violations.ts`) stays in shared and will be added when shared resumes.

### 2. Implement the validators

Implement validators for every rule in spec §4. Group them by tier so `validate(tier)` can short-circuit at the requested tier and return the union from Structural up through `tier` (see the `validate(tier)` JSDoc in §7.1).

A reasonable file layout (confirm during implementation):

- `src/lib/grammar/validators/structural.ts` — S-1 through S-14.
- `src/lib/grammar/validators/evaluable.ts` — E-1, E-3, E-4, E-5, E-6, E-7. (Codes `'E-2'` and `'D-7'` are reserved, not reused — preserve in code comments.)
- `src/lib/grammar/validators/derivable.ts` — D-1 through D-6.
- `src/lib/grammar/validators/presentable.ts` — P-1 through P-5.
- `src/lib/grammar/validate.ts` — top-level dispatcher implementing `validate(tier)` per §7.1's four-case enumeration.

Specific implementation notes pulled from the spec:

- **S-8 (binary operator arity + positions):** check that IMPLIES/IFF have exactly 2 children at positions `[antecedent=0, consequent=1]`. The position invariant is a new structural rule; check that today's `EXPR_BINARY_POSITIONS_INVALID` covers it.
- **S-9 (sibling position uniqueness):** today's "reposition on collision" (the old AN-5) becomes a mutation-time invariant. Composite mutations like `insertExpression` shift colliding siblings as part of the bundled op (spec §8); pure structural ops with collisions throw.
- **S-10/S-11:** entity ID uniqueness + variable symbol uniqueness within an argument. Today's `EXPR_DUPLICATE_ID` / `VAR_DUPLICATE_ID` / `VAR_DUPLICATE_SYMBOL` codes map here.
- **S-12/S-13:** NOT and formula are unary at Structural (today's behavior; previously this lived at Evaluable in an earlier spec draft).
- **S-14:** derivation premise root operator restricted to `variable` / `implies` / `iff`. Note: `iff` is structurally allowed (preserves the existing `iff` two-way-propagation evaluation feature for programmatic / CLI consumers) but D-1 flags it as a Derivable violation — see §12's decision on IFF-at-derivation-root.
- **D-1:** the populated form's antecedent skeleton match must treat `formula` nodes as transparent (the canonical Presentable shape wraps `OR` in a `formula` buffer). Naked-Q is **valid Derivable**, not a violation.
- **E-4:** axiomatic-variable assignment forbidden is a runtime evaluation guard, not an AST invariant. `validate('evaluable')` cannot detect it without the assignment input — surface this behavior in the validator's JSDoc.
- **E-6 (claim-derivation pairing):** at most one derivation premise per normal claim, with 0 valid post-publish-pruning. The engine **auto-creates** a derivation premise when a normal claim is first added to the argument (so the typical mid-edit state is exactly one); the cardinality bound `≤ 1` is what the validator enforces.
- **Evaluation behavior on naked-Q (§4.2 closing note):** `evaluate()` and `checkValidity()` **skip** naked-Q derivation premises — they're no-ops, neither asserting their consequent nor supporting its derivation. This is a behavioral change from today (today's engine throws `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` on naked-Q). Update `validateDerivationStructures` and the eval path accordingly.

### 3. Implement `normalize(tier?)`

Per spec §6. Default `tier` is `'presentable'`. In v1.0 every AN rule (AN-1..AN-4 in §5.1) targets a Presentable invariant, so lower-tier `tier` values are forward-compat no-ops. The parameter exists so the future `submit/finalize` gate (§12 deferred item) can add lower-tier AN rules without an API break.

`normalize()` is non-destructive in the logical-meaning sense — it never deletes variables, changes claim references, or modifies operator semantics. Recovery from Evaluable / Derivable violations requires the targeted repair primitives below.

### 4. Implement the targeted repair primitives

Per spec §7.1 — methods like `removeUnresolvableVariables()`, `removeOrphanOperators()`, etc. Each returns `readonly TViolation[]` of the violations it resolved. Repair primitives respect the engine's `behavior` setting: if `assistive`, AN runs after the repair; if `permissive`, it doesn't. The exact primitive list is your call — enumerate during implementation based on which Evaluable/Derivable violations have safe automated-repair paths.

### 5. Wire `behavior` + the AN post-hook

Add `behavior: 'assistive' | 'permissive'` and `setBehavior(...)` on `ArgumentEngine` per §5. Default is `'assistive'`. After every successful Structural mutation, the engine checks `behavior`; if `'assistive'`, run the AN pass (§5.1) as a uniform post-hook. AN does not bake into individual mutation methods.

### 6. Remove old grammar machinery

Per spec §10.1 — remove `grammarConfig.autoNormalize`, `enforceFormulaBetweenOperators`, the `LOAD_GRAMMAR`/`STRICT_GRAMMAR` snapshot split, and the `ManagedDerivationPremiseEngine` subclass. The subclass's rules become Derivable rules (D-1 through D-6) and the new Evaluable rule E-6 (claim-derivation pairing).

### 7. `populateFromSupports` — split into two methods, factory pattern

**Design refinement landed 2026-05-14 (post-handoff, orchestrator-mediated decision).**

Split `populateFromSupports` into `populateFromCitations` and `populateFromAxioms` on `ArgumentEngine` (not on MDPE — MDPE is removed in Phase D anyway). Each operates on one grounding kind, populating the per-claim derivation premise's antecedent.

**Library-passing contract: method-arg.** The citation/axiom lookup is passed as the last argument to each call. ArgumentEngine constructor and PremiseEngine constructor are **not** widened with library deps (preserves the existing pattern; no `ClaimCitationLibrary` / `ClaimAxiomLibrary` threaded through engine construction).

**Factory pattern, atomic replacement.** The two methods do NOT mutate an existing antecedent in place. Instead, each is a factory that constructs the per-claim derivation premise's expression tree in its **fully populated** form from the start — `IMPLIES(c, Q)` for single grounding, `IMPLIES(OR(c1, …, cn), Q)` for multiple (with the `formula` buffer between IMPLIES and OR when the engine is in `assistive` behavior per AN-1). The factory replaces the existing premise's expression tree atomically. There is no half-populated intermediate state ever observable.

**No throw on D-3 conditions.** Per the design rule "mutations throw only on Structural violations" (see Work Item §10 below), the factory does **not** throw when called on a premise that already has grounding of the _other_ kind. Instead the factory either:

- (a) **Replaces** the existing antecedent with the new homogeneous one, OR
- (b) **No-ops + returns** the existing populated state if the premise isn't naked-Q (caller must first call a clearing repair primitive to opt into the lossy operation, satisfying the no-changes-without-consent principle).

**Decision: (b).** The factory only operates on naked-Q derivation premises. If the premise is already populated, the factory returns a result indicating no-op + the existing state. The UI layer is responsible for confirming with the user before clearing (via `removeUnresolvableVariables` or equivalent) and re-calling the factory. This preserves the no-silent-mutation Proposit principle while still satisfying the "non-Structural rules don't throw" rule.

**Return shape:** `{ kind: 'populated' | 'no-op', state: TCoreDerivationPremise, resolved?: TViolation[] }` — kind discriminates whether the factory acted; `resolved` carries any violations that the new state cleared (typically empty for naked-Q → populated transitions).

**Migration path** (a one-shot lossy drop dropping axioms from mixed antecedents) lives in the server briefing, not here — runtime construction never drops user data.

### 8. Mutation throw contract — Structural-only

**Design rule (landed 2026-05-14 post-handoff):** mutation methods on `ArgumentEngine` and `PremiseEngine` throw **only on Structural-rule violations**. Evaluable, Derivable, and Presentable violations never cause a mutation to throw — they surface through `validate(tier)` and may be cleaned up by AN (assistive) or repair primitives (user-initiated).

**Audit findings — non-Structural throws currently present that must be removed:**

P-1 (formula buffer between operators) enforcement throws — all currently gated on `grammarConfig.enforceFormulaBetweenOperators` and have AN-flag-gated buffer-insertion fallbacks. Under the v1.0 model, the inline branches die and AN-1 (post-hook in assistive mode) inserts the buffer; the throws disappear entirely.

Specific sites to remove (line numbers verified against `grammar-tiers/core@ec09aa2`):

- `src/lib/core/expression-manager.ts:444` — `addExpression` (one throw): "Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node"
- `src/lib/core/expression-manager.ts:871, 1220, 1665` — `removeExpression` / promote-on-remove (three sites): "Cannot remove expression — would promote a non-not operator as a direct child of another operator"
- `src/lib/core/expression-manager.ts:1980, 2001, 2018, 2251, 2271, 2290` — `wrapExpression` and related P-1 enforcement (six sites — each gated on `enforceFormulaBetweenOperators` with a `wrapInsertFormula` fallback): "Non-not operator expressions cannot be direct children of operator expressions — wrap in a formula node"
- `src/lib/core/premise-engine.ts:797` — `toggleNegation` (one throw): "Cannot negate operator expression — would place a non-not operator as a direct child of NOT. Enable negationInsertFormula or wrap in a formula node first."

(Throw count: 1 + 3 + 6 + 1 = 11 total P-1 throw sites. Each has a `wrapInsertFormula` / `negationInsertFormula` AN-flag fallback path. All gating, fallbacks, and throws die together in Phase D.)

MDPE throws (`DERIVATION_TYPE_MISMATCH`, `DERIVATION_STRUCTURE_INVALID`, `DERIVATION_ANTECEDENT_NON_EMPTY`) die wholesale when MDPE is removed in Phase D — no separate action needed for those.

**Phase D scope confirmation:** the removal of these throws is part of "spec-direct AN-1..AN-4 rewrite + legacy removal" — AN-1 must own the buffer-insertion behavior as a true post-hook before the throws can be deleted. The two changes are coupled and land together.

Throws that should **stay** in mutations (legitimate Structural / API-shape):

- Entity-not-found checks (Structural integrity — premise ID, expression ID, variable ID)
- `S-8` binary arity (already throws — keep)
- `S-9` sibling position collisions (already throws — keep)
- `S-12` NOT unary arity (already throws — keep)
- `S-13` formula unary arity (already throws — keep)
- `S-14` derivation premise root operator (now plugged at `premise-engine.ts` — keep)
- API contract throws: `updateExpression` forbidden fields, "Cannot change 'not' — use toggleNegation", permitted operator swaps — these are API-shape contracts, not grammar rules.

### 9. Snapshot loading

Per §7.2 — `fromSnapshot()` and `fromData()` accept any **Structural** state. Lower-tier violations are queryable post-load via `validate(tier)`. The `LOAD_GRAMMAR` / `STRICT_GRAMMAR` snapshot config split is removed. Load failures only happen on truly broken (non-Structural) snapshots; today's `LEGACY_*` codes fold into Structural violations with stable codes — enumerate the specific mapping during implementation.

### 10. Documentation rewrite

**Delete `proposit-core/docs/Proposit_Grammar.md`.** That file (128 lines, formula-string parser grammar only) is too narrow for the new model.

**Rewrite from scratch:**

- **`README.md`** — full rewrite covering the library at large. The new README is the public face of `@proposit/proposit-core@1.0.0`. It should describe the four-tier grammar model, the `ArgumentEngine` API surface, the rule inventory, the auto-normalization contract, the `validate(tier)` / `normalize(tier?)` / behavior modes, the repair primitives, and a clear migration note for pre-1.0 users.
- **`docs/Proposit_Grammar.md`** (new file at the same path as the deleted one) — the durable grammar reference. Per spec §11, it covers:
    1. Formula-string parser grammar (preserved from the deleted doc).
    2. The four-tier model — definitions, the subset chain, gates.
    3. Rule inventory — every rule from spec §4, with its tier, code, examples of valid and invalid states, and the validator that checks it.
    4. Engine behavior and AN — the contract from §5, with worked examples of how AN preserves Presentable across each kind of mutation.
    5. `normalize()` contract — what it does and does not do, with worked examples.
    6. Validation output reference — the `TViolation` shape, the rule-code namespace, examples of validation responses.
    7. Migration notes — for readers of pre-1.0 versions, what changed and why.
- **`docs/api-reference.md`** — full pass to reflect the new API. Engine interfaces in `src/lib/core/interfaces/*.interfaces.ts` need their JSDoc updated in lockstep.
- **`CLAUDE.md`** — update the "Key design rules" section to reflect the new model. Many entries become wrong (`autoNormalize`, `grammarConfig`, `ManagedDerivationPremiseEngine`, the LOAD/STRICT split, naked-Q-depends-on-`collapseEmptyFormula`); rewrite them. Add new entries describing the four-tier model, `validate(tier)`, `behavior` settings, and the repair primitives.
- **`CLI_EXAMPLES.md`** — review for accuracy; CLI commands that referenced the old `autoNormalize` flags need updating.
- **`scripts/smoke-test.sh`** — same review.
- **`examples/arguments/*.yaml`** — confirm the example arguments still load under the new model (they should, since the new model is more permissive at load time).

Spec §11 is the source of truth for the rewrite's table of contents; reference it explicitly in the new `Proposit_Grammar.md`.

## Publish process

1. Spec + plan in `proposit-core/docs/superpowers/specs/` and `.../plans/`.
2. Branch: `grammar-tiers/core` (or your preferred naming).
3. Run `pnpm run check` — full pipeline green (typecheck, lint, build, test).
4. Run `bash scripts/smoke-test.sh` (after build) to confirm CLI is happy.
5. Version bump: `pnpm version major` (or `minor` to land at `0.13.0` if you prefer pre-1.0). Major is the cleaner signal — the API change is breaking.
6. Rename `docs/release-notes/upcoming.md` → `docs/release-notes/v{version}.md`. Same for `docs/changelogs/upcoming.md`. Release notes must call out the API removal explicitly (no deprecation period).
7. `pnpm publish --access public` (human completes OTP).
8. Push branch + tag (`git tag v{version}`).
9. PR → main, merge.
10. Post on broker thread `grammar-tiers`: `READY: @proposit/proposit-core@{version} published. Server and mobile can bump.`

## Coordination

- **Broker thread:** `grammar-tiers`. Watch for shared's `READY:` before starting non-doc work.
- **Upstream dependency:** none. You publish first.
- **Downstream consumers waiting on you:** `proposit-server` and `proposit-mobile` (both bump after your publish, in parallel).

## What good progress looks like

- Day 1: read the spec end-to-end; sketch a plan in `docs/superpowers/plans/grammar-tiers-core-plan.md`; open the broker thread.
- Days 2–3: pull TypeBox schemas from `proposit-shared-dev`'s `grammar-tiers/shared` branch into core's source; promote your Phase A type stubs to real exports.
- Days 4–10: implementation of validators + AN pass + behavior switch + repair primitives + snapshot loading. Tests written alongside (TDD).
- Days 10–12: documentation rewrite (README, Proposit_Grammar.md, CLAUDE.md, etc.).
- Day 13: publish + merge. Post `READY:` on broker.

Total: ~2 weeks. The documentation rewrite is a real chunk of work; don't underestimate it.

## Out of scope

- Server-side migration scripts (server runs them).
- Mobile UI changes (mobile's job).
- Authoring `capabilities.md` files (server + mobile own those).
- The 422 response envelope (`GrammarViolationsResponseSchema`) — that stays in shared and composes your exported `TViolation`. Shared owns the envelope; you own the types it references.
