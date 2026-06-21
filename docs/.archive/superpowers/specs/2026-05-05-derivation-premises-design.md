# Derivation Premises (v0.11.0)

## Motivation

This release introduces a structurally-constrained `derivation` premise type alongside the existing freeform premise model. A derivation premise's job is to derive a single named claim — its consequent is locked to that claim's variable, and its antecedent (when present) is the supporting argument: cited sources, authored reasoning, or both.

The motivating insight is that an unsupported claim should be visibly recognizable from an argument's structure alone, not buried in detached metadata. A derivation premise with no antecedent (just the consequent claim's variable expression at the root) is a structural symptom of "no support given for this claim". Apps and reviewers can identify these at a glance.

This is the second of two related releases. **v0.10.0** unified the source/claim entity model and renamed `ClaimSourceLibrary` to `ClaimCitationLibrary`. This release builds on that unified model: a derivation premise's antecedent typically references citation-typed claims (cited sources) and/or normal-typed claims (authored intermediate reasoning).

The two releases were originally bundled as a single design but were split because the engineering risk of a 500-site PR was unacceptable. v0.10.0 ships first; v0.11.0 follows once it has stabilized. **v0.11.0 is a hard sequencing gate behind v0.10.0** — implementation cannot begin until v0.10.0 has shipped, because v0.11.0 references `ClaimCitationLibrary` (renamed in v0.10.0) and `type: "citation"` (added in v0.10.0).

## Goals

- Add a `type: "freeform" | "derivation"` discriminator to `TCorePremise` so derivation premises are first-class artifacts.
- Provide opt-in structural enforcement via a new `ManagedDerivationPremiseEngine` class.
- Provide a one-shot citation snapshot helper (`populateFromCitations`) so apps can build derivation antecedents from the citation library without owning the wiring.
- Add evaluation-time validation so structurally-broken derivation premises fail loud rather than silently corrupting analysis output.
- Preserve the classic `PremiseEngine` permissiveness — derivation rules are deferred grammar, like operator arity, and can be temporarily violated mid-mutation.

## Non-goals

- Auto-creation of derivation premises in response to variable additions. Apps decide when to create derivation premises; the engine does not.
- Recursive cascade of derivation premise creation. If an app wants source-claims to also have their own derivation premises materialized, it invokes `populateFromCitations` on each one.
- Drift comparison API between derivation premise antecedents and global citations. Versioning already provides time-pinned semantics; consumers can compute the comparison with public APIs if they want a UX nudge.
- Axiomatic claims (a future "true by definition / common knowledge" claim type). The inclusion of `iff` as a derivation root operator anticipates this future work but does not define or preclude it.

## Dependency on v0.10.0

This release assumes:

- `TCoreClaim` carries a required, immutable `type: "normal" | "citation"` field.
- `ClaimCitationLibrary` exists with strict source-side type and acyclicity invariants (single-lookup constructor signature).
- `ForkLibrary` has 5 namespaces (sources folded into claims).
- The error code conventions established in v0.10.0 (`CITATION_*`, `CLAIM_TYPE_IMMUTABLE`, `LEGACY_CLAIM_MISSING_TYPE`).

## Premise type discriminator

`CorePremiseSchema` becomes a TypeBox discriminated union:

```ts
type TCorePremise =
    | TCoreFreeformPremise // { type: "freeform", ...common fields }
    | TCoreDerivationPremise // { type: "derivation", derivedClaimId: UUID, ...common fields }
```

- `"freeform"`: any valid expression tree (current behavior).
- `"derivation"`: structurally committed to deriving a single named claim. Required `derivedClaimId: UUID` references the claim being derived.

Both `type` and `derivedClaimId` are **immutable post-creation**. There is no public mutation API for either, and direct snapshot tampering is caught at restore-time validation.

The discriminated-union pattern matches existing conventions in `src/lib/schemata/propositional.ts` (`CorePropositionalExpressionSchema` uses `Type.Union` with a `type` literal). TypeBox `Value.Check` correctly narrows by the `type` field. Persistence implication: snapshot restore reads raw JSON; the schema check at restore time is the only enforcement. A snapshot with `type: "derivation"` but no `derivedClaimId` fails schema validation. A snapshot with `type: "freeform"` plus a stray `derivedClaimId` extra field passes (because `additionalProperties: true`), which is a minor data-hygiene concern but consistent with current extras semantics.

The TypeBox discriminated union must preserve `additionalProperties: true` on each variant to keep `extras` extension working for app-level metadata. (Naming collision warning analogous to v0.10.0's claim type field: apps that previously used `type` as an extra on premises must rename before adopting v0.11.0.)

### Premise type migration

Migration of pre-v0.11.0 premise data — adding `type: "freeform"` to existing premise records that lack the field — is the responsibility of v0.11.0 itself, not v0.10.0. The v0.10.0 release does not touch premise records. v0.11.0's CLI migration step (parallel to v0.10.0's claim-type backfill) walks `arguments.json` (or wherever premise data is persisted) and adds the default `type: "freeform"` to each premise record without it. This step also recomputes premise checksums (since `type` and `derivedClaimId` are added to `premiseFields` in `DEFAULT_CHECKSUM_CONFIG`), which cascades up to argument-level `descendantChecksum` and `combinedChecksum` values.

