# Enrich `diffArguments` four-state model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich core's `diffArguments` output with an explicit four-state model (`added` / `removed` / `modified-own` / `modified-within`), reference-edge propagation of claim/variable changes, conclusion-role folding into argument own-state, and a documented id-stability contract — as an additive enrichment of the existing diff shape.

**Architecture:** Keep the comparator-driven, flat set-diff in `src/lib/core/diff.ts` and its output types in `src/lib/types/diff.ts`. Add a `TCoreDiffState` discriminant and one uniform own-vs-within rule applied post-comparison to every matched entity, plus a variable→expression→premise reference-edge pass that marks referencing containers `modified-within`. No structural teardown; `added`/`removed`/`modified` arrays are retained.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), TypeBox schemata, Vitest. `pnpm` for all commands. Diff is pure functions over `ArgumentEngine` instances.

## Global Constraints

- **No planning-language in shipped code** (AGENTS.md): no slice/phase/epic labels, review-finding codes, initiative names, or `docs/work/**` paths in comments, `describe`/`it` titles, log/error/CLI strings. Rephrase to the technical invariant. (Genuine domain codes like `D-1`, `E-7`, `S1` are fine.)
- **`src/lib/` carries zero third-party SDK imports and never `import { randomUUID } from "node:crypto"`** — use injected `generateId`. (Diff is pure; no ids minted here — no risk, but do not add one.)
- **Core owns no application metadata** — do not compare title/description in `defaultCompareArgument`; those stay consumer-override territory.
- **Grammar/engine wire codes are stable** — this change adds a new type (`TCoreDiffState`); it renames nothing.
- **ESM imports end in `.js`; directory imports use explicit index path.**
- **TypeScript work uses the `brain-style` skill** (TypeScript sub-skill) for naming/casing; verify types with the LSP tool.
- **TDD:** failing test first for every behavior; frequent commits (one per task).
- **Diff-stability test requirement** (epic acceptance): the core copy/mutation path carries a test — unchanged content → empty diff; single edit → exactly one `modified-own` origin. Task 6 delivers it; it regression-locks the already-compliant core path.
- **Both-checksum reasoning:** own-vs-within is keyed on the comparator result (≡ own `checksum` differs) for own, and on containment-child changes / reference-edge (≡ `combinedChecksum` differs while `checksum` matches) for within. Keep the comparator as the own-detector so server overrides still govern "own".

**Verify after each task:** `pnpm run typecheck` and `pnpm exec vitest run test/diff-state.test.ts` (or the touched file) must pass. Full `pnpm run check` only before the version cut.

---

### Task 1: Add the `TCoreDiffState` discriminant and `state` fields to the diff types

**Complexity: low** (single types file, complete spec → candidate for `bllm-agent`).

**Files:**
- Modify: `src/lib/types/diff.ts` (add type; extend `TCoreEntityFieldDiff`, `TCorePremiseDiff`)
- Modify: `src/lib/index.ts` and `src/index.ts` (re-export `TCoreDiffState`)
- Test: `test/diff-state.test.ts` (new) — a compile-level assertion that `state` is present and typed.

**Interfaces:**
- Produces: `export type TCoreDiffState = "added" | "removed" | "modified-own" | "modified-within"`; `TCoreEntityFieldDiff<T>` gains `state: "modified-own" | "modified-within"`; `TCorePremiseDiff` inherits it.

**Where `state` lives.** `added`/`removed` remain expressed purely by array membership (`TCoreEntitySetDiff.added`/`.removed`); the `state` **field** exists only on `modified` records (`TCoreEntityFieldDiff` / `TCorePremiseDiff`), where it discriminates `modified-own` vs `modified-within`. `TCoreDiffState`'s four members are the shared vocabulary the wire re-wrap (shared slice) keys on; the two `added`/`removed` members are not stored on any core record. **The argument node is always present** (`TCoreArgumentDiff.argument` is not array-membership), so its `state` is always set: `modified-own` (own/conclusion change) or `modified-within` (only children changed). When the whole diff is empty, `argument.state` is still `modified-within` structurally — emptiness is authoritatively decided by the `isDiffEmpty` predicate (`src/cli/output/diff-renderer.ts:9-19`), not by `argument.state`. **Judgment call for the coordinator/human:** if an explicit `"unchanged"` state on the always-present argument is preferred over "empty-diff-decided-by-isDiffEmpty", widen the argument's `state` union — flagged, not decided here.

- [ ] **Step 1: Write the failing test** — a type-level test that a modified record exposes `state`.

```ts
// test/diff-state.test.ts
import { describe, expect, it } from "vitest"
import { PropositCore } from "../src/index.js"
import type { TCoreDiffState } from "../src/index.js"

describe("diff state discriminant", () => {
    it("exposes a modified-* state on each modified entity", () => {
        const states: TCoreDiffState[] = [
            "added",
            "removed",
            "modified-own",
            "modified-within",
        ]
        expect(states).toHaveLength(4)
        // Placeholder engine wiring is added in later tasks; this task only
        // proves the type + export exist and compile.
        expect(typeof PropositCore).toBe("function")
    })
})
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm exec vitest run test/diff-state.test.ts` fails to compile: `TCoreDiffState` is not exported.
- [ ] **Step 3: Add the type and fields.** In `src/lib/types/diff.ts` add `TCoreDiffState`; add `state: "modified-own" | "modified-within"` to `TCoreEntityFieldDiff<T>` (lines 16-20). `TCorePremiseDiff` extends it, so it inherits `state`. Re-export `TCoreDiffState` from `src/lib/index.ts` and `src/index.ts` alongside the other diff-type exports.
- [ ] **Step 4: Run typecheck + test.** `pnpm run typecheck` FAILS in `diff.ts` (records now lack `state`) — expected; Task 3 fills it. Run `pnpm exec vitest run test/diff-state.test.ts` — compiles once `diff.ts` is fixed in Task 3. **Note:** commit this task together with Task 3 if the tree must typecheck between commits; otherwise commit types now and let Task 3 restore green. Prefer committing 1+3 together.
- [ ] **Step 5: Commit** (see Task 3 for the combined commit).

---

### Task 2: Compute own-vs-within for entities already in `modified` (no reference edge yet)

**Complexity: standard** (core diff logic; the uniform rule).

**Files:**
- Modify: `src/lib/core/diff.ts` — `diffEntitySet` (lines 121-186), `diffPremiseSet` (lines 188-291), and the argument assembly (lines 370-398).
- Test: `test/diff-state.test.ts`.

**Interfaces:**
- Consumes: `TCoreDiffState`, `state` field from Task 1.
- Produces: every `modified` record carries a correct `state`; argument state reflects own field changes and (Task 4) conclusion. Helper: state is `"modified-own"` when the entity's own `changes.length > 0`, else `"modified-within"`.

- [ ] **Step 1: Write failing tests** for the containment cases:

```ts
it("tags an operator edit as the expression's modified-own", () => {
    // Build arg A: P → Q ; copy to B ; change root operator implies→iff is
    // root-only, so use an interior and→or edit inside a premise tree.
    // Assert: the edited expression appears in premises.modified[0]
    //   .expressions.modified[0] with state === "modified-own".
})

it("tags a premise whose subtree changed but own fields did not as modified-within", () => {
    // Edit a child expression; the premise's own comparator returns [].
    // Assert: premises.modified[0].state === "modified-within".
})

it("tags a variable symbol rename as modified-own", () => {
    // Assert: variables.modified[0].state === "modified-own".
})
```

Use inline fixtures via `PropositCore` + `core.forkArgument` + `core.diffArguments` (fork-aware matching), mirroring `test/diff-command.test.ts` construction.