The CLI migration uses the same one-time-marker pattern as v0.10.0 — a `.proposit-v0.11` file in the state directory indicates the migration has run.

## Derivation premise structure

A premise with `type: "derivation"` and `derivedClaimId: Q.id` must conform to:

- The root expression is **either** a single variable expression for Q's variable (naked), **or** an `implies`/`iff` operator with arity 2.
- When the root is `implies`/`iff`:
    - Position 0 (antecedent slot): any valid expression tree.
    - Position 1 (consequent slot): exactly the variable expression for Q's variable. No operator subtree, no other variable, no formula wrapper.
- Both `implies` and `iff` are accepted as the root operator. Per `argument-evaluation.ts:151–162`, both treat `children[0]` as the antecedent and `children[1]` as the consequent — position-ordered, even though `iff` is truth-functionally symmetric. Verified preserved across the entire codebase: parser (`src/lib/core/parser/formula.peggy`), validation (`expression-manager.ts`), evaluation propagation (`argument-evaluation.ts:290–305`), rendering (`premise-engine.ts:1896–1899`), and operator-swap path (`expression-manager.ts:84–85, 743–744`). No code path canonicalizes `iff` children — `getChildExpressions` always sorts by position and `absorbSameOperatorIfNeeded` does not apply to root-only operators.

### iff propagation note

Evaluation propagation for `iff` runs both directions: from `children[0]` to `children[1]` AND from `children[1]` to `children[0]` (`argument-evaluation.ts:290–305, 357–372`). For a derivation premise `IFF(antecedent, Q)`, this means propagation will infer Q's value from the antecedent **and** also infer the antecedent's value from Q. This is logically correct for a biconditional but may surprise consumers who treat `iff` as a one-way derivation step. Apps that want strict one-way derivation should use `implies` instead.

This consequence is documented but not changed. The semantics is correct propositional logic; consumers must understand the difference between `implies` (one-way) and `iff` (two-way) when choosing the root operator.

### Naked-form derivation and the collapse-flag dependency

The naked-variable form (root = single variable expression for Q) is the visible "lack of cited or authored support" symptom. It can arise two ways:

- **Direct creation**: `argumentEngine.createPremise({type: "derivation", derivedClaimId: Q.id})` initializes the premise's expression tree to a naked Q variable expression at the root (no antecedent).
- **Antecedent collapse**: stripping the antecedent of `IMPLIES(_, Q)` leaves the operator with one child (Q at position 1), which the existing `collapseIfNeeded` (`expression-manager.ts:1134–1234`) handles via `promoteChild`. The remaining child Q is promoted into the IMPLIES slot (reparented to root with `parentId: null`), producing naked Q.

The collapse path requires the `collapseEmptyFormula` flag to be enabled in `grammarConfig.autoNormalize` (per CLAUDE.md "Operator collapse gated on `collapseEmptyFormula`"; verified at `expression-manager.ts:1135`). When the flag is off, antecedent stripping leaves the tree in an intermediate-invalid state with `IMPLIES` having only one child, and the derivation premise will fail evaluation pre-flight until the user explicitly produces a valid shape.

**Recovery path under `collapseEmptyFormula: false`**: the only way to repair an `IMPLIES(Q)` (1-child) intermediate state is to add a new antecedent at position 0 — `removeExpression` of Q would produce `IMPLIES()` (0 children), still invalid. `addExpression` of an antecedent restores well-formedness.

**This release does not mandate `collapseEmptyFormula: true` for derivation premises.** It is a per-engine grammar configuration concern. Apps that want clean naked-Q semantics must enable `collapseEmptyFormula` in their `autoNormalize` config. The spec documents the dependency; apps choose.

## Permissive classic engine

The classic `PremiseEngine` does not enforce derivation rules. Mutations on a `type: "derivation"` premise can produce a temporarily or permanently invalid structure. This is consistent with the engine's existing treatment of grammar rules like operator arity (deferred validation): the structure is allowed to drift, and validity is enforced only at boundaries that opt in.

The boundaries that opt in are:

- `ManagedDerivationPremiseEngine` (constructor, restore, mutation methods).
- The evaluation pre-flight check in `ArgumentEngine.evaluate(...)` and `ArgumentEngine.checkValidity(...)`.
- The public `ArgumentEngine.validateDerivationStructures()` method that apps can call ad hoc.

## ManagedDerivationPremiseEngine