- [ ] **Step 2: Run, expect FAIL** — `state` is absent/undefined on the records.
- [ ] **Step 3: Implement the own/within tag.** In `diffEntitySet`, when pushing to `modified`, set `state: changes.length > 0 ? "modified-own" : "modified-within"`. For `diffEntitySet` used on a leaf set (variables, expressions), a matched entity only reaches `modified` when `changes.length > 0`, so it is `"modified-own"` — but keep the ternary uniform. In `diffPremiseSet`, set the premise record `state`: `"modified-own"` if `premiseChanges.length > 0`, else `"modified-within"` (subtree changed). In the argument assembly, set `argument.state`: `"modified-own"` if `argumentChanges.length > 0`, else `"modified-within"` if any variable/premise bucket is non-empty (compute a boolean from the assembled `variables`/`premises` diffs).
- [ ] **Step 4: Run typecheck + tests, expect PASS.**
- [ ] **Step 5: Commit** — `feat(diff): tag matched entities with modified-own vs modified-within`.

---

### Task 3: Restore a green tree + wire the combined types/logic commit

**Complexity: low** (mechanical — this is the commit boundary for Tasks 1-2).

> If Tasks 1 and 2 were committed together already, skip. This task exists so the repository never sits in a non-compiling committed state.

- [ ] **Step 1:** `pnpm run typecheck` — expect PASS (all records now set `state`).
- [ ] **Step 2:** `pnpm exec vitest run test/diff-state.test.ts` — expect PASS.
- [ ] **Step 3: Commit** if not already — `feat(diff): add TCoreDiffState four-state discriminant`.

---

### Task 4: Fold conclusion-role change into argument `modified-own`

**Complexity: low** (one branch; complete spec → `bllm-agent` candidate).

**Files:**
- Modify: `src/lib/core/diff.ts` — argument assembly (lines 370-398), using `rolesA`/`rolesB` already computed (lines 354-355, 394-397).
- Test: `test/diff-state.test.ts`.

**Interfaces:**
- Consumes: `diffRoles` output (`roles.conclusion.before/after`), argument `state` from Task 2.

- [ ] **Step 1: Write failing test.**

```ts
it("marks the argument modified-own when the conclusion premise is reassigned", () => {
    // A and B identical except setConclusionPremise points at a different premise.
    // Assert: diff.roles.conclusion.before !== diff.roles.conclusion.after
    //   AND diff.argument.state === "modified-own".
})
```

- [ ] **Step 2: Run, expect FAIL** — argument state is `"modified-within"` (children unchanged) or the assembly ignores roles.
- [ ] **Step 3: Implement.** In the argument assembly compute `conclusionChanged = roles.conclusion.before !== roles.conclusion.after`. Set `argument.state = (argumentChanges.length > 0 || conclusionChanged) ? "modified-own" : "modified-within"`. (The argument node is always present, so `modified-within` is its default when only children — or nothing — changed; `isDiffEmpty` decides true emptiness. See Task 1 "Where `state` lives".) Keep the standalone `roles` field unchanged.
- [ ] **Step 4: Run typecheck + tests, expect PASS.**
- [ ] **Step 5: Commit** — `feat(diff): fold conclusion reassignment into argument own-state`.

---

### Task 5: Reference-edge propagation — mark referencing containers `modified-within`

**Complexity: standard/high** (the genuinely new logic; touches variable→expression→premise traversal).

**Files:**
- Modify: `src/lib/core/diff.ts` — add a post-pass after the premise/variable diffs are computed, before assembling the return (lines 372-398).
- Test: `test/diff-state.test.ts`.

**Interfaces:**
- Consumes: the assembled `variables` diff (to find `modified-own` variables) and the premise/expression collections (`expressionsB`, `premisesB`).
- Produces: premises (and expressions) that reference a `modified-own` variable but were not otherwise in `modified` are added to `premises.modified` with `state: "modified-within"` and an empty own-`changes` / empty `expressions` set-diff; existing entries are left as-is (own/containment state wins over reference-within).

- [ ] **Step 1: Write failing tests** for the design's worked example (claim Q edited, referenced by P1 `P→Q` and P2 `Q`):

```ts
it("marks premises that reference a changed claim as modified-within", () => {
    // A: P1 = (P → Q), P2 = (Q), Q claim-bound to claim@v0.
    // B: same ids, but Q's variable now claim-bound to claim@v1 (claimVersion bump).
    // Assert: variables.modified has the Q variable with state "modified-own";
    //   premises.modified includes BOTH P1 and P2 with state "modified-within";
    //   neither P1 nor P2 has own field changes.
})

it("does not double-mark: a premise with its own edit stays modified-own even if it also references a changed variable", () => {
    // Assert: that premise's state === "modified-own".
})
```

- [ ] **Step 2: Run, expect FAIL** — P1/P2 are absent from `premises.modified` (reference edge not traversed today).
- [ ] **Step 3: Implement the reference pass.** Build `modifiedOwnVarIds = new Set(variables.modified.filter(m => m.state === "modified-own").map(m => m.after.id))`. For each premise in engine B, if it is not already in `premises.modified` (by after-side id) and any of its expressions is a variable-expression whose `variableId ∈ modifiedOwnVarIds`, push a `TCorePremiseDiff` with `state: "modified-within"`, empty own `changes: []`, and an empty `expressions` set-diff. **Pair `before`/`after` correctly:** retrieve the matched before-side premise (via the same `premiseMatcher`/fork matcher used by `diffPremiseSet`, else by id) and set it as `before`; use the engine-B premise as `after`. Do not use the after premise for both — a reference-within premise is structurally unchanged but the diff object must still carry the genuine before entity for downstream rendering. Guard against fork remapping by keying the "already present" check on the after-side id.
- [ ] **Step 4: Run typecheck + tests, expect PASS.**
- [ ] **Step 5: Commit** — `feat(diff): propagate claim/variable changes to referencing premises as modified-within`.

---

### Task 6: Diff-stability regression-lock for the core copy/mutation path

**Complexity: standard** (the epic-mandated stability test; template = curated reconcile tests).

**Files:**
- Test: `test/diff-state.test.ts` (or a dedicated `test/diff-stability.test.ts`).

**Interfaces:**
- Consumes: `PropositCore.forkArgument`, `PropositCore.diffArguments`, `isDiffEmpty` semantics (`src/cli/output/diff-renderer.ts:9-19`) — reimplement the emptiness predicate inline or import if exported.

- [ ] **Step 1: Write the tests.**

```ts
it("copy with no edits produces an empty diff", () => {
    // fork A→B, change nothing, diff. Assert every bucket empty and
    // roles.conclusion.before === after. (No modified-* anywhere.)
})

it("a single entity edit produces exactly one modified-own origin", () => {
    // fork A→B, make ONE edit (rename one variable OR flip one operator).
    // Assert: exactly one entity across all buckets has state "modified-own";
    // any other modified entries are "modified-within" (containers/refs).
})
```

Provide a small local helper `countByState(diff)` that walks `variables.modified`, `premises.modified`, each premise's `expressions.modified`, and `argument.state`, tallying states.

- [ ] **Step 2: Run, expect PASS** (core copy/mutation is already id-stable — `copyArgument` carries ids forward; this locks it). If it FAILS, that is a real regression in Tasks 2/5 — fix there, do not weaken the test.
- [ ] **Step 3: Commit** — `test(diff): regression-lock diff stability (empty on copy; single origin on one edit)`.

---

### Task 7: Derivation-premise non-leakage regression-lock (OQ5)

**Complexity: low** (test-only; confirms the resolved open question).

**Files:**
- Test: `test/diff-state.test.ts`.

- [ ] **Step 1: Write the tests.**