A new class `ManagedDerivationPremiseEngine extends PremiseEngine` enforces the derivation rules. Constructing the class on a non-conforming premise throws.

### Class structure

```ts
class ManagedDerivationPremiseEngine extends PremiseEngine {
    constructor(...) { /* validates at construction time */ }
    static fromSnapshot(...): ManagedDerivationPremiseEngine
    populateFromCitations(citationLib: ClaimCitationLibrary): void
    // Inherited mutation methods are overridden to enforce derivation rules.
}
```

The factory pattern is `static fromSnapshot` (mirroring `PremiseEngine.fromSnapshot` at `premise-engine.ts:1971`). TypeScript does not support polymorphic static-method overrides, so `ManagedDerivationPremiseEngine.fromSnapshot` is explicitly redefined with the additional structural validation; it does NOT rely on inheriting the parent's static method. Internally it can delegate to `PremiseEngine.fromSnapshot` for the base reconstruction and then run the validation pass.

### Subclassing prerequisites — PremiseEngine `private` → `protected` refactor

The current `PremiseEngine` has 17 `private` fields (`premise-engine.ts:115-137`). Subclasses cannot read or modify these without going through public methods. For `ManagedDerivationPremiseEngine`'s structural validation, the realistic widening is approximately 5 of the 17 fields:

- `premise` (need access to `derivedClaimId`)
- `rootExpressionId` (need to identify the root expression for structural validation)
- `expressions` (need to walk children and extract the consequent)
- `variables` (need to look up the consequent variable)
- `grammarConfig` (need to know what mutations are allowed)

The exact list is finalized during implementation — only the fields the managed engine actually accesses are widened. Public surface is unchanged.

`withValidation` is already `protected` (`premise-engine.ts:237`), which is the natural integration point for managed-engine validation wrapping. No changes needed there.

This is a **clean refactor** (5/17 fields), not a near-rewrite.

### Mutation methods overridden

The public mutation surface of `PremiseEngine` (verified against `src/lib/core/premise-engine.ts`) includes:

- `addExpression`
- `appendExpression`
- `addExpressionRelative`
- `updateExpression`
- `removeExpression`
- `insertExpression`
- `toggleNegation`
- `wrapExpression`
- `changeOperator`
- `normalizeExpressions` — runs `expressions.normalize()`, which can promote/collapse and could destroy the consequent slot if invoked on an unbalanced tree. **Must be overridden** to either no-op when the premise is a well-formed derivation, or post-validate after normalization.
- `loadExpressions` — bulk-replaces the expression set. **Must be overridden** to validate the loaded set conforms to derivation structure before accepting; reject otherwise.
- `setExtras`, `updateExtras` — non-structural; no override needed unless a future change moves `derivedClaimId` into extras (it doesn't, per the schema).

`promoteChild` is **not** in the override list — it does not exist as a public method on `PremiseEngine` (it lives on `ExpressionManager` as an internal helper). Promotion happens as a side-effect of `removeExpression(id, deleteSubtree=false)`, which is already covered.

`deleteExpressionsUsingVariable` is **not** in the override list — it calls `removeExpression(..., true)` in a loop, so derivation rule enforcement happens transitively via the `removeExpression` override.

`ManagedDerivationPremiseEngine` overrides each method in the override list to enforce additional invariants on top of the inherited grammar:

| Rule                                                                         | Error                              |
| ---------------------------------------------------------------------------- | ---------------------------------- |
| Cannot insert into the consequent slot (position 1 of root `implies`/`iff`). | `DERIVATION_CONSEQUENT_LOCKED`     |
| Cannot remove the consequent variable expression.                            | `DERIVATION_CONSEQUENT_LOCKED`     |
| Cannot change the variable referenced by the consequent.                     | `DERIVATION_CONSEQUENT_LOCKED`     |
| Cannot wrap the consequent in `not`.                                         | `DERIVATION_CONSEQUENT_LOCKED`     |
| Cannot change the root operator from `implies`/`iff` to `and`/`or`/`not`.    | `DERIVATION_ROOT_OPERATOR_INVALID` |
| Cannot bulk-load an expression set that violates derivation structure.       | `DERIVATION_STRUCTURE_INVALID`     |
| Cannot normalize when normalization would destroy the consequent.            | `DERIVATION_STRUCTURE_INVALID`     |

Antecedent expressions remain fully editable. Negation, restructuring, formula wrapping, operator changes between `and↔or` — all unconstrained as long as they don't touch the consequent slot.

### Constructor validation

`ManagedDerivationPremiseEngine`'s constructor validates:

1. The wrapped premise has `type: "derivation"`. Throws `DERIVATION_TYPE_MISMATCH` otherwise.
2. The wrapped premise's expression tree conforms to the structural rules above. Throws `DERIVATION_STRUCTURE_INVALID` otherwise.

The same validation runs in `ManagedDerivationPremiseEngine.fromSnapshot` so that snapshots tampered into invalid shape are caught at restore time.

### populateFromCitations

`populateFromCitations(citationLib: ClaimCitationLibrary): void` — one-shot snapshot helper:

- Looks up `citationLib.getCitationsForCitingClaim(derivedClaimId)` → `[S1, …, Sn]` (all citations from `derivedClaimId`).
- Ensures a claim-bound variable exists in the argument for each `Si`. **This requires a new public API on `ArgumentEngine` — `ensureClaimBoundVariable(claimId: UUID): TClaimBoundVariable`** — see "New ArgumentEngine API" below.
- Builds the antecedent expression tree based on `n`:
    - `n = 0`: leaves the premise in its current form (typically naked Q if newly created). Returns without modification.
    - `n = 1`: produces `IMPLIES(VariableExpression(S1), VariableExpression(Q))`.
    - `n ≥ 2`: produces `IMPLIES(OR(VariableExpression(S1), …, VariableExpression(Sn)), VariableExpression(Q))`.
- **One-shot**: no live binding to the citation library. Subsequent mutations to global citations do not propagate. To re-snapshot, the caller deletes and re-creates the derivation premise (or constructs a new one alongside).
- **Non-recursive**: does not invoke `populateFromCitations` on cited claims' derivation premises. Apps that want recursive materialization invoke it themselves on each cited claim.
- **Refuses non-empty antecedent**: detection is structural — the wrapped premise has a non-empty antecedent if the root expression is an operator (i.e., `implies`/`iff`) with a non-null position-0 child. If detected, throws `DERIVATION_ANTECEDENT_NON_EMPTY`. The caller decides whether to delete and re-create or re-use the existing structure. **Future opt-in merge mode** (deferred to plan): an option flag like `{merge: true}` could append new sources to an existing antecedent's `OR` group; out of scope for the initial implementation.

### New ArgumentEngine API: `ensureClaimBoundVariable`

`populateFromCitations` needs to create variables for cited claims that may not yet exist in the argument. The current `ArgumentEngine` has no public API that does this idempotently — `addVariable` (`argument-engine.ts:746`) requires a fully-formed `TClaimBoundVariable` with id, symbol, and version pre-supplied; `generateUniqueSymbol` is `private`.

This release adds a new public method:

```ts
ensureClaimBoundVariable(claimId: UUID): TClaimBoundVariable
```

Behavior:

- If a claim-bound variable for `claimId` already exists in the argument, return it.
- Otherwise, create a new claim-bound variable with:
    - A fresh UUID.
    - The current version of the claim from `ClaimLibrary`.
    - An auto-generated symbol via the existing `generateUniqueSymbol` helper (now exposed to internal callers; remains private to external consumers).
- Throws `CLAIM_NOT_FOUND` if the claim is not in the library.

This API is independently useful beyond `populateFromCitations` — apps that programmatically add claim references to arguments can use it. It's a small, well-defined addition.

## createPremise signature change

`argumentEngine.createPremise` currently accepts `(extras?: Record<string, unknown>, symbol?: string)` (positional). To support derivation premise creation with typed parameters, the signature changes to a typed options bag.

**Backward-compatible overload approach** (recommended) to reduce call-site churn from ~50 sites:

```ts
createPremise(): TCorePremise  // no args
createPremise(extras: Record<string, unknown>, symbol?: string): TCorePremise  // legacy positional
createPremise(options: {
    type?: "freeform" | "derivation"
    derivedClaimId?: UUID
    extras?: Record<string, unknown>
    symbol?: string
}): TCorePremise  // new typed bag
```

The implementation discriminates between the legacy signature and the typed-bag signature by inspecting the first argument: if it has a `type` or `derivedClaimId` property, it's the new bag; otherwise it's the legacy `extras`. This is a soft heuristic — apps that happen to pass an `extras` object containing a `type` key as a positional arg would route to the new bag — but combined with the v0.11.0 reservation of `type` on premise records, this collision was already a breaking change and the heuristic correctly handles it.

If the user prefers a clean break (no overload), all ~50 call sites in tests + 1 in CLI break and require updating. **The plan should default to the overload** and surface this for explicit decision.

When `type === "derivation"`:

- `derivedClaimId` is required; throws `CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID` if missing.
- The engine looks up the claim in the `ClaimLibrary`; throws `CREATE_DERIVATION_CLAIM_NOT_FOUND` if missing.
- The engine ensures a claim-bound variable for the derived claim exists in the argument (via the new `ensureClaimBoundVariable` API).
- The premise is initialized with the consequent variable expression at the root (naked Q form).
- The existing auto-creation of a premise-bound variable for the new premise (per CLAUDE.md design rules) continues to apply — derivation premises also get their own premise-bound variable so other premises can reference their evaluation.

When `type === "freeform"` or omitted, behavior matches today's `createPremise` (empty premise, premise-bound variable auto-created).

### createPremiseWithId signature change (parallel)

`createPremiseWithId` (`argument-engine.ts:594`) is used internally by `forkArgument` (`argument-engine.ts:1457`) and in tests (~45 sites). It gets the same typed-bag treatment with the same overload pattern, accepting an additional `premiseId` field in the options bag.

**Fork integration**: `PropositCore.forkArgument()` rebuilds engines from premise data. The fork code path must propagate the `type` and `derivedClaimId` fields when calling `createPremiseWithId`. The fork copy logic walks each premise in the source argument and re-creates it in the forked argument with the appropriate type/derivedClaimId values preserved. Fork records remain unchanged in shape (no derivation-specific fork record fields).

## Evaluation-time validation

Because classic `PremiseEngine` mutations can leave a `type: "derivation"` premise structurally broken, evaluation must refuse to proceed silently. The existing `ArgumentEngine.evaluate(...)` returns `{ok: false, validation}` on validation failure (per `argument-evaluation.ts:392–398`); the spec preserves that non-throwing convention rather than introducing a throw path for derivation-specific validation.

Implementation point: the existing `ArgumentEngine.evaluate` (line ~1997) is a thin delegate to `evaluateArgumentStandalone`. The standalone function gates on `validateFirst` (default `true`) and runs `ctx.validateEvaluability()` (`argument-engine.ts:1939`), populating `validation.violations` on failure. The derivation pre-flight folds into `validateEvaluability` as an additional check rather than as a separate hook — this avoids running validation twice and keeps the `{ok, validation}` shape consistent.

- `ArgumentEngine.validateEvaluability()` is extended to walk every premise with `type: "derivation"` and validate each conforms to the derivation structural rules. Violations are added to the result with code `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`, identifying the offending premise ID and the rule violated.
- `ArgumentEngine.evaluate(...)` and `ArgumentEngine.checkValidity(...)` (line ~2008) both share the validation gate via `validateEvaluability`, so derivation pre-flight applies to both code paths automatically. This prevents `checkValidity` returning "valid argument" on a structurally-broken derivation premise.
- The same validation is exposed as a public method `ArgumentEngine.validateDerivationStructures(): TInvariantValidationResult`, so apps can pre-check before evaluation if they want to inspect derivation-specific violations without invoking the full evaluation pipeline. This method runs only the derivation-specific subset of `validateEvaluability`'s checks.

The validation routine lives in a single utility module (e.g., `src/lib/utils/derivation-validation.ts`; exact path is a plan-level concern) and is invoked from four sites:

1. `ManagedDerivationPremiseEngine` constructor and `static fromSnapshot`.
2. `validateEvaluability` in `ArgumentEngine` (covers both `evaluate` and `checkValidity`).
3. The public `ArgumentEngine.validateDerivationStructures` entry point.
4. The classic engine's `loadExpressions` and `normalizeExpressions` overrides on `ManagedDerivationPremiseEngine`.

## Lifecycle

- **Creation** is fully driven by the application:
    - `argumentEngine.createPremise({ type: "derivation", derivedClaimId: Q.id })` creates a derivation premise with naked Q at the root. Internally calls `ensureClaimBoundVariable(Q.id)` to materialize the variable.
    - Apps can then operate on the premise via classic `PremiseEngine` (permissive, no enforcement) or wrap it in `ManagedDerivationPremiseEngine` for safe mutations.
    - To seed the antecedent from current citations, apps wrap with `ManagedDerivationPremiseEngine` and call `populateFromCitations`.
- **Deletion** uses the existing `argumentEngine.removePremise` flow. No special semantics for derivation premises.
- **Plurality**: the core library does not enforce one-derivation-per-claim. Apps may permit or restrict multiple derivation premises with the same `derivedClaimId`. Truth-functionally `(A → Q) ∧ (B → Q) ≡ (A ∨ B) → Q` across a single argument's premise set, but each premise is independently evaluated and listed in `listSupportingPremises` (`argument-engine.ts:1210`); counterexample search treats them as independent constraints. The choice between one vs. many is editorial.

### Counterexample search note

Multiple derivation premises with the same `derivedClaimId` produce truth-functionally equivalent constraints when ANDed together but are presented and evaluated separately. Apps that want to surface "which specific support failed" can use the per-premise evaluation results. Apps that want a single combined view can collapse them into one premise themselves, accepting the loss of independent visibility.

## Affected code (full inventory)

### Schemata (`src/lib/schemata/propositional.ts`)

- `CorePremiseSchema` → discriminated union:
    - `CoreFreeformPremiseSchema` (existing shape with `type: "freeform"` literal added)
    - `CoreDerivationPremiseSchema` (existing shape with `type: "derivation"` literal and required `derivedClaimId: UUID`)
    - `CorePremiseSchema = Type.Union([CoreFreeformPremiseSchema, CoreDerivationPremiseSchema])`
- Update `TCorePremise` type alias accordingly.
- Preserve `additionalProperties: true` on each variant.

### Core libraries (`src/lib/core/`)

- `premise-engine.ts` — visibility refactor: widen approximately 5 specific `private` fields (`premise`, `rootExpressionId`, `expressions`, `variables`, `grammarConfig`) to `protected` based on `ManagedDerivationPremiseEngine` needs. Public surface unchanged. The static `fromSnapshot` factory remains as-is; the managed engine defines its own `static fromSnapshot` that delegates and validates.
- `argument-engine.ts` — multiple changes:
    - `createPremise` and `createPremiseWithId` signatures change to typed-bag with backward-compatible overload (~50 call sites preserved).
    - Add new public method `ensureClaimBoundVariable(claimId: UUID): TClaimBoundVariable`.
    - Add new public method `validateDerivationStructures(): TInvariantValidationResult`.
    - Extend `validateEvaluability()` to include derivation premise structural checks. This automatically flows to `evaluate` and `checkValidity`.
    - `forkArgument` / fork copy paths (line ~1457): when calling `createPremiseWithId`, propagate `type` and `derivedClaimId` from the source premise.
- New file: `src/lib/core/managed-derivation-premise-engine.ts` — the `ManagedDerivationPremiseEngine` class definition with constructor validation, static `fromSnapshot` factory, mutation method overrides (including `normalizeExpressions` and `loadExpressions`), `populateFromCitations` helper.

### Utilities (`src/lib/utils/`)

- New file: `src/lib/utils/derivation-validation.ts` (path indicative; final path per implementation plan) — single source of truth for derivation premise structure validation. Exports a function like:
    ```ts
    validateDerivationStructure(
        premise: TCoreDerivationPremise,
        expressions: TCorePropositionalExpression[],
        variables: TCorePropositionalVariable[]
    ): TInvariantValidationResult
    ```
- Used by managed engine constructor/restore, `validateEvaluability`'s extension, and `validateDerivationStructures` public method.

### Interfaces (`src/lib/core/interfaces/`)

- `argument-engine.interfaces.ts` — JSDoc updates for `createPremise` (new typed-bag overload), `createPremiseWithId` (same), `evaluate` (derivation pre-flight behavior via `validateEvaluability`), `checkValidity` (same), and the new `validateDerivationStructures` and `ensureClaimBoundVariable` methods.
- `premise-engine.interfaces.ts` — JSDoc updates if visibility refactor touches public surface (it shouldn't, but verify).
- `library.interfaces.ts` — update `TPremise` type references to reflect the discriminated union.

### Types (`src/lib/types/validation.ts`)

Add new error codes:

- `DERIVATION_TYPE_MISMATCH` — managed engine constructor wrapping a non-derivation premise.
- `DERIVATION_STRUCTURE_INVALID` — managed engine constructor / restore on a malformed derivation premise; also raised by `loadExpressions`/`normalizeExpressions` overrides.
- `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` — populated in `validateEvaluability` result.
- `DERIVATION_CONSEQUENT_LOCKED` — managed engine mutation that would touch the consequent.
- `DERIVATION_ROOT_OPERATOR_INVALID` — managed engine mutation that would change the root operator inappropriately.
- `DERIVATION_ANTECEDENT_NON_EMPTY` — `populateFromCitations` called on a premise with non-empty antecedent.
- `CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID` — `createPremise({type: "derivation"})` without `derivedClaimId`.
- `CREATE_DERIVATION_CLAIM_NOT_FOUND` — `createPremise({type: "derivation", derivedClaimId})` where the claim doesn't exist in the library.
- `CLAIM_NOT_FOUND` — `ensureClaimBoundVariable(claimId)` where the claim doesn't exist in the library.

### Public exports (`src/lib/index.ts`)

- ADD: `ManagedDerivationPremiseEngine` re-export.

### Constants (`src/lib/consts.ts`)

- `DEFAULT_CHECKSUM_CONFIG.premiseFields` — add `"type"` and `"derivedClaimId"` to the default set, since these are identity-bearing.

### CLI (`src/cli/`)

- `commands/premises.ts` (or wherever premise creation lives) — accept new flags for derivation premise creation:
    - `premises add --type=derivation --derived-claim=<claimId>` to create a derivation premise.
    - `premises populate-citations <premiseId>` to invoke `populateFromCitations` on a derivation premise via a freshly-constructed `ManagedDerivationPremiseEngine`.
- Render output: derivation premises display their `type` indicator and the derived claim, distinguishing them from freeform premises in CLI output.
- New file `src/cli/storage/migrate-v0.11.ts` — one-time migration step that walks persisted premise data, adds `type: "freeform"` to records lacking it, recomputes premise checksums (which cascades up to argument-level descendantChecksum/combinedChecksum). Uses `.proposit-v0.11` marker file to ensure idempotency.

### Tests (`test/core.test.ts`)

Add new `describe` blocks at the bottom of the file:

- `describe("Premise type discriminator", ...)` — verify schema accepts both variants; verify type immutability post-creation; verify `derivedClaimId` immutability.
- `describe("createPremise with type and derivedClaimId", ...)` — new typed-bag signature behavior, claim-bound variable auto-creation via `ensureClaimBoundVariable`, naked-Q initialization. Also verify legacy positional signature still works (overload).
- `describe("createPremiseWithId with derivation type", ...)` — same as above for the with-id variant.
- `describe("ensureClaimBoundVariable", ...)` — idempotency, version pinning, symbol auto-generation.
- `describe("ManagedDerivationPremiseEngine constructor validation", ...)` — type mismatch, structure invalid, well-formed cases.
- `describe("ManagedDerivationPremiseEngine.fromSnapshot", ...)` — static factory validation, including snapshot tampering rejection.
- `describe("ManagedDerivationPremiseEngine mutation enforcement", ...)` — each rule in the table; test each mutation method including `normalizeExpressions` and `loadExpressions`.
- `describe("ManagedDerivationPremiseEngine populateFromCitations", ...)` — n=0/1/2+ shapes; non-empty antecedent rejection; non-recursive behavior; new variable creation for cited claims.
- `describe("ArgumentEngine validateEvaluability with derivation pre-flight", ...)` — derivation broken → violations; well-formed → no violations. Verify both `evaluate` and `checkValidity` flag the same violations.
- `describe("ArgumentEngine.validateDerivationStructures", ...)` — public method exposes the derivation-specific subset.
- `describe("Multiple derivation premises for the same claim", ...)` — verify plurality is allowed; verify per-premise evaluation is independent.
- `describe("iff as derivation root", ...)` — verify both directions of propagation work; verify the consequent slot rule still applies; verify the documented two-way semantics.
- `describe("Naked-Q derivation and collapseEmptyFormula", ...)` — verify that with the flag enabled, antecedent stripping collapses correctly to naked Q; with the flag disabled, the intermediate state fails pre-flight until manually fixed (recovery via `addExpression`).
- `describe("Fork integration with derivation premises", ...)` — verify forking propagates `type` and `derivedClaimId` to the forked premise.

Update existing tests that constructed premises positionally — the typed-bag overload should maintain backward compatibility, but verify with explicit assertions.

### Smoke test (`scripts/smoke-test.sh`)

Add a new section exercising:

- Creating a derivation premise via `premises add --type=derivation --derived-claim=<id>`.
- Populating from citations.
- Evaluation success/failure paths.
- Migration coverage (write pre-v0.11 state, run CLI, verify migration completes).

### Examples (`examples/arguments/`)

Add or update one example argument YAML to demonstrate a derivation premise. `test/examples.test.ts` validates that examples parse and evaluate.

## Implementation order

Recommended split into two PRs to keep each reviewable:

**PR1 — schema, validation utility, managed engine (no integration)**:

1. **Premise schema discriminator** (`src/lib/schemata/propositional.ts`):
    - Add discriminated union; update `TCorePremise` type alias.
2. **Validation utility** (`src/lib/utils/derivation-validation.ts`):
    - Implement standalone validation function. Unit-test in isolation.
3. **PremiseEngine visibility refactor** (`src/lib/core/premise-engine.ts`):
    - Identify exact 5 fields/helpers to widen from `private` to `protected`.
4. **ManagedDerivationPremiseEngine** (`src/lib/core/managed-derivation-premise-engine.ts`):
    - Constructor with validation.
    - Static `fromSnapshot` factory.
    - Override mutation methods (incl. `normalizeExpressions`, `loadExpressions`) with derivation rule enforcement.
    - `populateFromCitations` helper (depends on `ensureClaimBoundVariable` from PR2; either land that API in PR1 or stub the helper).
5. **Constants, types** (`src/lib/consts.ts`, `src/lib/types/validation.ts`):
    - Add `"type"`/`"derivedClaimId"` to `premiseFields`. Add new error codes.
6. **Public exports** (`src/lib/index.ts`):
    - Re-export `ManagedDerivationPremiseEngine`.

**PR2 — ArgumentEngine integration, CLI, migration, tests**:

7. **ArgumentEngine API additions**:
    - `ensureClaimBoundVariable` public method.
    - `validateDerivationStructures` public method.
    - Extend `validateEvaluability` with derivation pre-flight.
8. **createPremise + createPremiseWithId signature change**:
    - Typed-bag with backward-compat overload.
    - Derivation premise creation flow (variable creation, naked Q initialization, claim lookup).
    - Fork integration: propagate `type`/`derivedClaimId` in `forkArgument`.
9. **Interfaces**:
    - JSDoc updates across argument-engine, premise-engine, library interfaces.
10. **CLI**:
    - New CLI commands for derivation premise creation and citation population.
    - Render output updates.
    - `storage/migrate-v0.11.ts` for one-time premise type migration with `.proposit-v0.11` marker.
11. **Tests** (`test/core.test.ts`):
    - Add new describe blocks per the inventory.
    - Verify backward-compat behavior of `createPremise`/`createPremiseWithId` overloads against existing test fixtures.
12. **Smoke test** (`scripts/smoke-test.sh`):
    - Add derivation premise smoke section + migration coverage.
13. **Examples** (`examples/arguments/`):
    - Add or update example with derivation premise.
14. **Documentation**:
    - All files in the "Documentation updates" section below.
15. **Version bump and tag**:
    - `pnpm version minor` to v0.11.0.
    - Rename `docs/release-notes/upcoming.md` → `v0.11.0.md`; rename `docs/changelogs/upcoming.md` → `v0.11.0.md`. Start fresh `upcoming.md` files.
    - Tag `v0.11.0`.

Total estimated touch sites: ~1500-2500 LOC across ~25 files. Splitting into PR1 + PR2 keeps each PR in the 800-1200 LOC range, which is reviewable.

## Documentation updates

Per the `Documentation Sync` section of `CLAUDE.md`:

- `README.md` — add Concepts section explaining derivation premises; update Public CLI API; update "Invalid Constructions" to include derivation rules.
- `docs/api-reference.md` — full API for `ManagedDerivationPremiseEngine`, new `createPremise`/`createPremiseWithId` signatures (overload), `validateDerivationStructures`, `ensureClaimBoundVariable`, new error codes.
- `CLAUDE.md` — design rules: premise type discriminator and immutability, derivation premise structure, ManagedDerivationPremiseEngine, evaluation pre-flight via `validateEvaluability`, the `collapseEmptyFormula` flag dependency for naked-Q semantics, the `iff` two-way propagation note, the `ensureClaimBoundVariable` API.
- `CLI_EXAMPLES.md` — walkthrough demonstrating derivation premise creation and citation population.
- `scripts/smoke-test.sh` — derivation smoke section (also a code change).
- `src/lib/core/interfaces/argument-engine.interfaces.ts` — JSDoc updates.
- `src/lib/core/interfaces/premise-engine.interfaces.ts` — JSDoc updates.
- `src/lib/core/proposit-core.ts` — JSDoc.
- `src/lib/core/argument-engine.ts` — JSDoc on `createPremise`, `createPremiseWithId`, `evaluate`, `checkValidity`, `validateDerivationStructures`, `ensureClaimBoundVariable`.
- `src/lib/core/managed-derivation-premise-engine.ts` — comprehensive JSDoc on the new class.
- `examples/arguments/*.yaml` — at least one example demonstrating derivation premises.
- `docs/release-notes/upcoming.md` — user-facing release notes for v0.11.0; explain the derivation premise type, the managed engine, the `populateFromCitations` workflow, the `ensureClaimBoundVariable` API, the `createPremise` signature change (with overload notice).
- `docs/changelogs/upcoming.md` — developer changelog with commit hash ranges.

## Decisions deferred to the implementation plan

- **Exact list of fields/helpers in `PremiseEngine` to widen from `private` to `protected`.** Expected to be ~5 fields; final list determined by what `ManagedDerivationPremiseEngine` actually accesses.
- **Symbol-assignment policy for `ensureClaimBoundVariable`.** The default behavior uses the existing `generateUniqueSymbol` private helper; the API may optionally accept a `symbol` override parameter. Plan decides.
- **File path for the validation utility** (`src/lib/utils/derivation-validation.ts` or alternative location consistent with existing utility conventions in the codebase).
- **Whether `populateFromCitations` accepts a `merge` option** to combine new sources with an existing antecedent rather than rejecting non-empty state. Default rejects; plan decides whether to ship the merge mode in this release or defer.
- **CLI command surface for derivation premises**. The spec sketches `premises add --type=derivation --derived-claim=<id>` and `premises populate-citations <premiseId>` but the exact command shape, flag names, and output format are plan-level.
- **Backward-compat overload vs. clean break for `createPremise` and `createPremiseWithId`.** The spec recommends the overload to preserve ~50 call sites; if the maintainers prefer a clean break, the plan absorbs the test churn explicitly.

## Future work (out of scope)

- **Axiomatic claims** — a third claim type for "true by definition / common knowledge / etc." derivations. The `iff` allowance in derivation roots was added with this in mind; the design here doesn't define or preclude it. Will be its own brainstorming session and spec.
- **Per-argument citation overrides** — whether a specific argument can locally exclude or add citations beyond the global library. Out of scope; users who want this can author derivation antecedents directly without routing through `populateFromCitations`.
- **Drift comparison API** — comparing a derivation premise's antecedent against the current global citations. Versioning already provides time-pinned semantics; consumers can compute the comparison with public APIs if they want UX nudges. Not included in this release.