```ts
it("an unchanged derivation premise produces no diff entry", () => {
    // Build A with a derivation premise (createPremise({type:"derivation", derivedClaimId})).
    // fork A→B, change nothing. Assert premises.modified is empty (derivation
    // premise not spuriously flagged).
})

it("editing a derivation premise tree tags it like a freeform premise", () => {
    // Populate/alter the derivation premise's antecedent in B.
    // Assert: it appears once in premises.modified with a modified-own or
    // modified-within state consistent with the freeform case — no extra
    // synthesized within entries.
})
```

- [ ] **Step 2: Run, expect PASS** (core does not filter or synthesize in the diff path). A failure means an accidental special-case was introduced.
- [ ] **Step 3: Commit** — `test(diff): confirm derivation premises diff without synthesized leakage`.

---

### Task 8: Documentation sync — id-stability contract + changelog + release-notes + api-reference

**Complexity: low** (docs; mechanical once the API is settled — `bllm-agent` candidate).

**Files:**
- Modify: `src/lib/core/diff.ts:325-331` — `diffArguments` JSDoc: add the id-stability contract paragraph (verbatim from spec §"Id-stability contract") and document the four states.
- Modify: `src/lib/core/proposit-core.ts:691-702` — `PropositCore.diffArguments` JSDoc: one-line pointer to the contract + state semantics.
- Modify: `docs/api-reference.md` [Public-API] — document `TCoreDiffState`, the `state` field on modified records, reference-edge within-propagation, and conclusion-in-argument-own-state.
- Modify: `docs/changelogs/upcoming.md` [Any-Code-Change] — developer changelog entry with the commit-hash range.
- Modify: `docs/release-notes/upcoming.md` [Public-API] — plain-language note: diffs now say what changed at its origin and which premises a claim edit touched.
- Optionally modify: `src/cli/output/diff-renderer.ts` — surface the state label in CLI diff output (keeps `isDiffEmpty` meaning unchanged). Add smoke/renderer coverage if changed.

**Interfaces:** none (docs).

- [ ] **Step 1:** Write the contract paragraph into `diffArguments`' JSDoc and the pointer in `PropositCore.diffArguments`.
- [ ] **Step 2:** Update `docs/api-reference.md` for the new type + fields.
- [ ] **Step 3:** Add `docs/changelogs/upcoming.md` + `docs/release-notes/upcoming.md` entries.
- [ ] **Step 4: Run** `pnpm run lint` (prettier `--check` — fix with `pnpm prettify`) so docs pass the pre-push hook.
- [ ] **Step 5: Commit** — `docs(diff): document four-state model + id-stability contract`.

---

### Task 9: Full check + version-cut offer

**Complexity: low** (release hygiene).

- [ ] **Step 1: Run** `pnpm run check` (typecheck + lint + full test + build). Expect PASS.
- [ ] **Step 2:** Do NOT self-publish (cross-repo publish gated at the workspace root). Offer `pnpm version minor` (new public API surface → minor), rename `docs/release-notes/upcoming.md` → `v{version}.md` and `docs/changelogs/upcoming.md` → `v{version}.md`, start fresh `upcoming.md` files, tag `v{version}` — per AGENTS.md, at the coordinator's direction.

---

## Self-review notes

- **Spec coverage:** four-state output (Tasks 1-2), `expressions.modified` surfaced + operator-edit own (Task 2), conclusion-role in argument own-state (Task 4), reference-version awareness via reference edge (Task 5), id-stability contract doc (Task 8), diff-stability test (Task 6), OQ5 non-leakage (Task 7). All design core-slice items mapped.
- **Type consistency:** `TCoreDiffState` and the `state` field names are used identically across Tasks 1, 2, 4, 5, 6, 7.
- **`bllm-agent` candidates (low, fully-scoped, single-file, no un-approved bash):** Task 1 (types+exports), Task 4 (one branch), Task 8 (docs). Tasks 2, 5, 6 keep the reasoning in-house.
