# API Reference

## `ArgumentEngine`

### `new ArgumentEngine(argument, claimLibrary, claimCitationLibrary, options?)`

Creates an engine scoped to `argument` (`{ id, version, title, description }`, without `checksum` — it is computed lazily). Requires a `claimLibrary` implementing `TClaimLookup` (used to validate claim references on variables) and a `claimCitationLibrary` implementing `TClaimConnectionLookup<TCitation>` (the global claim-citation graph; the parameter type narrowed to the generic connection lookup in v0.12.0). As of v0.10.0 the previously separate `sourceLibrary` and `claimSourceLibrary` are gone — sources are now claims with `type: 'citation'` and live in the unified `ClaimLibrary`. Accepts an optional `config?: TLogicEngineOptions` parameter with `checksumConfig?: TCoreChecksumConfig` (configures which fields are included in entity checksums) and `positionConfig?: TCorePositionConfig` (configures the position range for expression ordering — defaults to signed int32: `[-2147483647, 2147483647]` with initial `0`). `TLogicEngineOptions` is the universal config type accepted by all engine/manager classes.

---

### `createPremise(options?)` → `TCoreMutationResult<PremiseEngine>`

Creates a new `PremiseEngine`, registers it with the engine, and returns it wrapped in a mutation result with the changeset. If no conclusion is currently set, the new premise is automatically designated as the conclusion (reflected in the changeset's `roles` field).

Also auto-creates a premise-bound variable for the new premise, included in the changeset's `variables.added`.

**Typed-bag form (preferred since v0.11.0):**

```typescript
engine.createPremise({
    type: "freeform" | "derivation", // default: "freeform"
    derivedClaimId: string, // required when type === "derivation"
    extras: Record<string, unknown>, // optional extension fields
    symbol: string, // optional auto-created variable symbol
})
```

When `type === "derivation"`, the engine looks up `derivedClaimId` in the claim library, materializes a claim-bound variable for it via `ensureClaimBoundVariable` (if one does not already exist), and initializes the expression tree to **naked-Q form** — a single variable expression at the root referencing the consequent.

**Legacy positional form (still supported for backward compatibility):**

```typescript
engine.createPremise(extras?, symbol?)  // always creates a freeform premise
```

Throws:

- `CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID` — when `type === "derivation"` and `derivedClaimId` is absent.
- `CREATE_DERIVATION_CLAIM_NOT_FOUND` — when `type === "derivation"` and the claim is not in the library.

---

### `createPremiseWithId(id, options?)` → `TCoreMutationResult<PremiseEngine>`

Same as `createPremise` but accepts an explicit `id` as the first argument instead of generating one. Mirrors `createPremise` in both typed-bag and legacy positional forms. Throws if a premise with the given ID already exists.

---

### `ensureClaimBoundVariable(claimId)` → `TClaimBoundVariable`

Idempotent lookup-or-create for a claim-bound variable. If a claim-bound variable for `claimId` already exists in this argument, it is returned as-is. Otherwise a new variable is created with a fresh UUID, the current version of the claim from the `ClaimLibrary`, and an auto-generated symbol (`"P0"`, `"P1"`, ...) with collision avoidance.

Used internally by derivation premise initialization but also available to callers that need to pin a claim as a propositional variable without creating a full premise.

Throws `CLAIM_NOT_FOUND` when `claimId` is not present in the claim library.

_Since v0.11.0._

---

### `validateDerivationStructures()` → `TInvariantValidationResult`

Returns the derivation-specific subset of `validateEvaluability` checks. Only `type: "derivation"` premises are inspected; freeform premises are ignored. Useful for pre-checking derivation structure before entering the full evaluation pipeline, without requiring a conclusion or complete role state.

In v1.0 this method's checks have been folded into the four-tier grammar — derivation-premise shape lives at the Derivable tier (D-1..D-6) and naked-Q is a **valid Derivable state** (no longer a `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` throw). For new code, prefer `engine.validate('derivable')` and filter the returned `TViolation[]` by `code` starting with `D-`. The `validateDerivationStructures()` wrapper is retained for backwards compatibility.

---

### `removePremise(premiseId)` → `TCoreMutationResult<TCorePremise>`

Removes a premise and clears its role assignments. Also cascade-deletes any premise-bound variables targeting the removed premise (which in turn cascade-deletes their referencing expressions). Returns the removed premise data.

---

### `getPremise(premiseId)` → `PremiseManager | undefined`

Returns the `PremiseEngine` for the given ID, or `undefined`.

---

### `hasPremise(premiseId)` → `boolean`

Returns `true` if a premise with the given ID exists.

---

### `listPremises()` → `PremiseManager[]`

Returns all premises sorted by ID.

---

### `listPremiseIds()` → `string[]`

Returns all premise IDs sorted alphabetically.

---

### `addVariable(variable)` → `TCoreMutationResult<TPropositionalVariable>`

Registers a claim-bound variable (without `checksum` — it is computed lazily) for use across all premises. The variable must include `claimId: string` and `claimVersion: number` fields referencing a valid entry in the `ClaimLibrary`. Throws if the `id` or `symbol` already exists, if `argumentId`/`argumentVersion` don't match the engine's argument, or if the claim reference is not found in the claim library. Only accepts claim-bound variables — use `bindVariableToPremise` for premise-bound variables.

---

### `bindVariableToPremise(variable)` → `TCoreMutationResult<TPropositionalVariable>`

Registers a premise-bound variable whose truth value is derived from another premise's evaluation. The variable must include `boundPremiseId`, `boundArgumentId`, and `boundArgumentVersion` fields. Throws if the `id` or `symbol` already exists, if `boundPremiseId` does not reference an existing premise, if `boundArgumentId` does not match this argument, or if binding would create a circular dependency.

Premise-bound variables are resolved lazily during evaluation: the bound premise is evaluated first, and its root value becomes the variable's truth value. If the bound premise is empty, the variable resolves to `null` (unknown). Circularity detection is transitive — if premise A's variable Q is bound to premise B, and premise B uses a variable R bound to premise A, the binding is rejected.

---

### `bindVariableToExternalPremise(variable)` → `TCoreMutationResult<TPropositionalVariable>`

Registers a premise-bound variable that references a premise in a **different** argument. The variable must include `boundPremiseId`, `boundArgumentId`, and `boundArgumentVersion` fields, where `boundArgumentId` does NOT match this engine's argument (use `bindVariableToPremise` for internal bindings). Calls `canBind(boundArgumentId, boundArgumentVersion)` for validation.

External bindings are evaluator-assigned during evaluation — they are NOT lazily resolved. They appear as free variables in truth-table generation (like claim-bound variables). The binding is navigational: it tells the reader where the proposition is defined, but the evaluator assigns the truth value.

---

### `bindVariableToArgument(variable, conclusionPremiseId)` → `TCoreMutationResult<TPropositionalVariable>`

Convenience method for binding a variable to another argument's conclusion. Sets `boundPremiseId` to the provided `conclusionPremiseId` and delegates to `bindVariableToExternalPremise`. The caller resolves the conclusion premise ID from their knowledge of the target argument.

---

### `canBind(boundArgumentId, boundArgumentVersion)` → `boolean` _(protected)_

Returns whether this engine allows binding to the specified external argument version. Default returns `true`. Override in subclasses to inject validation policy (e.g., only allow binding to published argument versions). Called by `bindVariableToExternalPremise` before registration; throws if `false`.

---

### `getVariablesBoundToPremise(premiseId)` → `TPropositionalVariable[]`

Returns all premise-bound variables whose `boundPremiseId` matches the given premise ID. This is a linear scan over all variables.

---

### `updateVariable(variableId, updates)` → `TCoreMutationResult<TPropositionalVariable>`

Updates variable fields. For claim-bound variables, allowed updates are `symbol`, `claimId`, `claimVersion` (`claimId` and `claimVersion` must be provided together). For premise-bound variables, allowed updates are `symbol`, `boundPremiseId`, `boundArgumentId`, `boundArgumentVersion`. Throws if updates include fields from the wrong binding type. Returns a mutation result with the modified variable.

---

### `removeVariable(variableId)` → `TCoreMutationResult<TPropositionalVariable>`

Removes the variable and cascade-deletes all expressions referencing it across every premise (including subtree deletion and operator collapse). Returns a mutation result with the removed variable.

---

### `getVariables()` → `TPropositionalVariable[]`

Returns all registered variables sorted by ID, with checksums.

---

### `getVariable(variableId)` → `TPropositionalVariable | undefined`

Returns a variable by ID in O(1) time, or `undefined` if not found.

---

### `hasVariable(variableId)` → `boolean`

Returns `true` if a variable with the given ID exists. O(1).

---

### `getVariableBySymbol(symbol)` → `TPropositionalVariable | undefined`

Returns the variable with the given symbol in O(1) time, or `undefined` if no variable has that symbol.

---

### `buildVariableIndex(keyFn)` → `Map<K, TVar>`

Builds a `Map` keyed by a caller-supplied function over all variables. Useful for indexing by extension fields (e.g. `statementId`). The caller should cache the result — this is O(n) per call.

```typescript
// Example: index variables by a custom extension field
const byStatementId = engine.buildVariableIndex((v) => v.statementId)
```

---

### `getExpression(expressionId)` → `TPropositionalExpression | undefined`

Returns an expression by ID from any premise in O(1) time. Uses the shared expression index internally.

---

### `hasExpression(expressionId)` → `boolean`

Returns `true` if an expression with the given ID exists in any premise. O(1).

---

### `getExpressionPremiseId(expressionId)` → `string | undefined`

Returns the ID of the premise containing the given expression, or `undefined`. O(1).

---

### `findPremiseByExpressionId(expressionId)` → `PremiseEngine | undefined`

Returns the `PremiseEngine` instance that contains the given expression, or `undefined`. O(1).

---

### `getAllExpressions()` → `TPropositionalExpression[]`

Returns all expressions across all premises, sorted by ID.

---

### `getExpressionsByVariableId(variableId)` → `TPropositionalExpression[]`

Returns all expressions that reference the given variable ID, across all premises.

---

### `listRootExpressions()` → `TPropositionalExpression[]`

Returns the root expression from each premise that has one.

---

### `setConclusionPremise(premiseId)` → `TCoreMutationResult<TCoreArgumentRoleState>`

Designates a premise as the conclusion. Throws if the premise does not exist.

---

### `clearConclusionPremise()` → `TCoreMutationResult<TCoreArgumentRoleState>`

Removes the conclusion role assignment.

---

### `getConclusionPremise()` → `PremiseManager | undefined`

Returns the conclusion `PremiseEngine`, if one has been set.

---

### `listSupportingPremises()` → `PremiseManager[]`

Returns all supporting premises (derived automatically: inference premises that are not the conclusion), sorted by ID.

---

### `getRoleState()` → `TCoreArgumentRoleState`

Returns `{ conclusionPremiseId? }`. Supporting premises are derived from expression type, not stored in role state.

---

### `collectReferencedVariables()`

Returns a cross-premise summary of every variable referenced by expressions, keyed by `id` and `symbol`.

---

### `validateEvaluability()` → `TValidationResult`

Checks whether the argument is structurally ready to evaluate. Returns `{ ok, issues }`. The sweep includes a derivation premise pre-flight: every `type: "derivation"` premise is checked against the Derivable-tier rules (D-1..D-6 — see `docs/Proposit_Grammar.md` §3.3). **Naked-Q derivation premises are valid in v1.0** and are skipped by `evaluate()` / `checkValidity()` rather than being rejected (this replaces the pre-1.0 `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` throw). Use `validateDerivationStructures()` to isolate derivation checks, or prefer `engine.validate('derivable')` for the full Derivable-tier violation list.

As of v0.12.0, `evaluate()` and `checkValidity()` additionally run a claim-type pre-pass on their assignment input. If the assignment contains an entry for a claim-bound variable whose bound claim has `type === "axiomatic"`, the call is rejected with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` before any evaluation work runs. This is enforced inside `ArgumentEngine` (not in the standalone evaluator), so the structural `TArgumentEvaluationContext` interface is unchanged. As of v0.12.1, key presence is checked via `Object.hasOwn`, so an explicit `undefined` value in the assignment map is rejected too.

---

### `evaluate(assignment, options?)` → `TArgumentEvaluationResult`

Evaluates all relevant premises under the given expression assignment (`TCoreExpressionAssignment`). The assignment contains `variables` (a `Record<string, boolean | null>`) and `operatorAssignments` (a `Record<string, "accepted" | "rejected">` mapping operator expression IDs to their override state — `"accepted"` propagates constraints to unknown variables, `"rejected"` forces `false` with children skipped, absent means normal evaluation). Returns per-premise truth values, counterexample status, and an admissibility flag.

Claim-type-aware pre-pass (v0.12.0): before delegating to the standalone evaluator, `ArgumentEngine.evaluate` walks all claim-bound variables. If the caller's assignment includes any entry (as determined by `Object.hasOwn`) for any axiomatic-bound variable, evaluation aborts with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`. Otherwise the engine builds an effective assignments map: caller entries unchanged, plus a forced `true` for every axiomatic-bound variable. Citation- and normal-bound variables continue to behave exactly as today (caller assigns; unassigned → `null`).

Options:

- `validateFirst` (default `true`) — run validation before evaluating.
- `includeExpressionValues` (default `true`) — include per-expression truth maps.
- `includeDiagnostics` (default `true`) — include inference diagnostics.
- `strictUnknownAssignmentKeys` (default `false`) — reject assignment keys not referenced by evaluated premises.

---

### `checkValidity(options?)` → `TValidityCheckResult`

Runs a truth-table search over all 2ⁿ assignments (n = distinct referenced variable count). Returns `isValid` (`true`, `false`, or `undefined` if truncated), counterexamples, and statistics.

Claim-type-aware enumeration (v0.12.0): the variable enumeration set excludes claim-bound variables whose bound claim has `type === "axiomatic"`. Their value is fixed at `true` and they are not a free choice. Citation-bound variables remain in the enumeration set (they are free choices for validity-check purposes, same as normal variables). Counts (`numAdmissibleAssignments`, counterexample search space) are computed against the reduced enumeration set, so an argument with `k` claim-bound variables of which `a` are axiomatic enumerates `2^(k - a)` assignments rather than `2^k`. Each generated assignment also implicitly fixes axiomatic-bound variables to `true` via the same pre-pass that `evaluate()` runs.

Options:

- `mode` (`"firstCounterexample"` | `"exhaustive"`, default `"firstCounterexample"`) — stop at first counterexample or continue exhaustively.
- `maxVariables` — safety limit on the number of variables.
- `maxAssignmentsChecked` — safety limit on the number of assignments evaluated.
- `includeCounterexampleEvaluations` (default `false`) — attach full evaluation payloads to counterexamples.
- `validateFirst` (default `true`) — run validation before the search.

---

### `getExtras()` → `Record<string, unknown>`

Returns the argument's extra metadata (all fields except `id`, `version`, and checksums).

---

### `setExtras(extras)` → `TCoreMutationResult<Record<string, unknown>>`

Replaces all extra metadata on the argument. Structural fields (`id`, `version`, checksums) are preserved and cannot be overwritten. Returns the new extras and a changeset with the updated argument in `changes.argument`.

---

### `updateExtras(updates)` → `TCoreMutationResult<Record<string, unknown>>`

Shallow-merges `updates` into the existing extras. Equivalent to `setExtras({ ...getExtras(), ...updates })`. Returns the merged extras and a changeset with the updated argument.

---

### `subscribe(listener)` → `() => void`

Registers a listener that is called synchronously after every mutation (including mutations through child `PremiseEngine` instances). Returns an unsubscribe function. Compatible with React's `useSyncExternalStore`.

---

### `getSnapshot()` → `TReactiveSnapshot`

Returns a `TReactiveSnapshot` with structurally-shared sub-objects. Unchanged slices keep the same object reference between calls, enabling fine-grained React selectors via `useSyncExternalStore`. The snapshot is lazily rebuilt only when dirty regions exist.

---

### `snapshot()` → `TArgumentEngineSnapshot`

Returns a serialisable snapshot of the full engine state (`{ argument, variables, premises, conclusionPremiseId, config }`). Each premise snapshot includes its metadata and expression snapshot. Can be used to reconstruct the engine via `ArgumentEngine.fromSnapshot()` or to restore state in place via `rollback()`.

---

### `static fromSnapshot(snapshot, claimLibrary, checksumVerification?, generateId?)` → `ArgumentEngine`

Reconstructs an `ArgumentEngine` from a previously captured snapshot. Requires the same `claimLibrary` (implementing `TClaimLookup`) that would be passed to the constructor. Creates a `VariableManager` from the snapshot's variable data, then passes it as a dependency to each `PremiseEngine.fromSnapshot()`. **Accepts any Structural-valid snapshot** — lower-tier violations (Evaluable, Derivable, Presentable) are queryable post-load via `engine.validate(tier)` rather than rejected at load time. Truly broken (non-Structural) snapshots throw `InvariantViolationError`. The optional `checksumVerification` (`"ignore" | "strict"`) controls whether stored checksums are verified or ignored on load; the optional `generateId` overrides the snapshot's persisted ID generator.

> `behavior` is intentionally not serialized into the snapshot — a restored engine defaults to `'assistive'`. The fork path (`forkArgumentEngine` / `PropositCore.forkArgument`) threads the source engine's `behavior` through explicitly so fork callers don't lose the setting. Non-fork callers may pass an explicit `behavior` via `setBehavior()` after restoration.

---

### `validate()` → `TInvariantValidationResult`

Runs a comprehensive invariant validation sweep on the entire argument. Delegates to `VariableManager.validate()` and each `PremiseEngine.validate()` (which delegates to `ExpressionManager.validate()`), then checks argument-level invariants: schema conformance, argument ownership on all entities, claim-bound variable references, internal premise-bound variable references, circularity detection, conclusion premise existence, and checksum consistency. Returns `{ ok: boolean, violations: TInvariantViolation[] }`. Called automatically after every mutation via the `withValidation` bracket — can also be called explicitly at any time.

---

### `rollback(snapshot)` → `void`

Restores the engine's internal state in place from a previously captured snapshot. Validates the restored state at the Structural tier; if Structural validation fails, the pre-rollback state is restored and `InvariantViolationError` is thrown. Equivalent to reconstructing via `fromSnapshot` but mutates the existing instance (preserving references held by callers).

---

### `static fromData(argument, claimLibrary, variables, premises, expressions, roles, config?, checksumVerification?)` → `ArgumentEngine`

Bulk-loads an engine from flat arrays (as returned by DB queries). Requires a `claimLibrary` (implementing `TClaimLookup`). Groups expressions by `premiseId`, creates a shared `VariableManager`, creates each `PremiseEngine` with its expressions loaded in BFS order, and sets roles. Generic type parameters are inferred from the arguments. Accepts any **Structural-valid** input; throws `InvariantViolationError` on Structural failures. Lower-tier violations are queryable post-load via `engine.validate(tier)`.

---

### `canFork()` → `boolean` _(public)_

Returns whether this argument may be forked. Default implementation returns `true`. Override in subclasses to inject validation policy (e.g., only allow forking published arguments). Called by `PropositCore.forkArgument()` and `forkArgumentEngine()` before any work; throws if `false`.

---

## `PropositCore`

Top-level orchestrator that owns all five libraries and provides unified snapshot/restore, validation, and cross-library operations. Recommended entry point for new applications.

### `new PropositCore(options?)`

Creates a new `PropositCore` instance. All libraries are constructed automatically in dependency order (claims → citations → axioms → forks → arguments). Pass a `TPropositCoreOptions` object to inject pre-constructed library instances or shared configuration (`checksumConfig`, `positionConfig`, `behavior`).

Public library fields (v0.12.0 — all single-word nouns):

- `core.claims` — `ClaimLibrary`
- `core.citations` — `ClaimCitationLibrary` (renamed from `claimCitations` in v0.12.0)
- `core.axioms` — `ClaimAxiomLibrary` (new in v0.12.0)
- `core.forks` — `ForkLibrary`
- `core.arguments` — `ArgumentLibrary`

As of v0.10.0 the previously separate `sources` and `claimSources` libraries are gone — sources are now claims with `type: 'citation'` and the citation graph lives in `core.citations`. As of v0.12.0 `core.axioms` holds an analogous graph for axiomatic claims (see `ClaimAxiomLibrary` below).

---

### `forkArgument(argumentId, newArgumentId, options?)` → `{ engine, remapTable, claimRemap, argumentFork }`

Full fork orchestration:

1. Retrieves the source engine from `ArgumentLibrary`; calls `engine.canFork()`.
2. Walks the combined citation + axiom connection graph from the source engine's claim-bound variables — a single BFS that consults `core.citations.getConnectionsForClaim` and `core.axioms.getConnectionsForClaim` at each frontier pop. Computes the closure of claims that must be cloned (`'normal'`, `'citation'`, and `'axiomatic'`). The unified BFS guarantees that axioms reachable via multi-hop citation paths (and vice versa) end up in the closure — important for cases like "normal claim B is cited by normal claim C, and B is also axiom-backed; forking C clones B and the backing axiom."
3. Clones every claim in the closure into the unified `ClaimLibrary`.
4. Clones every citation connection whose dependent endpoint is in the closure into `ClaimCitationLibrary`, remapping both endpoints. Cloned connections pin `claimVersion: 0` / `supportingClaimVersion: 0`.
5. Clones every axiom connection whose dependent endpoint is in the closure into `ClaimAxiomLibrary`, with the same remapping and version-pin behavior.
6. Forks the engine via `forkArgumentEngine()` with new UUIDs.
7. Remaps variable claim references to point at the cloned claims.
8. Registers the forked engine in `ArgumentLibrary`.
9. Creates fork records in all five `ForkLibrary` namespaces.

Options extend `TForkArgumentOptions` with per-namespace extras (`argumentForkExtras`, `premiseForkExtras`, `expressionForkExtras`, `variableForkExtras`, `claimForkExtras`) and an optional `forkId`.

Returns:

- `engine` — the new `ArgumentEngine`
- `remapTable` — `TForkRemapTable` mapping original entity IDs to new IDs
- `claimRemap` — `Map<string, string>` mapping original claim IDs to cloned claim IDs (covers `'normal'`, `'citation'`, and `'axiomatic'` claims)
- `argumentFork` — the created `TArgFork` record

> The legacy `sourceRemap` field is gone — citation-typed claims are remapped through `claimRemap` alongside normal claims, since sources are no longer a separate entity type. Axiomatic claims also ride in `claimRemap` — there is no separate `axiomRemap`.

---

### `diffArguments(argumentIdA, argumentIdB, options?)` → `TCoreArgumentDiff`

Computes a structural diff between two managed arguments. Automatically injects fork-aware entity matchers derived from `ForkLibrary` records — when argument B is a fork of argument A, entities are paired by fork provenance rather than by ID. Caller-provided matchers in `options` take precedence over the fork-aware defaults.

---

### `snapshot()` → `TPropositCoreSnapshot`

Returns a serializable snapshot of the entire system state (all five libraries: `claims`, `citations`, `axioms`, `forks`, `arguments`). The snapshot slot for citations renamed from `claimCitations` to `citations` in v0.12.0; the new `axioms` slot was added in the same version.

---

### `static fromSnapshot(snapshot, config?)` → `PropositCore`

Restores a `PropositCore` from a snapshot. Libraries are restored in dependency order. Performs unknown-typed pre-checks before any typed coercion: throws `LEGACY_MISSING_AXIOM_SLOT` when the `axioms` slot is absent, and throws `LEGACY_CLAIM_CITATION_SHAPE` when the snapshot still uses the legacy `claimCitations` wrapper key. Both signal that the v0.12 CLI migration must run before non-CLI consumers can load the snapshot.

---

### `validate()` → `TInvariantValidationResult`

Runs invariant validation across all five libraries and merges the results.

---

## `ArgumentLibrary`

Engine registry with lifecycle management. Stores `ArgumentEngine` instances keyed by argument ID. Constructed and wired by `PropositCore`, but can be used standalone.

### `new ArgumentLibrary(libraries, options?)`

Creates an empty library. `libraries` must include `claimLibrary` and `claimCitationLibrary`. `options` is the shared `TLogicEngineOptions` applied to all created engines.

---

### `create(argument)` → `ArgumentEngine`

Constructs a new `ArgumentEngine` for the given argument (without `checksum` — it is computed lazily) and stores it. Throws if an engine with the same argument ID already exists.

---

### `register(engine)` → `void`

Stores a pre-built `ArgumentEngine` in the library. Used internally by `PropositCore.forkArgument()` after forking. Throws if an engine with the same argument ID already exists.

---

### `get(argumentId)` → `ArgumentEngine | undefined`

Returns the engine for the given ID, or `undefined`.

---

### `getAll()` → `ArgumentEngine[]`

Returns all managed engines.

---

### `remove(argumentId)` → `ArgumentEngine`

Removes and returns the engine for the given ID. Throws if not found.

---

### `snapshot()` → `TArgumentLibrarySnapshot`

Returns a serializable snapshot containing all engine snapshots.

---

### `validate()` → `TInvariantValidationResult`

Merges invariant validation results from all managed engines.

---

### `static fromSnapshot(snapshot, libraries, options?)` → `ArgumentLibrary`

Restores an `ArgumentLibrary` from a snapshot by calling `ArgumentEngine.fromSnapshot()` for each engine snapshot.

---

## `ForkLibrary`

Unified store for fork provenance records, organized into five namespaces. Fork records are immutable after creation and carry no checksums.

### `new ForkLibrary()`

Creates an empty library with five `ForkNamespace` instances:

- `forks.arguments` — argument fork records (`TCoreArgumentForkRecord`)
- `forks.premises` — premise fork records (`TCorePremiseForkRecord`)
- `forks.expressions` — expression fork records (`TCoreExpressionForkRecord`)
- `forks.variables` — variable fork records (`TCoreVariableForkRecord`)
- `forks.claims` — claim fork records (`TCoreClaimForkRecord`)

As of v0.10.0 the legacy `forks.sources` namespace is gone — citation-typed claims now travel through `forks.claims` alongside normal claims.

---

### `snapshot()` → `TForkLibrarySnapshot`

Returns a serializable snapshot of all five namespaces. Pre-v0.10.0 snapshots that contained a `sources` namespace are not supported by `fromSnapshot`; callers must convert them via the CLI migration before invoking `fromSnapshot`. Any stray `sources` key on an input snapshot is silently ignored.

---

### `static fromSnapshot(snapshot)` → `ForkLibrary`

Restores a `ForkLibrary` from a snapshot.

---

### `validate()` → `TInvariantValidationResult`

Validates all fork records across all five namespaces.

---

## `ForkNamespace<T>`

Standalone reusable class for managing fork records of a single entity type. Keyed by `entityId`.

### `new ForkNamespace(schema?)`

Creates an empty namespace. Accepts an optional Typebox schema for validation (defaults to `CoreEntityForkRecordSchema`).

---

### `create(record)` → `T`

Stores a fork record. Throws if a record with the same `entityId` already exists.

---

### `get(entityId)` → `T | undefined`

Returns the fork record for the given entity ID.

---

### `getAll()` → `T[]`

Returns all fork records.

---

### `getByForkId(forkId)` → `T[]`

Returns all records belonging to the given fork operation.

---

### `remove(entityId)` → `T`

Removes and returns the fork record for the given entity ID. Throws if not found.

---

### `snapshot()` → `T[]`

Returns all records as an array.

---

### `static fromSnapshot(records, schema?)` → `ForkNamespace<T>`

Restores a namespace from an array of records.

---

### `validate()` → `TInvariantValidationResult`

Validates all records against the namespace schema.

---

## `forkArgumentEngine(engine, newArgumentId, libraries, options?)` → `{ engine, remapTable }`

Standalone low-level function for argument forking without fork record management or claim cloning. Creates an independent copy of the source engine with new UUIDs for all entities. Internal references (expression `parentId`, `premiseId`, `variableId`, premise-bound variable `boundPremiseId`, conclusion role) are remapped to the new IDs. Does NOT set `forkedFrom*` fields on entities (those fields were removed from entity schemas) and does NOT create fork records — use `PropositCore.forkArgument()` for full orchestration. The forked engine starts at version `0`.

- `engine` — the source `ArgumentEngine`
- `newArgumentId` — ID for the new argument
- `libraries` — `{ claimLibrary, claimCitationLibrary }` for the new engine
- `options?` — `TForkArgumentOptions`

Returns `{ engine, remapTable }` where `engine` is the new `ArgumentEngine` and `remapTable` maps original entity IDs to their forked counterparts.

Options (`TForkArgumentOptions`):

- `generateId?: () => string` — custom ID generator (defaults to `crypto.randomUUID`)
- `checksumConfig?: TCoreChecksumConfig` — override checksum config (defaults to source's config)
- `positionConfig?: TCorePositionConfig` — override position config (defaults to source's config)
- `behavior?: "assistive" | "permissive"` — override the forked engine's behavior (defaults to the source engine's behavior)

---

### `toDisplayString()` → `string`

Renders the full argument as a multi-line string. Each premise is prefixed with its role label (`[Conclusion]`, `[Supporting]`, or `[Constraint]`) followed by the premise's `toDisplayString()` output.

---

## `ClaimCitationLibrary<TCitation>`

Global standalone repository for citation connections between claims (renamed from `ClaimSourceLibrary` in v0.10.0; renamed terminology and field set in v0.12.0). Implements the generic `TClaimConnectionLibraryManagement<TCitation>` interface (which extends `TClaimConnectionLookup<TCitation>`). A citation is a directed support edge `(claimId@claimVersion → supportingClaimId@supportingClaimVersion)` in the global claim-citation graph. Create-or-delete only — no update path.

Pass an instance to `ArgumentEngine` constructor (and `fromSnapshot`) as the third parameter; on `PropositCore` it lives at `core.citations`.

> **Renamed in v0.12.0.** The previous edge-endpoint vocabulary (`citingClaimId`/`citingClaimVersion`/`sourceClaimId`/`sourceClaimVersion`) was renamed to the generic connection vocabulary (`claimId`/`claimVersion`/`supportingClaimId`/`supportingClaimVersion`). The reverse-lookup method `getCitationsForSourceClaim` was removed (no production callers); `getCitationsForCitingClaim` was renamed to `getConnectionsForClaim`. The snapshot wrapper field renamed from `claimCitations` to `connections`.

### `new ClaimCitationLibrary(claimLookup, options?)`

Creates an empty library. Takes a single `claimLookup` (implementing `TClaimLookup`) — both endpoints of every citation reference the unified claim library. Accepts an optional `{ checksumConfig? }` parameter.

---

### `add(citation)` → `TCitation`

Adds a new citation connection (without `checksum` — it is computed automatically). The `citation` parameter is `Omit<TCitation, "checksum">`. Validates:

- Both `claimId@claimVersion` and `supportingClaimId@supportingClaimVersion` resolve in the claim lookup (`CITATION_CLAIM_REF_NOT_FOUND`, `CITATION_SUPPORTING_REF_NOT_FOUND`).
- The supporting-side claim has `type: 'citation'` (`CITATION_SUPPORTING_NOT_CITATION_TYPE`).
- The citation does not introduce a cycle in the global claim-citation graph (`CITATION_CYCLE_DETECTED`). Cycle detection is ID-only — versions don't disambiguate.
- No citation with the given `id` already exists (`CITATION_DUPLICATE_ID`).

---

### `remove(id)` → `TCitation`

Removes a citation by ID and returns the removed entity. Throws if the citation does not exist.

---

### `get(id)` → `TCitation | undefined`

Returns a citation by ID, or `undefined` if not found.

---

### `getConnectionsForClaim(claimId)` → `TCitation[]`

Returns all citation connections where the given claim is the supported (dependent) endpoint. Renamed from `getCitationsForCitingClaim` in v0.12.0.

---

### `getAll()` → `TCitation[]`

Returns all citations.

---

### `filter(predicate)` → `TCitation[]`

Returns citations matching the given predicate.

---

### `validate()` → `TInvariantValidationResult`

Validates all citations: schema conformance, both endpoints resolve in the claim lookup, supporting-side endpoints have `type: 'citation'`. Called automatically after every mutation.

---

### `snapshot()` → `TClaimConnectionLibrarySnapshot<TCitation>`

Returns a serialisable snapshot `{ connections: TCitation[] }`. The wrapper field renamed from `claimCitations` to `connections` in v0.12.0.

---

### `static fromSnapshot(snapshot, claimLookup, options?)` → `ClaimCitationLibrary<TCitation>`

Reconstructs a `ClaimCitationLibrary` from a previously captured snapshot. Performs an unknown-typed pre-check on the raw input: throws `LEGACY_CLAIM_CITATION_SHAPE` when the snapshot still uses the legacy `claimCitations` wrapper key or contains entities with the legacy `citingClaimId`/`sourceClaimId` field names — both signals that the v0.12 CLI migration has not yet been run. Does not re-validate citations against the lookup once the shape check passes.

---

## `ClaimAxiomLibrary<TAxiom>`

_Since v0.12.0._

Global standalone repository for axiom-invocation connections between claims. Implements the generic `TClaimConnectionLibraryManagement<TAxiom>` interface. An axiom connection is a directed support edge `(claimId@claimVersion → supportingClaimId@supportingClaimVersion)` where the dependent (`claimId`) endpoint must be a `'normal'` claim and the supporting (`supportingClaimId`) endpoint must be an `'axiomatic'` claim. Create-or-delete only — no update path.

Lives on `PropositCore` at `core.axioms`. Constructor signature is identical to `ClaimCitationLibrary`.

> **No cycle detection.** Unlike `ClaimCitationLibrary`, this library does not run cycle detection. Axiomatic claims cannot appear on the dependent side (`AXIOM_CLAIM_NOT_NORMAL_TYPE` blocks that), so cycles are structurally impossible. This is an intentional asymmetry between the two connection libraries.

### `new ClaimAxiomLibrary(claimLookup, options?)`

Creates an empty library. Takes a single `claimLookup` (implementing `TClaimLookup`) — both endpoints of every axiom connection reference the unified claim library. Accepts an optional `{ checksumConfig? }` parameter (uses `claimAxiomFields` from the config when present, otherwise falls back to `claimCitationFields`).

---

### `add(axiom)` → `TAxiom`

Adds a new axiom connection (without `checksum` — it is computed automatically). The `axiom` parameter is `Omit<TAxiom, "checksum">`. Validates:

- No axiom with the given `id` already exists (`AXIOM_DUPLICATE_ID`).
- Both `claimId@claimVersion` and `supportingClaimId@supportingClaimVersion` resolve in the claim lookup (`AXIOM_CLAIM_REF_NOT_FOUND`, `AXIOM_SUPPORTING_REF_NOT_FOUND`).
- The dependent-side claim has `type: 'normal'` (`AXIOM_CLAIM_NOT_NORMAL_TYPE`). Citation claims and axiomatic claims cannot themselves be backed by axioms.
- The supporting-side claim has `type: 'axiomatic'` (`AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE`).

No cycle check (see note above).

---

### `remove(id)` → `TAxiom`

Removes an axiom connection by ID and returns the removed entity. Throws if the connection does not exist.

---

### `get(id)` → `TAxiom | undefined`

Returns an axiom connection by ID, or `undefined` if not found.

---

### `getConnectionsForClaim(claimId)` → `TAxiom[]`

Returns all axiom connections where the given claim is the dependent (supported) endpoint.

---

### `getAll()` → `TAxiom[]`

Returns all axiom connections.

---

### `filter(predicate)` → `TAxiom[]`

Returns axiom connections matching the given predicate.

---

### `validate()` → `TInvariantValidationResult`

Validates all axiom connections: schema conformance, both endpoints resolve in the claim lookup, supporting-side endpoints have `type: 'axiomatic'`, dependent-side endpoints have `type: 'normal'`. Called automatically after every mutation.

---

### `snapshot()` → `TClaimConnectionLibrarySnapshot<TAxiom>`

Returns a serialisable snapshot `{ connections: TAxiom[] }` — same wrapper shape as `ClaimCitationLibrary.snapshot()`.

---

### `static fromSnapshot(snapshot, claimLookup, options?)` → `ClaimAxiomLibrary<TAxiom>`

Reconstructs a `ClaimAxiomLibrary` from a previously captured snapshot. Does not re-validate axioms against the lookup. Use `validate()` afterwards if you need to detect snapshots that were tampered with.

---

## Generic claim-connection interfaces

_Since v0.12.0._

Both `ClaimCitationLibrary` and `ClaimAxiomLibrary` implement the same generic interfaces, so consumer code can be written polymorphically.

| Interface                                  | Description                                                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TClaimConnectionLookup<TConn>`            | Narrow read-only interface — `getConnectionsForClaim(claimId): TConn[]`, `get(id): TConn \| undefined`. Implemented by both citation and axiom libraries.                                                                           |
| `TClaimConnectionLibraryManagement<TConn>` | Full management interface extending `TClaimConnectionLookup`. Adds `add`, `remove`, `getAll`, `filter`, `snapshot`, `validate`. Both libraries satisfy this contract identically — no per-library extras leak through this surface. |
| `TClaimConnectionLibrarySnapshot<TConn>`   | Snapshot wrapper type `{ connections: TConn[] }` shared by both library snapshot shapes.                                                                                                                                            |

The `TConn` parameter defaults to `TCoreClaimConnection`; pass an extended app-layer type to narrow it. The `emptyClaimConnectionLookup<TConn>()` factory returns an empty lookup that type-checks at any narrowing.

---

## `ClaimLibrary<TClaim>`

Global versioned repository for claim entities (unified across the legacy `Claim`/`Source` split as of v0.10.0). Implements `TClaimLibraryManagement<TClaim>` (which extends `TClaimLookup<TClaim>`). Pass an instance to `ArgumentEngine` constructor and `fromSnapshot` to enable claim reference validation on variables.

Each claim has:

- A `version` (starting at `0`) and a `frozen` flag — freezing locks the current version and auto-creates a new mutable copy at the next version number.
- An immutable `type: 'normal' | 'citation'` discriminator. `'normal'` claims are primary-reasoning propositions; `'citation'` claims represent external/cited content (the unified replacement for the former separate `Source` entity, and the only kind allowed on the source side of a citation edge).

### `new ClaimLibrary(options?)`

Creates an empty library. Accepts an optional `{ checksumConfig?, generateId? }` parameter.

---

### `create(claim)` → `TClaim`

Creates a new claim at version `0` (unfrozen). The `claim` parameter omits `version`, `frozen`, and `checksum` fields — these are set automatically. The `type` field is required and is fixed for the lifetime of the claim. `id` may be omitted (auto-generated). Throws if a claim with the given ID already exists.

---

### `update(id, updates)` → `TClaim`

Updates fields on the latest (unfrozen) version of a claim. Throws if the claim does not exist or its latest version is frozen. Rejects any update that changes the immutable `type` field with `CLAIM_TYPE_IMMUTABLE`.

---

### `freeze(id)` → `{ frozen: TClaim; current: TClaim }`

Marks the current version as frozen and creates the next mutable version (incrementing version number, copying all fields except `frozen`). Returns both the frozen and new current entity. Throws if the claim does not exist or is already frozen.

---

### `get(id, version)` → `TClaim | undefined`

Returns a specific version of a claim, or `undefined` if not found.

---

### `getCurrent(id)` → `TClaim | undefined`

Returns the latest version of a claim, or `undefined` if not found.

---

### `getAll()` → `TClaim[]`

Returns all claim entities across all versions and IDs.

---

### `getVersions(id)` → `TClaim[]`

Returns all versions of a given claim ID, sorted by version number ascending.

---

### `validate()` → `TInvariantValidationResult`

Validates all claims: schema conformance, frozen claims have successor versions. Called automatically after every mutation.

---

### `snapshot()` → `TClaimLibrarySnapshot<TClaim>`

Returns a serialisable snapshot `{ claims: TClaim[] }` containing all claim entities across all versions.

---

### `static fromSnapshot(snapshot, options?)` → `ClaimLibrary<TClaim>`

Reconstructs a `ClaimLibrary` from a previously captured snapshot. Pre-screens for legacy (pre-v0.10.0) claim entries that lack the required `type` field and emits `LEGACY_CLAIM_MISSING_TYPE` so the caller gets a clear migration signal rather than a generic schema error.

---

## `PremiseEngine` (renamed from `PremiseManager`)

### `deleteExpressionsUsingVariable(variableId)` → `TCoreMutationResult<TPropositionalExpression[]>`

Removes all expressions referencing the given variable, with subtree deletion and operator collapse. Returns a mutation result with the removed expressions.

---

### `getReferencedVariableIds()` → `Set<string>`

Returns the set of variable IDs actually used in this premise's expression tree.

---

### `getVariables()` → `TPropositionalVariable[]`

Returns all argument-level variables (shared across premises via the engine's `VariableManager`) sorted by ID, with checksums.

---

### `addExpression(expression)` → `TCoreMutationResult<TPropositionalExpression>`

Adds an expression (without `checksum` — it is computed lazily) to the tree with an explicit numeric position. Validates argument membership, variable references, root uniqueness, and structural constraints (operator type, child limits, position uniqueness, operator nesting). This is the low-level escape hatch — prefer `appendExpression` or `addExpressionRelative` for most use cases.

Throws if a non-`not` operator would become a direct child of another operator expression. Wrap the child in a `formula` node to nest operators.

---

### `appendExpression(parentId, expression)` → `TCoreMutationResult<TPropositionalExpression>`

Appends an expression as the last child of `parentId` (or as a root if `parentId` is `null`). Position is computed automatically using the engine's `positionConfig`: `initial` for the first child, or the midpoint between the last child's position and `max` for subsequent children. The `expression` argument omits the `position` field (`TExpressionWithoutPosition`).

Throws if a non-`not` operator would become a direct child of another operator expression.

---

### `addExpressionRelative(siblingId, relativePosition, expression)` → `TCoreMutationResult<TPropositionalExpression>`

Inserts an expression before or after an existing sibling. `relativePosition` is `"before"` or `"after"`. Position is computed as the midpoint between the sibling and its neighbor (or `config.min`/`config.max` at the boundaries). The `expression` argument omits the `position` field (`TExpressionWithoutPosition`).

Throws if a non-`not` operator would become a direct child of another operator expression.

---

### `removeExpression(expressionId)` → `TCoreMutationResult<TPropositionalExpression | undefined>`

Removes an expression and its subtree, then collapses degenerate ancestor operators. Returns the removed root expression, or `undefined` if not found.

Throws if removal would promote a non-`not` operator as a direct child of another operator expression via collapse.

---

### `insertExpression(expression, leftNodeId?, rightNodeId?)` → `TCoreMutationResult<TPropositionalExpression>`

Splices `expression` into the tree. At least one of `leftNodeId` / `rightNodeId` must be provided. `leftNodeId` becomes position 0 and `rightNodeId` position 1 under the new expression.

Throws if a non-`not` operator would become a direct child of another operator expression.

---

### `wrapExpression(operator, newSibling, leftNodeId?, rightNodeId?)` → `TCoreMutationResult<TPropositionalExpression>`

Wraps an existing expression with a new operator and a new sibling in a single atomic operation. The operator takes the existing node's slot in the tree. Both the existing node and the new sibling become children of the operator. Exactly one of `leftNodeId` / `rightNodeId` must be provided — it identifies the existing node and which child slot it occupies.

Throws if a non-`not` operator would become a direct child of another operator expression.

---

### `loadExpressions(expressions)` → `void`

Bulk-loads expressions into the premise's tree, bypassing the operator nesting check. Intended for restoring persisted data that may predate the nesting restriction. Expressions are added in the order provided; callers should supply them in BFS order (parents before children). Does not emit mutation results or trigger subscribers.

---

### `getExpression(id)` → `TPropositionalExpression | undefined`

Returns an expression by ID.

---

### `getExpressions()` → `TPropositionalExpression[]`

Returns all expressions sorted by ID.

---

### `getChildExpressions(parentId)` → `TPropositionalExpression[]`

Returns children of `parentId` sorted by position.

---

### `getDecidableOperatorExpressions()` → `TCorePropositionalExpression[]`

Returns the operator expressions a reviewer can accept or reject, in pre-order depth-first tree order. Excludes `"not"` operators (NOT is flipped via render-time negation, not voted on) and skips formula nodes. Returns `[]` for empty premises and premises with no operators. Also available on `TEvaluablePremise`.

---

### `getRootExpression()` → `TPropositionalExpression | undefined`

Returns the root expression, if one exists.

---

### `getRootExpressionId()` → `string | undefined`

Returns the root expression ID.

---

### `getPremiseType()` → `"inference" | "constraint"`

Derived from the root expression.

---

### `getId()` → `string`

Returns this premise's ID.

---

### `getTitle()` → `string | undefined`

Returns this premise's optional title.

---

### `validateEvaluability()` → `TValidationResult`

Validates the premise structure (root presence, child counts, variable declarations, binary positions).

---

### `evaluate(assignment, options?)` → `TPremiseEvaluationResult`

Evaluates the expression tree under the given assignment. Throws if the premise is not valid. Returns `{ rootValue, expressionValues, variableValues, inferenceDiagnostic }`.

---

### `toDisplayString()` → `string`

Returns the expression tree rendered with standard logical notation (¬ ∧ ∨ → ↔). Missing operands render as `(?)`.

---

### `walkFormulaTree<T>(visitor)` → `T`

Walks the premise's expression tree and invokes the visitor for each node, returning the caller-defined result type. Returns `visitor.empty()` when the premise has no root expression.

```typescript
interface TFormulaTreeVisitor<T> {
    variable(symbol: string, variableId: string): T
    operator(type: TCoreLogicalOperatorType, children: T[]): T
    formula(child: T): T
    empty(): T
}
```

Mirrors the internal traversal of `toDisplayString()` but delegates rendering to the caller, enabling arbitrary output types (e.g. React component trees, AST nodes).

---

### `toPremiseData()` → `TPremise`

Returns a serialisable premise object (`{ id, argumentId, argumentVersion, checksum }` plus any extension fields). Does not include `rootExpressionId`, expressions, or variables — use `getRootExpressionId()`, `getExpressions()`, and `getReferencedVariableIds()` for those.

---

### `setExtras(extras)` → `TCoreMutationResult<Record<string, unknown>>`

Replaces all extra metadata on the premise. Structural fields (`id`, `argumentId`, `argumentVersion`, checksums) are preserved and cannot be overwritten. Returns the new extras and a changeset with the modified premise in `changes.premises.modified`.

---

### `updateExtras(updates)` → `TCoreMutationResult<Record<string, unknown>>`

Shallow-merges `updates` into the existing extras. Equivalent to `setExtras({ ...getExtras(), ...updates })`. Returns the merged extras and a changeset with the modified premise.

---

### `validate()` → `TInvariantValidationResult`

Runs invariant validation on this premise and its expression tree. Delegates to `ExpressionManager.validate()` for structural checks, then verifies premise schema, root expression consistency, and variable references (via callback from ArgumentEngine). Called automatically after every mutation.

---

### `snapshot()` → `TPremiseEngineSnapshot`

Returns a snapshot of the premise's owned state (premise metadata, expression snapshot, config). Excludes dependencies (argument, variables) owned by the parent `ArgumentEngine`.

---

### `static fromSnapshot(snapshot, argument, variables, expressionIndex?)` → `PremiseEngine`

Reconstructs a `PremiseEngine` from a snapshot, with the argument and `VariableManager` passed as dependencies. An optional `expressionIndex` map (expressionId → premiseId) is populated with the restored expressions.

---

## Derivation premise APIs on `ArgumentEngine`

_Added in v1.0._ The pre-1.0 `ManagedDerivationPremiseEngine` subclass and its `populateFromSupports` helper are **removed**. Derivation-premise canonical shape is now enforced by the Derivable-tier rules (D-1..D-6 — see `docs/Proposit_Grammar.md` §3.3) and surfaced through `engine.validate('derivable')`. Mutations on derivation premises go through the regular `PremiseEngine` and never throw on Derivable violations. The replacement APIs live on `ArgumentEngine` (not on a subclass).

### `populateFromCitations(premiseId, citationLib)` → `TPopulateResult`

Factory that constructs the per-claim derivation premise's expression tree in its **fully populated** form from the relevant citation connections for the premise's `derivedClaimId`, and **atomically replaces** the existing naked-Q tree.

- `n = 0` citation connections — `kind: 'no-op'`; the premise stays in naked-Q form.
- `n = 1` citation connection — produces `IMPLIES(VariableExpression(S1), VariableExpression(Q))` (D-2 single-citation form).
- `n ≥ 2` citation connections — produces `IMPLIES(formula(OR(VariableExpression(S1), …, VariableExpression(Sn))), VariableExpression(Q))` (D-1 populated form; the `formula` buffer between `IMPLIES` and `OR` is inserted by AN-1 in `assistive` behavior).

For each connection, calls `engine.ensureClaimBoundVariable(supportingClaimId)` to materialize the claim-bound variable.

Return shape (`TPopulateResult`):

```ts
{
  kind: 'populated' | 'no-op',
  state: TCoreDerivationPremise,
  resolved?: readonly TViolation[],
}
```

If the target premise is **not naked-Q** (already populated), the factory **no-ops and returns `{ kind: 'no-op', state }`** — it does **not** throw. D-3 (no mixing axioms and citations) is a non-Structural rule, so mutations never throw on it. To switch grounding kinds, the caller must explicitly empty the antecedent via a clearing repair primitive first; this satisfies the no-changes-without-consent principle while still respecting the Structural-only mutation-throw contract.

### `populateFromAxioms(premiseId, axiomLib)` → `TPopulateResult`

Same factory pattern as `populateFromCitations`, but reads from the global axiom library (`core.axioms`) and produces an axiom-grounded antecedent. Like the citation variant, returns `{ kind: 'no-op', state }` on already-populated premises instead of throwing.

A typical "populate this derivation premise from whichever grounding kind exists" flow runs `populateFromCitations` first; if it produces `kind: 'populated'`, the subsequent `populateFromAxioms` call no-ops (the target is no longer naked-Q). If no citations exist, `populateFromAxioms` takes effect with whatever axiom connections are present. This matches D-3's "no mixing" rule.

---

## Error Codes

### Derivation premise errors

| Code                                          | When thrown                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `DERIVATION_ROOT_OPERATOR_INVALID`            | S-14. Mutation would set a `type: "derivation"` premise's root operator to anything other than `variable`, `implies`, or `iff`. |
| `CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID` | `createPremise({ type: "derivation" })` called without `derivedClaimId`.                                                        |
| `CREATE_DERIVATION_CLAIM_NOT_FOUND`           | `createPremise({ type: "derivation", derivedClaimId })` but claim is not in the library.                                        |
| `CLAIM_NOT_FOUND`                             | `ensureClaimBoundVariable(claimId)` but claim is not in the library.                                                            |
| `LEGACY_PREMISE_MISSING_TYPE`                 | Snapshot restore encountered a premise record without the `type` field (pre-v0.11 data). Use this as a migration trigger.       |

The pre-1.0 codes `DERIVATION_TYPE_MISMATCH`, `DERIVATION_STRUCTURE_INVALID`, `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`, `DERIVATION_CONSEQUENT_LOCKED`, and `DERIVATION_ANTECEDENT_NON_EMPTY` are **removed in v1.0**. The conditions they covered are now handled by:

- The four-tier grammar's Derivable rules (D-1..D-6) surfaced through `engine.validate('derivable')` — see `docs/Proposit_Grammar.md` §3.3.
- `S-14` (derivation premise root operator) thrown at mutation time.
- The factory methods (`populateFromCitations` / `populateFromAxioms`) returning `{ kind: 'no-op' }` on already-populated premises instead of throwing.
- Naked-Q being a **valid Derivable state** in v1.0 (no longer an evaluation throw).

---

## Standalone Functions

### `diffArguments(engineA, engineB, options?)` → `TCoreArgumentDiff`

Compares two `ArgumentEngine` instances and returns a structured diff covering argument metadata, variables, premises (with nested expression diffs), and role changes. Each entity category reports added, removed, and modified items with field-level change details.

Options allow plugging custom comparators per entity type via `TCoreDiffOptions`:

```typescript
import { diffArguments, defaultCompareVariable } from "@proposit/proposit-core"

const diff = diffArguments(engineA, engineB, {
    compareVariable: (before, after) => {
        // Wrap the default comparator with custom logic
        return defaultCompareVariable(before, after)
    },
})
```

Default comparators exported: `defaultCompareArgument`, `defaultCompareVariable`, `defaultComparePremise`, `defaultCompareExpression`.

`TCoreDiffOptions` also accepts optional entity matchers (`premiseMatcher`, `variableMatcher`, `expressionMatcher`) for custom entity pairing. When provided, matchers override the default ID-based pairing. For fork-aware diffing, use `PropositCore.diffArguments()` instead — it injects fork-aware matchers automatically from `ForkLibrary` records.

---

### `analyzePremiseRelationships(engine, focusedPremiseId)` → `TCorePremiseRelationshipAnalysis`

Analyzes how every other premise in the argument relates to a focused premise, classifying each as:

| Category        | Meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `supporting`    | Consequent feeds into the focused premise's antecedent (helps it fire)   |
| `contradicting` | Infers values that negate the focused premise's antecedent or consequent |
| `restricting`   | Constrains shared variables without clear support or contradiction       |
| `downstream`    | Takes the focused premise's consequent as input (inference flows away)   |
| `unrelated`     | No variable overlap, even transitively                                   |

Each result includes per-variable relationship details and a `transitive` flag.

```typescript
import { analyzePremiseRelationships } from "@proposit/proposit-core"

const analysis = analyzePremiseRelationships(engine, conclusionPremiseId)
for (const r of analysis.premises) {
    console.log(`${r.premiseId}: ${r.relationship}`)
}
```

---

### `buildPremiseProfile(premise)` → `TCorePremiseProfile`

Builds a profile of a premise's variable appearances, recording each variable's side (`antecedent` or `consequent`) and polarity (`positive` or `negative`, determined by negation depth). Used internally by `analyzePremiseRelationships` but also exported for direct use.

---

### `collectArgumentReferencedClaims(ctx)` → `TCollectArgumentReferencedClaimsResult`

Returns every distinct claim referenced by any variable in any premise of the argument.

- **ctx**: `TArgumentEvaluationContext`
- **returns**: `{ claimIds: string[], byId: Record<string, { claimVersion, variableIds, premiseIds }> }`

Ordering: supporting premises first (in `listSupportingPremises()` order), then the conclusion premise, then any remaining premises (constraints). Within a premise, claims appear in the order their first-referencing variable appears in the expression tree (pre-order DFS). A claim shared across premises is emitted once at its first occurrence.

Variables without a bound claim (e.g. premise-bound variables) are skipped silently.

Throws `InvalidArgumentStructureError` if two variables bind the same `claimId` with different `claimVersion`s.

---

### `canonicalizeOperatorAssignments(ctx, input)` → `Record<string, TCoreOperatorAssignment>`

Expands `premiseScope` decisions into per-expression operator assignments via `TEvaluablePremise.getDecidableOperatorExpressions()`, then layers `expressionOverrides` on top.

- **ctx**: `TArgumentEvaluationContext`
- **input**: `{ premiseScope: Record<string, "accepted" | "rejected">, expressionOverrides?: Record<string, "accepted" | "rejected"> }`
- **returns**: expression-id → accepted/rejected map

An override whose parent premise is NOT in `premiseScope` is still applied. Output keys are exactly those expression ids that ended up with an assignment — not every expression in the argument.

Throws `UnknownExpressionError` for any override id missing from the argument. Throws `NotOperatorNotDecidableError` (with `reason: "is-not-operator"` for `"not"` operators, or `reason: "not-an-operator-type"` for variable/formula expressions).

---

### `TCoreArgumentEvaluationResult.propagatedVariableValues?: Record<string, TCoreTrivalentValue>`

Optional map of the evaluator's authoritative propagated variable values. Populated only when `evaluateArgument` is called with `includeDiagnostics: true`. Key set matches `referencedVariableIds` (claim-bound and externally-bound premise variables only); still-unresolved variables appear with value `null`. Internally-bound premise variables have no standalone truth value and are resolved lazily by the evaluator — they are NOT included in this map.

---

### `parseFormula(input)` → `TFormulaAST`

Parses a logical formula string into an AST. Supports standard logical notation with operators `not`/`¬`, `and`/`∧`, `or`/`∨`, `implies`/`→`, `iff`/`↔`, and parentheses for grouping.

```typescript
import { parseFormula } from "@proposit/proposit-core"
import type { TFormulaAST } from "@proposit/proposit-core"

const ast: TFormulaAST = parseFormula("(P and Q) implies R")
```

---

### `DEFAULT_CHECKSUM_CONFIG`

Readonly default checksum configuration with `Set<string>` fields for each entity type (`expressionFields`, `variableFields`, `premiseFields`, `argumentFields`, `roleFields`, `claimFields`, `claimCitationFields`). Used by `ArgumentEngine`, `PremiseEngine`, `ClaimLibrary`, and `ClaimCitationLibrary` when no custom config is provided.

---

### `createChecksumConfig(additional)` → `TCoreChecksumConfig`

Merges additional fields into the defaults via set union. The `additional` parameter has the same shape as `TCoreChecksumConfig` — any omitted fields inherit the defaults from `DEFAULT_CHECKSUM_CONFIG`.

```typescript
import {
    createChecksumConfig,
    DEFAULT_CHECKSUM_CONFIG,
} from "@proposit/proposit-core"

// Add a custom field to expression checksums while keeping all defaults
const config = createChecksumConfig({
    expressionFields: new Set(["myCustomField"]),
})
```

---

### `normalizeChecksumConfig(config)` → `TCoreChecksumConfig | undefined`

Ensures all fields on a `TCoreChecksumConfig` are `Set<string>` instances, converting from arrays or other iterables as needed. Returns `undefined` when passed `undefined`. Useful after JSON round-trips where `Set` values are serialized as arrays. Called automatically by `fromSnapshot`, `fromData`, and `rollback`, but exported for consumers who deserialize checksum configs independently.

```typescript
import { normalizeChecksumConfig } from "@proposit/proposit-core"

// After JSON round-trip, Set fields become arrays
const deserialized = JSON.parse(storedConfig)
const config = normalizeChecksumConfig(deserialized.checksumConfig)
// config.premiseFields is now a Set<string>
```

---

### `serializeChecksumConfig(config)` → `TCoreChecksumConfig | undefined`

Converts all `Set<string>` fields on a `TCoreChecksumConfig` to `string[]` arrays for JSON-safe serialization. Returns `undefined` when passed `undefined`. Called automatically by all `snapshot()` methods (`ArgumentEngine`, `PremiseEngine`, `ExpressionManager`, `VariableManager`), but exported for consumers who serialize checksum configs independently.

```typescript
import { serializeChecksumConfig } from "@proposit/proposit-core"

const serialized = serializeChecksumConfig(engine.getChecksumConfig())
// serialized.premiseFields is now a string[] — safe for JSON.stringify
```

---

## Grammar and engine behavior

_The pre-1.0 `grammarConfig` / `TGrammarOptions` / `TAutoNormalizeConfig` / `resolveAutoNormalize` / `DEFAULT_GRAMMAR_CONFIG` / `PERMISSIVE_GRAMMAR_CONFIG` surface is **removed in v1.0**._ Expression-tree shape is now driven by the four-tier grammar (Structural ⊇ Evaluable ⊇ Derivable ⊇ Presentable — see `docs/Proposit_Grammar.md` §3 for the full rule inventory) together with a single engine setting.

### `engine.behavior: 'assistive' | 'permissive'`

Controls whether the auto-normalization (AN) post-hook runs after each successful Structural mutation.

- **`'assistive'`** (default): runs AN-1..AN-4 after every successful mutation. AN preserves Presentable — if the pre-mutation state was Presentable, the post-mutation state is Presentable. (See `docs/Proposit_Grammar.md` §4.)
- **`'permissive'`**: AN does not run. Mutations execute exactly as described; the engine guarantees Structural integrity only. Lower-tier violations (Evaluable, Derivable, Presentable) are queryable via `validate(tier)` and never throw.

Set at construction:

```ts
const engine = new ArgumentEngine(arg, claims, { behavior: "permissive" })
```

Or at runtime via `engine.setBehavior(...)`. Switching `permissive → assistive` does **not** auto-run a global `normalize()` pass; the UI prompts the user explicitly before invoking `engine.normalize()`.

### Wire-format types

| Export             | Description                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `TGrammarTier`     | `'structural' \| 'evaluable' \| 'derivable' \| 'presentable'` (string-literal union).                                                      |
| `TGrammarRuleCode` | Union of `'S-1'`..`'S-14'`, `'E-1'`+`'E-3'`..`'E-7'`, `'D-1'`..`'D-6'`, `'P-1'`..`'P-5'`. Codes `E-2` and `D-7` are reserved (not reused). |
| `TViolation`       | `{ tier, code, message, argumentId?, premiseId?, expressionId?, variableId?, claimId?, … }`. Returned by `engine.validate(tier)`.          |

All three types are defined as TypeBox schemas + derived TS types in `src/lib/grammar/types.ts` and re-exported from `@proposit/shared/schemas/grammar` for consumer ergonomics.

---

## Position Utilities

Constants, types, and a helper for midpoint-based position computation, exported from `utils/position.ts`:

| Export                    | Value / Signature                                              | Description                                           |
| ------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- |
| `POSITION_MIN`            | `-2147483647`                                                  | Default lower bound (signed int32).                   |
| `POSITION_MAX`            | `2147483647`                                                   | Default upper bound (signed int32).                   |
| `POSITION_INITIAL`        | `0`                                                            | Default position for first children.                  |
| `DEFAULT_POSITION_CONFIG` | `{ min, max, initial }`                                        | Default `TCorePositionConfig` matching the above.     |
| `TCorePositionConfig`     | `{ min, max, initial }`                                        | Type for configurable position range.                 |
| `TLogicEngineOptions`     | `{ checksumConfig?, positionConfig?, behavior?, generateId? }` | Universal config type for all engine/manager classes. |
| `midpoint(a, b)`          | `a + (b - a) / 2`                                              | Overflow-safe midpoint of two positions.              |

~52 bisections at the same insertion point before losing floating-point precision.

---

## Hierarchical checksums

Every hierarchical entity (expression, premise, argument) carries three checksum fields:

| Field                | Meaning                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `checksum`           | Meta hash of the entity's own data only, driven by `checksumConfig`.                                           |
| `descendantChecksum` | Derived from children's `combinedChecksum` values; `null` for leaves.                                          |
| `combinedChecksum`   | Equals `checksum` when `descendantChecksum` is `null`, otherwise `computeHash(checksum + descendantChecksum)`. |

Dirty flags propagate bottom-up on mutation; recomputation is lazy via `flushChecksums()`. Variables are non-hierarchical (a single `checksum`). Argument role state is folded into the argument's meta `checksum`. Per-collection checksums are exposed via `getCollectionChecksum()`. `fromSnapshot` / `fromData` accept `checksumVerification?: "ignore" | "strict"` to verify or ignore stored checksums on load.

---

## `ArgumentParser`

```typescript
class ArgumentParser<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
>
```

Validates a structured LLM response (`TParsedArgumentResponse`) and builds an `ArgumentEngine` populated with claims, variables, premises, expression trees, and citation/axiom support edges. Exported from `@proposit/proposit-core` alongside the parsing schemas; lives in `src/lib/parsing/argument-parser.ts`.

The seven generic parameters mirror the entity types carried through `ArgumentEngine` (`TArg`, `TPremise`, `TExpr`, `TVar`, `TClaim`) plus the two connection-edge types (`TCitation`, `TAxiom`). All seven default to the corresponding core schemata; extension authors widen them by subclassing and passing a custom response schema built via `buildParsingResponseSchema()`.

The protected `mapArgument` / `mapClaim` / `mapVariable` / `mapPremise` / `mapClaimCitation` / `mapClaimAxiom` hooks let subclasses inject extension fields onto the entities created during `build()`. Each hook receives the parsed slice (and, for connection hooks, both endpoints plus their resolved UUIDs) and returns a `Record<string, unknown>` spread onto the entity before insertion.

### `new ArgumentParser(responseSchema?)`

Constructs a parser. The optional `responseSchema: TSchema` defaults to `ParsedArgumentResponseSchema`. Subclasses that extend any of the parsed-entity shapes should pass the schema produced by `buildParsingResponseSchema({ claimSchema?, variableSchema?, premiseSchema?, parsedArgumentSchema?, responseSchema? })` so that `validate()` accepts the extended payload.

---

### `validate(raw)` → `TParsedArgumentResponse`

Validates raw LLM output against the response schema. Runs `clampMaxLengths(responseSchema, raw)` first (truncates string fields that exceed their declared `maxLength` rather than rejecting) and then `Value.Parse(responseSchema, raw)`. Throws if the payload still fails schema validation after clamping.

---

### `build(response, options?)` → `TArgumentParserResult<...>`

Main entry point. Constructs an `ArgumentEngine`, a `ClaimLibrary`, a `ClaimCitationLibrary`, and a `ClaimAxiomLibrary` from a validated `TParsedArgumentResponse`.

- **response**: `TParsedArgumentResponse` — must have a non-null `argument`; throws otherwise.
- **options**: `TParserBuildOptions` — `{ strict?: boolean (default true), generateId?: () => string }`. Defaults: `strict: true`, `generateId: defaultGenerateId` (the same `globalThis.crypto.randomUUID()` shim used by `ArgumentEngine`).

Returns `{ engine, claimLibrary, claimCitationLibrary, claimAxiomLibrary, warnings }`. The four libraries are independent instances owned by the result — none are registered into a `PropositCore`; callers wire them up as they see fit.

**Build phases:**

1. **Formula parse + structural validation.** Each premise's `formula` string is parsed via `parseFormula`; the AST is then walked to enforce the root-only constraint for `implies`/`iff`. Failures emit `FORMULA_PARSE_ERROR` or `FORMULA_STRUCTURE_ERROR`.
2. **Argument creation.** A fresh `TArg` is built from `genId()` plus the result of `mapArgument(parsed)`.
3. **Claim library population.** Every parsed claim is inserted into a new `ClaimLibrary` with its `type` discriminator (`'normal' | 'citation' | 'axiomatic'`); the `miniId` → `{ id, version }` map is retained for downstream resolution. The two connection libraries are constructed against the populated claim library.
4. **Engine construction.** `ArgumentEngine` is built with `behavior: 'assistive'` (the default) and the caller-supplied `generateId`.
5. **Variables.** Each parsed variable is resolved against `claimMiniId`. Unresolved miniIds emit `UNRESOLVED_CLAIM_MINIID`; in non-strict mode the variable is dropped and its symbol removed from the declared-symbol set so downstream formula checks fire as `UNDECLARED_VARIABLE_SYMBOL`.
6. **Premises and expression trees.** Each surviving parsed premise becomes a `PremiseEngine` via `engine.createPremise(mapPremise(parsed))`; the formula AST is then walked into expression objects (operator/variable/formula nodes) under `parentId: null` at `POSITION_INITIAL`.
7. **Conclusion designation.** `setConclusionPremise` is invoked for the premise whose `miniId` matches `arg.conclusionPremiseMiniId`. An unresolvable miniId emits `UNRESOLVED_CONCLUSION_MINIID`.
8. **Formula-inferred support edges.** See below.

**Formula-inferred support edges.** For each premise whose root is `implies` or `iff` (the only legal root forms once root-only validation passes), the right-hand operand of the root is treated as the consequent and must itself be a claim-bound variable expression — premises whose consequent is not a variable are skipped. Every claim-bound variable referenced anywhere in the left-hand (antecedent) subtree contributes a candidate support edge `(consequentClaimId → supportingClaimId)`. The supporting claim's `type` decides where the edge lands:

- `type: 'citation'` → `ClaimCitationLibrary.add(...)` via `mapClaimCitation`.
- `type: 'axiomatic'` → `ClaimAxiomLibrary.add(...)` via `mapClaimAxiom`.
- `type: 'normal'` → no edge (normal claims contribute reasoning but are not stored as connection records).

Edges are deduped within `build()` by `(claimId, supportingClaimId)` — one library `add` per unique pair, even when the same antecedent variable appears multiple times across premises. The libraries themselves enforce their own invariants on `add()` (claim-ref resolution, type discriminator, cycle detection for citations, duplicate-id). In strict mode any library error rethrows; in non-strict mode it is captured as `CITATION_EDGE_REJECTED` or `AXIOM_EDGE_REJECTED`, with `context.libraryErrorCode` carrying the underlying violation code.

**Strict vs non-strict mode.** With `strict: true` (the default) the first error of any kind throws and `build()` aborts. With `strict: false`, every recoverable failure pushes a `TParserWarning` onto `result.warnings` and processing continues — useful when caller wants the best-effort tree the LLM intended even if a few entities were malformed. Conditions that participate in this distinction:

- Formula parse failure (`FORMULA_PARSE_ERROR`)
- Nested `implies`/`iff` or other root-only violations (`FORMULA_STRUCTURE_ERROR`)
- Variable referencing an undeclared claim miniId (`UNRESOLVED_CLAIM_MINIID`)
- Formula referencing a symbol that was not declared (or was dropped earlier in this pass) (`UNDECLARED_VARIABLE_SYMBOL`)
- Conclusion premise miniId that does not resolve (`UNRESOLVED_CONCLUSION_MINIID`)
- Citation/axiom library rejecting an edge on `add()` (`CITATION_EDGE_REJECTED`, `AXIOM_EDGE_REJECTED`)

---

### `mapArgument(parsed)` → `Record<string, unknown>` _(protected)_

Returns extension fields to spread onto the argument entity. Default returns `{}`. Override in subclasses to surface app-layer metadata from the parsed envelope (e.g., titles, descriptions).

---

### `mapClaim(parsed)` → `Record<string, unknown>` _(protected)_

Returns extension fields to spread onto every claim inserted into the claim library. Default returns `{}`.

---

### `mapVariable(parsed)` → `Record<string, unknown>` _(protected)_

Returns extension fields to spread onto every variable inserted into the engine. Default returns `{}`.

---

### `mapPremise(parsed)` → `Record<string, unknown>` _(protected)_

Returns extension fields forwarded to `engine.createPremise({ ...extras })`. Default returns `{}`.

---

### `mapClaimCitation(dep, sup, depId, supId)` → `Record<string, unknown>` _(protected)_

Returns extension fields to spread onto every citation connection added to `ClaimCitationLibrary`. Called once per `(consequentClaim, antecedentCitationClaim)` pair surfaced during formula-inferred edge construction. `dep` and `sup` are the parsed-claim forms (so `additionalProperties: true` extension data is available); `depId` and `supId` are the resolved UUIDs. Default returns `{}`.

---

### `mapClaimAxiom(dep, sup, depId, supId)` → `Record<string, unknown>` _(protected)_

Returns extension fields to spread onto every axiom connection added to `ClaimAxiomLibrary`. Called once per `(consequentClaim, antecedentAxiomaticClaim)` pair surfaced during formula-inferred edge construction. Same parameter conventions as `mapClaimCitation`. Default returns `{}`.

---

## Pipeline & providers

_Since v1.1.0._

The pipeline framework runs a DAG of processing stages — some deterministic, some backed by an LLM — and reports structured per-stage failures. It is **provider-agnostic**: stages depend only on the abstract `TLlmProvider` interface, and concrete providers are shipped as optional subpath extensions. `src/lib/` carries zero third-party SDK imports; the SDK-coupled providers live under `src/extensions/` and declare their SDKs as optional `peerDependencies`.

The framework primitives, the `TLlmProvider` interface, the OpenAI provider, the failure-code constants, and the default ingestion-pipeline factories are all re-exported from the package root for single-import ergonomics. The two concrete providers additionally have dedicated subpath exports (`@proposit/proposit-core/extensions/openai`, `@proposit/proposit-core/extensions/ollama`) for callers that prefer to tree-shake provider machinery.

### `TLlmProvider`

```typescript
type TLlmProvider = {
    respond<T>(req: TLlmRequest<T>): Promise<TLlmResponse<T>>
}
```

The single-method abstraction every stage calls. `respond<T>` takes a structured-output request and returns the parsed output plus token usage. The framework never depends on a concrete provider — pass any `TLlmProvider` implementation (production OpenAI, dev-only Ollama, or a test mock) as the `llm` dependency to `executePipeline`.

```typescript
type TLlmRequest<T> = {
    /** Free-form for forward-compat. The known set is `TLlmModel`. */
    model: string
    reasoningEffort?: TReasoningEffort
    systemPrompt: string
    userMessage: string
    outputSchema: TSchema
    tools?: readonly TToolSpec[]
    maxOutputTokens?: number
    signal?: AbortSignal
    onResponseCreated?: (responseId: string) => void // fired the moment the id is known, before respond() resolves (mid-flight)
    _typeMarker?: T // phantom — always `undefined` at runtime
}

type TLlmResponse<T> = {
    output: T
    tokenUsage: TLlmTokenUsage // { input, output, reasoning? }
    rawResponseId?: string
}
```

`model` is a free-form `string` (not constrained to the `TLlmModel` literal union `"gpt-5.5" | "gpt-5.4" | "gpt-5.4-mini" | "gpt-5.4-nano"`) so callers can target any backend model — including a local Ollama tag like `"qwen3.6:latest"` — without a core change. `onResponseCreated` (since v1.10.0) is an optional callback a provider may invoke **mid-flight**, as soon as the upstream response id is known and before `respond()` resolves; the OpenAI provider fires it in background-stream mode from the first `response.created` SSE event so a caller can persist the id before a possible crash. It is invoked at most once per call; synchronous providers leave it uncalled and surface the id only via `TLlmResponse.rawResponseId` at completion. `_typeMarker` is a phantom field with no runtime presence; it exists solely so the type system can carry the structured-output type `T` from `outputSchema` into `TLlmResponse<T>`. Providers and mocks ignore it.

`TToolSpec` is a discriminated union over `kind`:

| `kind`        | Shape                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `web_search`  | `{ kind: "web_search" }`                                                                                                                       |
| `file_search` | `{ kind: "file_search"; vectorStoreId: string }`                                                                                               |
| `mcp`         | `{ kind: "mcp"; serverUrl: string; toolName? }`                                                                                                |
| `function`    | `{ kind: "function"; name; description; parameters: TSchema; handler: (args) => … }` — local function tool driven by the provider's agent loop |

No ingestion stage uses tools today; the surface is provided for callers composing custom pipelines.

---

### `executePipeline(pipeline, input, deps)` → `Promise<TPipelineResult<TOutput>>`

Orchestrates a `TPipeline`'s stage DAG and returns the assembled result. `deps` is `TExecutePipelineDeps`:

- `llm: TLlmProvider` — required; the provider every `llmStage` calls.
- `generateId?: () => string` — ID generator threaded into `ctx.generateId` (defaults to `globalThis.crypto.randomUUID`).
- `signal?: AbortSignal` — mid-flight cancellation. Aborted stages surface as `skipped`, not `failed`, so callers can distinguish cancellation from a genuine error.
- `onEvent?: (event: TPipelineEvent) => void` — observability hook (see `TPipelineEvent` below).
- `concurrencyLimit?: number` — max stages run in parallel. Default `4`.

The executor validates `input` against `pipeline.inputSchema` and the DAG (cycle / self-dep / unknown-dep / duplicate-id checks) up front. DAG-misconfiguration and input-schema rejection throw `PipelineConfigurationError`; everything else is reported as a `TProcessingFailure` rather than thrown. Each stage output is validated against its `outputSchema`; a schema-invalid output retries per the retry policy, then becomes a `failed` outcome with code `OUTPUT_SCHEMA_INVALID`. Failure propagation is required-vs-optional aware: a `failed`/`skipped` upstream marks required dependents as `skipped`, while `optional(id)`-wrapped dependents still run (with `ctx.get(id)` returning `undefined`). `pipeline.finalize` has its own `dependsOn`; when any required dep is `skipped` or `failed`, finalize is bypassed and the result carries `output: null`.

---

### Framework types

| Type                            | Description                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TPipeline<TInput, TOutput>`    | `{ id, version, inputSchema, outputSchema, stages, finalize }`. The unit `executePipeline` runs.                                                                                          |
| `TStage<TOutput>`               | `{ id, dependsOn, outputSchema, run(ctx) }`. A single DAG node. Build via `deterministicStage` / `llmStage` / `subPipelineStage`.                                                         |
| `TStageContext`                 | Passed to each stage's `run`: `input`, `get<T>(stageId)`, `stageStatus(stageId)`, `llm`, `generateId`, `signal`, `emit(event)`, `addFailure(f)`.                                          |
| `TProcessingFailure`            | `{ stage, code, message, severity: "warning" \| "error", context? }`. The structured failure record. `code` is a bare `string` — match it against the exported failure-code constants.    |
| `TPipelineResult<TOutput>`      | `{ output: TOutput \| null, failures, stageOutcomes, tokenUsage? }`. `output` is `null` when finalize was bypassed.                                                                       |
| `TPipelineEvent`                | Discriminated union over `kind`: `pipeline:start` / `pipeline:end` / `stage:start` / `stage:end` / `stage:retry` / `stage:llm-request` / `stage:llm-response-created` / `stage:llm-call`. |
| `TDepSpec` / `TOptionalDep`     | A dependency is a bare stage-id `string` or an `optional(id)` wrapper. `optional(id)`, `isOptionalDep`, `depId` are exported helpers.                                                     |
| `TRetryPolicy` / `TRetryReason` | Retry configuration; `TRetryReason` is `"schema_validation" \| "transient" \| "rate_limit" \| "quota_exhausted"`.                                                                         |

The `stage:llm-request` event (since v1.8.0) fires from `llmStage` **before** each LLM-call attempt resolves — emitted inside the retry loop after the attempt counter increments and the request is built, immediately before the provider call. It carries `{ stageId, attempt, prompts: { system, user }, at }`, where `prompts.user` is the message as-sent on this attempt (including any retry-suffix appended after a prior schema-validation failure). It lets a consumer surface a stage's Input the instant the call starts, without waiting for the post-call `stage:llm-call`. A retried attempt fires a second `stage:llm-request` with the incremented `attempt`; deterministic stages emit none. Per-attempt ordering is `stage:start → stage:llm-request → [stage:llm-response-created] → stage:llm-call → stage:end`.

The `stage:llm-response-created` event (since v1.10.0) carries `{ stageId, attempt, responseId, at }` and fires from `llmStage` as soon as a provider surfaces a response id, always **before** `stage:llm-call` on the same attempt. **In background+stream mode the event fires _mid-flight_ — while the LLM call is still streaming, before it resolves** — driven by the provider's `onResponseCreated` callback (wired from the first `response.created` SSE event; see the OpenAI provider below). This is the load-bearing recovery guarantee: a consumer persists the id _before_ a possible crash, so a call interrupted mid-generation can be re-fetched from the upstream's stored copy (`retrieveResponse`) rather than blindly re-run (which would double-spend). In synchronous / poll modes the provider does not invoke the mid-flight callback, so the id surfaces only at completion (still on the same attempt, just before `stage:llm-call`) — a strictly weaker guarantee: a sync call crashing mid-generation loses its id and must re-run. The event fires on every attempt whose id is learned — including schema-validation retries — with the id belonging to that specific attempt, at most once per attempt.

The `stage:llm-call` event (since v1.2.0) fires after every LLM-call attempt, carrying the actual `prompts` sent (including the retry-suffix appended on attempt 2+), the raw `output`, the call's `tokenUsage`, an optional `validationError` set whenever the output failed `outputSchema` validation, and (since v1.10.0) an optional `rawResponseId` when the provider surfaces one. Its presence is the validation-fail signal; the payload shape is otherwise identical on success and failure. Deterministic stages and the thrown-error branch do not emit it.

### `DEFAULT_RETRY_POLICY`

```typescript
const DEFAULT_RETRY_POLICY: TRetryPolicy = {
    maxAttempts: 2,
    backoffMs: 500,
    retryOn: ["schema_validation", "transient"],
    maxAppendedErrorBytes: 2048,
}
```

The policy `llmStage` applies unless overridden. Note that `rate_limit` and `quota_exhausted` are **not** in the default `retryOn` — both fail fast on attempt 1. (A retryable transient and a schema-validation failure each get one retry.)

### Failure-code constants

Exported from the SDK-free `src/lib/pipelines/failure-codes.ts` (and re-exported from the package root) so a consumer's AI-budget breaker can match an imported value rather than a message substring. `TProcessingFailure.code` is a bare `string`; these are the stable wire-format values it takes for LLM-stage failures.

| Constant                  | Meaning                                                                                                                  | Retryable?                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| `OUTPUT_SCHEMA_INVALID`   | Stage output failed local TypeBox `outputSchema` validation.                                                             | Yes (one retry by default)    |
| `LLM_TRANSIENT_ERROR`     | Transient provider failure (5xx, network).                                                                               | Yes (by default)              |
| `LLM_RATE_LIMITED`        | Transient provider throttling (HTTP 429, non-quota).                                                                     | No (not in default `retryOn`) |
| `LLM_QUOTA_EXHAUSTED`     | Persistent provider budget exhaustion (OpenAI `insufficient_quota` 429). The signal a global AI-budget breaker trips on. | No (fail-fast)                |
| `LLM_NON_RETRYABLE_ERROR` | Unrecoverable provider failure (e.g. 400/401/403).                                                                       | No                            |
| `LLM_UNKNOWN_ERROR`       | Retry loop exited without captured error context (defensive).                                                            | —                             |

---

### `@proposit/proposit-core/extensions/openai`

The **production default** provider. Calls the OpenAI Responses API over raw `fetch` (no `openai` SDK runtime dependency for the request path), with an inlined TypeBox → strict-mode JSON Schema converter and a function-tool agent loop. `openai` is declared as an **optional `peerDependency`**.

#### `createOpenAiResponsesProvider(options)` → `TLlmProvider`

```typescript
type TCreateOpenAiResponsesProviderOptions = {
    apiKey: string
    baseUrl?: string // default https://api.openai.com/v1/responses
    fetch?: TOpenAiFetch // defaults to globalThis.fetch; inject for tests / polyfills
    maxToolCallRounds?: number // function-tool agent-loop cap; default 6
    stream?: boolean // stream response over SSE; default true; no data-retention implications
    backgroundMode?: boolean // submit-then-poll; requires store:true (NOT ZDR-compatible); no-tools V1 only; default false
    backgroundStreamMode?: boolean // background + live SSE: a single create with {background:true, stream:true, store:true}; the id arrives in the first `response.created` SSE event and is surfaced mid-flight via TLlmRequest.onResponseCreated; response keeps running server-side after a connection drop and is resumable to completion via reconnectStream; no-tools V1 only; default false; takes priority over backgroundMode when both are set
    backgroundPollIntervalMs?: number // poll interval (ms) when backgroundMode is true; default 2000
}
```

Throws at construction if no `fetch` is available and none is injected. The provider routes HTTP 429s with a structured `insufficient_quota` body to `QuotaExhaustedLlmError` (`retryReason: "quota_exhausted"`, code `LLM_QUOTA_EXHAUSTED`); every other or unparseable 429 stays `RateLimitLlmError` (the safe default).

#### `retrieveResponse(id, options)` → `Promise<TRetrievedResponse>`

```typescript
type TResponseStatus =
    | "queued" | "in_progress" | "completed"
    | "failed" | "incomplete" | "cancelled"

type TRetrievedResponse = {
    status: TResponseStatus
    output?: string        // present when status === "completed" and a message item was returned
    tokenUsage?: TLlmTokenUsage
    rawResponseId: string  // the id that was retrieved
}

await retrieveResponse("resp_abc", { apiKey, fetch?, baseUrl?, signal? })
```

Retrieves a stored OpenAI response by id. Throws `ResponseNotFoundError` (HTTP 404) when the response has aged out of the ~10-minute retention window — callers should clear the stored id, settle the stage as failed, and surface a retry. Throws `TransientLlmError` on 5xx or network errors. A 404 surfacing inside the background poll loop also throws `ResponseNotFoundError`.

`retrieveResponse` is a **passive read**: it reports the current status but does **not** advance a still-generating background response — a `queued` / `in_progress` response left to passive polling can stall indefinitely (it is only driven forward by an active stream consumer). To finish a dropped response, use `reconnectStream` (below).

#### `reconnectStream(id, options)` → `Promise<TRetrievedResponse>`

```typescript
await reconnectStream("resp_abc", {
    apiKey,
    startingAfter?, // SSE cursor; default 0 (replay from the start of the stored stream)
    fetch?,
    baseUrl?,
    signal?,
})
```

Reconnects to a stored background response via `GET /responses/{id}?stream=true&starting_after=<cursor>` and **consumes the SSE stream to its terminal event**, returning the same `TRetrievedResponse` shape. This is the operation that actually drives a dropped background response to completion: resuming the stream makes the server continue generation through to a terminal status, where a passive `retrieveResponse` GET would leave it sitting in `queued` / `in_progress`. Throws `ResponseNotFoundError` on 404 (aged out); `TransientLlmError` on 5xx, network errors, or a stream that ends with no terminal event (a second drop mid-reconnect — retry by reconnecting again). Honors `signal` (an abort propagates as an `AbortError`).

**Error classes** (re-exported from the package root and this subpath; `instanceof`-matchable for finer-grained observability): `NonRetryableLlmError`, `QuotaExhaustedLlmError`, `RateLimitLlmError`, `ResponseNotFoundError`, `SchemaValidationLlmError`, `ToolLoopExhaustedError`, `TransientLlmError`. `ResponseNotFoundError` **extends `NonRetryableLlmError`** (carries no `retryReason` tag → fail-fast, behavior-preserving for the prior generic-404 path; `status: 404`). The subpath also exports `typeboxToOpenAiSchema` (the strict-mode converter) and its `TOpenAiJsonSchema` type.

---

### `@proposit/proposit-core/extensions/ollama`

A second concrete `TLlmProvider` for running the LLM stack against a local [Ollama](https://ollama.com) daemon (e.g. `qwen3.6:latest`) at zero API cost. **Dev/test only — production stays on OpenAI, which remains the default everywhere.**

Surfaced **only** at the `@proposit/proposit-core/extensions/ollama` subpath — never the package root — because its error classes intentionally share names with the OpenAI ones and would collide. Uses the official `ollama` SDK (`>=0.5.0`) as an **optional `peerDependency`**; a missing package throws an actionable construction-time error. The per-request timeout (below) additionally uses `undici` (`>=6.0.0`) as a **second optional `peerDependency`**.

#### `new OllamaProvider(config?)` → `TLlmProvider`

```typescript
type TOllamaProviderConfig = {
    baseUrl?: string // daemon URL, default http://localhost:11434
    client?: TOllamaClient // pre-built SDK client; primarily a test seam
    numCtx?: number // → options.num_ctx, default 32768
    requestTimeoutMs?: number // per-provider HTTP timeout, default 1_200_000 (20 min)
    stream?: boolean // stream chat() and accumulate chunks; default true; fixes ~300s non-streaming timeout
    think?: boolean // toggle Ollama's thinking trace; opt-in (unset → model default); no safe global default — see below
    maxToolCallRounds?: number // function-tool agent-loop cap, default 6
}
```

**`numCtx` is set generously on purpose.** Ollama **silently truncates** any prompt longer than `num_ctx` — no error is raised; the model emits schema-valid JSON from the truncated prompt, which passes `Value.Check` and yields a quietly-wrong parse. Per-model defaults are often ~4096, well below a real multi-KB ingestion prompt, so the generous 32768 default keeps "run the whole pipeline locally on real text" honest. Behavioral differences from the OpenAI provider: `maxOutputTokens` maps to `num_predict` (positive only); `reasoningEffort` is ignored; `rawResponseId` is left undefined; `signal` is honored via the SDK client's `abort()`.

**`think` is an opt-in knob with no safe global default.** When unset (the default) the provider sends no `think` field and the model's own default applies (ON for reasoning models like `qwen3.6:latest`). On `qwen3.6:latest` the thinking toggle's effect on structured-output fidelity is **stage-dependent and cuts both ways** (verified empirically): with `think: true`, some stages (e.g. claim-mention-extraction) emit their whole answer in the thinking channel and return an **empty `content`** — which the provider now surfaces as a deterministic `NonRetryableLlmError` (not a retry-burning transient error) advising `think: false`; with `think: false`, other stages (e.g. segmentation) drop the required object wrapper and return a **bare array** that fails `Value.Check` (Ollama's `format` does **not** hard-enforce the object envelope on this model). Because no single `think` value satisfies every stage, set it per the stages a given provider instance serves, or — simplest — run a non-thinking model (e.g. `gemma2:9b`) for the whole ingestion pipeline. Thinking-on stages can take several minutes, which the generous `requestTimeoutMs` below accommodates.

**`requestTimeoutMs` (default `1_200_000` = 20 min)** raises the HTTP client timeout for long local generations. Local thinking models routinely take several minutes per structured-extraction stage; the underlying HTTP stack (undici) defaults to a 300s `headersTimeout`/`bodyTimeout` that would abort them mid-generation with a `UND_ERR_HEADERS_TIMEOUT` `fetch failed`. The provider applies the raised timeout via a **per-provider** undici `Agent` passed as the SDK client's `fetch` — it never calls `setGlobalDispatcher`, so no global state is mutated. This requires the optional `undici` peer (declared alongside `ollama`); if `undici` is not installed, the provider falls back to the SDK's default fetch and `classifyOllamaError` retries the resulting timeout (see below). Set `requestTimeoutMs: 0` to opt out of the custom dispatcher.

**Error classes** are surfaced from this subpath only and mirror the OpenAI names as **distinct classes** (the framework classifies by the `retryReason` tag, not class identity): `NonRetryableLlmError`, `RateLimitLlmError`, `SchemaValidationLlmError`, `ToolLoopExhaustedError`, `TransientLlmError`, plus `classifyOllamaError`. `classifyOllamaError` maps `ECONNREFUSED` / 404 / context-overflow → `NonRetryableLlmError` (overflow is deterministic — never the transient-tagged `SchemaValidationLlmError`) and `ECONNRESET` / cold-VRAM-load 5xx → `TransientLlmError`. Undici timeout cause-codes (`UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT` / `UND_ERR_CONNECT_TIMEOUT`, including when surfaced as a `fetch failed` `.cause.code`) are also classified `TransientLlmError`, so the default `retryOn: ["transient"]` retries a timeout rather than failing it `LLM_NON_RETRYABLE_ERROR`. An **empty assistant `content` accompanied by a thinking trace** (the model answered in the discarded thinking channel) is thrown directly as a `NonRetryableLlmError` — deterministic, so it fails fast with guidance to set `think: false` rather than burning a retry; a genuinely empty response (no content, no thinking) remains a transient-tagged `SchemaValidationLlmError`. The subpath also exports `typeboxToJsonSchema` (a standard-JSON-schema converter — `Type.Optional` keys are omitted from `required`, with no forced `additionalProperties: false`) and its `TOllamaJsonSchema` type.

---

### Argument-ingestion factories

The default ingestion pipelines that turn natural-language text into a `TParsedArgumentResponse` (consumable by `ArgumentParser.build()`, above). Re-exported from the package root and from `@proposit/proposit-core/extensions/argument-ingestion`.

#### `createIngestionV1Pipeline(extension, options?)` → `TPipeline<TIngestionInput, TParsedArgumentResponse>`

_Since v1.1.0._ Single-shot pipeline: one `llmStage` (`parse-argument`) calls the configured LLM with a system prompt built from `extension.responseSchema` and the raw input text, then `finalize` merges the response. `options` is `TCreateIngestionV1PipelineOptions`: `model?` (overrides the default `gpt-5.4`), `customInstructions?`, and `llm?: TIngestionLlmOptions`.

#### `createIngestionV2Pipeline(extension, options?)` → `TPipeline<TIngestionInput, TParsedArgumentResponse>`

_Since v1.3.0._ Multi-stage pipeline: a 12-stage DAG (4 deterministic + 8 LLM) — `segmentation` → claim/citation/axiom detection → canonicalization → classification / reference-validation / variable-assignment → relation-extraction → conclusion-selection → formula-compilation → formula-validation → `finalize`. Same `extension` parameterization and same `TParsedArgumentResponse` output shape as v1, so downstream `ArgumentParser.build()` consumers don't change. `options` is `TCreateIngestionV2PipelineOptions` (`{ llm?: TIngestionLlmOptions }`).

#### `basicsExtension`

The default `TIngestionExtension` (the schema bundle a factory consumes). Pairs with `@proposit/proposit-core/extensions/basics` for the basic argument schemas. A `TIngestionExtension` carries `responseSchema` (the LLM's full output schema) plus per-entity extension slots (`claimSchema`, `variableSchema`, `premiseSchema`, `argumentSchema`) that the v2 stages compose.

#### LLM-options seam — `TIngestionLlmOptions` / `TLlmStageOptionsOverride`

Both factories accept an `llm?: TIngestionLlmOptions` knob that threads per-stage LLM overrides through every LLM stage without forking the stages:

```typescript
type TIngestionLlmOptions = {
    defaults?: TLlmStageOptionsOverride // applies to every LLM stage
    overrides?: Record<string, TLlmStageOptionsOverride> // keyed by stage id
}

type TLlmStageOptionsOverride = {
    maxOutputTokens?: number
    reasoningEffort?: TReasoningEffort // OpenAI-specific; ignored by Ollama
    model?: string
    retry?: Partial<TRetryPolicy> // since v1.8.0
}
```

The merge order is **stage-override > pipeline-default > the stage's built-in default**. The `retry?` knob (added v1.8.0) overrides a stage's framework retry policy; it is carried straight through to `llmStage`, which shallow-merges it over `DEFAULT_RETRY_POLICY` (the seam itself does not merge — last-writer-wins on the whole `retry` object, like the scalar knobs). Its primary use is a "no-auto-retry" toggle that drops `"transient"` from `retryOn`; note that doing so disables the retry for **all** transient causes — network/undici timeouts, 5xx, AND `incomplete/max_output_tokens` truncation — not timeouts alone. The `model?` knob (added v1.6.0) is the load-bearing seam for retargeting a whole pipeline at a different backend in one line — e.g. pointing v2 at a local Ollama model for cost-free local development:

```typescript
import {
    createIngestionV2Pipeline,
    basicsExtension,
} from "@proposit/proposit-core"

const pipeline = createIngestionV2Pipeline(basicsExtension, {
    llm: { defaults: { model: "qwen3.6:latest" } },
})
// then run with the Ollama provider as the `llm` dependency:
// await executePipeline(pipeline, { text }, { llm: new OllamaProvider() })
```

Each stage keeps its own hard-coded `gpt-5.x` default when no override is supplied, so production behavior is unchanged. (v1's independent `model?` on `TCreateIngestionV1PipelineOptions` predates this seam and remains separate by design.)

---

## Types

### `TExpressionInput`

A version of `TPropositionalExpression` with the `checksum` field omitted. Uses a distributive conditional type to preserve discriminated-union narrowing across the `variable`/`operator`/`formula` variants. Used as the input type for `addExpression` and `insertExpression`.

---

### `TExpressionWithoutPosition`

A version of `TPropositionalExpression` with both the `position` and `checksum` fields omitted. Uses a distributive conditional type to preserve discriminated-union narrowing across the `variable`/`operator`/`formula` variants. Used as the input type for `appendExpression` and `addExpressionRelative`.

---

### Parser Types

Types exported from `@proposit/proposit-core` alongside `ArgumentParser`. Source: `src/lib/parsing/`.

#### `TArgumentParserResult`

```typescript
type TArgumentParserResult<
    TArg extends TCoreArgument = TCoreArgument,
    TPremise extends TCorePremise = TCorePremise,
    TExpr extends TCorePropositionalExpression = TCorePropositionalExpression,
    TVar extends TCorePropositionalVariable = TCorePropositionalVariable,
    TClaim extends TCoreClaim = TCoreClaim,
    TCitation extends TCoreClaimConnection = TCoreClaimConnection,
    TAxiom extends TCoreClaimConnection = TCoreClaimConnection,
> = {
    engine: ArgumentEngine<TArg, TPremise, TExpr, TVar, TClaim>
    claimLibrary: ClaimLibrary<TClaim>
    claimCitationLibrary: ClaimCitationLibrary<TCitation>
    claimAxiomLibrary: ClaimAxiomLibrary<TAxiom>
    warnings: TParserWarning[]
}
```

Return value of `ArgumentParser.build()`. The four libraries are independent instances; the caller decides how to register them (e.g., into a `PropositCore`). `warnings` is always defined — empty in strict mode (errors throw instead), populated in non-strict mode with one entry per recoverable failure.

#### `TParserBuildOptions`

```typescript
type TParserBuildOptions = {
    strict?: boolean // default: true
    generateId?: () => string // default: globalThis.crypto.randomUUID()
}
```

Per-call options to `ArgumentParser.build()`. `strict: true` throws on the first error; `strict: false` collects warnings and continues. `generateId` supplies UUIDs for every new entity created during the build.

#### `TParserWarning`

```typescript
type TParserWarning = {
    code: TParserWarningCode
    message: string
    context: Record<string, string>
}
```

A single recoverable issue surfaced by a non-strict `build()`. `context` carries the salient identifiers for the failure site (e.g., `premiseMiniId`, `formula`, `variableMiniId`, `claimMiniId`, `symbol`, `conclusionPremiseMiniId`, `claimId`, `supportingClaimId`, `libraryErrorCode`).

#### `TParserWarningCode`

```typescript
type TParserWarningCode =
    | "UNRESOLVED_CLAIM_MINIID"
    | "UNRESOLVED_CONCLUSION_MINIID"
    | "UNDECLARED_VARIABLE_SYMBOL"
    | "FORMULA_PARSE_ERROR"
    | "FORMULA_STRUCTURE_ERROR"
    | "CITATION_EDGE_REJECTED"
    | "AXIOM_EDGE_REJECTED"
```

| Code                           | Source                                      | Meaning                                                                                                                                                 |
| ------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNRESOLVED_CLAIM_MINIID`      | Variable processing                         | A `TParsedVariable.claimMiniId` does not match any `TParsedClaim.miniId`. The variable is dropped; its symbol falls out of the declared-symbol set.     |
| `UNRESOLVED_CONCLUSION_MINIID` | Conclusion assignment                       | `arg.conclusionPremiseMiniId` did not resolve to any premise. The engine is left without a conclusion premise (use `setConclusionPremise` after-build). |
| `UNDECLARED_VARIABLE_SYMBOL`   | Formula symbol resolution                   | A formula references a symbol that was never declared, or was declared but dropped earlier in this pass (see `UNRESOLVED_CLAIM_MINIID`).                |
| `FORMULA_PARSE_ERROR`          | `parseFormula` failure                      | The premise's `formula` string is not a valid logical formula. The premise is skipped.                                                                  |
| `FORMULA_STRUCTURE_ERROR`      | Root-only check (`implies`/`iff` placement) | The AST has `implies` or `iff` nested below the root. The premise is skipped.                                                                           |
| `CITATION_EDGE_REJECTED`       | `ClaimCitationLibrary.add()` threw          | A formula-inferred citation edge was rejected — `context.libraryErrorCode` carries the violation code (`CITATION_CYCLE_DETECTED`, etc.).                |
| `AXIOM_EDGE_REJECTED`          | `ClaimAxiomLibrary.add()` threw             | A formula-inferred axiom edge was rejected — `context.libraryErrorCode` carries the violation code (`AXIOM_CLAIM_NOT_NORMAL_TYPE`, etc.).               |

#### `TParsedArgumentResponse`

```typescript
type TParsedArgumentResponse = {
    argument: TParsedArgument | null
    uncategorizedText: string | null
    selectionRationale: string | null
    failureText: string | null
}
```

Top-level envelope returned by an LLM after structured-output parsing. `argument: null` is legal at the schema level but causes `build()` to throw with `"Cannot build: argument is null."`. The other three fields carry meta-commentary from the LLM and are not consumed by `build()`. The underlying TypeBox schema has `additionalProperties: true`, so extension fields survive `validate()`.

#### `TParsedArgument`

```typescript
type TParsedArgument = {
    claims: TParsedClaim[] // minItems: 1
    variables: TParsedVariable[] // minItems: 1
    premises: TParsedPremise[] // minItems: 1
    conclusionPremiseMiniId: string
}
```

The inner argument payload. `additionalProperties: true` on the schema preserves any extension fields the LLM emits.

#### `TParsedClaim`

```typescript
type TParsedClaim = {
    miniId: string
    role: "premise" | "conclusion" | "intermediate"
    type: "normal" | "citation" | "axiomatic"
}
```

A claim as emitted by the LLM. `miniId` is a short identifier scoped to the response; the parser resolves it to a real UUID via `claimLibrary.create()`. `additionalProperties: true` preserves extension fields, which `mapClaim` can pluck out. Note: the pre-v0.12.2 `citationMiniIds` field was removed — support edges are now formula-derived (see `ArgumentParser.build`).

#### `TParsedVariable`

```typescript
type TParsedVariable = {
    miniId: string
    symbol: string
    claimMiniId: string
}
```

A propositional variable. `claimMiniId` references a `TParsedClaim.miniId` in the same envelope; unresolved references emit `UNRESOLVED_CLAIM_MINIID`. `additionalProperties: true`.

#### `TParsedPremise`

```typescript
type TParsedPremise = {
    miniId: string
    formula: string
}
```

A premise. `formula` is a string in `parseFormula` notation (`not`/`¬`, `and`/`∧`, `or`/`∨`, `implies`/`→`, `iff`/`↔`, parentheses). `implies` and `iff` must appear at the root. `additionalProperties: true`.

---

### Snapshot Types

Hierarchical snapshot types for capturing and restoring engine state:

| Type                                     | Contains                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TExpressionManagerSnapshot`             | `expressions` (with checksums), `config`                                                                                                                           |
| `TVariableManagerSnapshot`               | `variables`, `config`                                                                                                                                              |
| `TPremiseEngineSnapshot`                 | `premise` metadata, `rootExpressionId`, `expressions` snapshot, `config`                                                                                           |
| `TArgumentEngineSnapshot`                | `argument`, `variables` snapshot, `premises` snapshots, `conclusionPremiseId`, `config`                                                                            |
| `TReactiveSnapshot`                      | `argument`, `variables` (Record by ID), `premises` (Record by ID with expressions), `roles`                                                                        |
| `TReactivePremiseSnapshot`               | `premise`, `expressions` (Record by ID), `rootExpressionId`                                                                                                        |
| `TClaimLibrarySnapshot`                  | `claims` (all versions of all claims; `'normal'`, `'citation'`, and `'axiomatic'`)                                                                                 |
| `TClaimConnectionLibrarySnapshot<TConn>` | `connections` (all connection records); shared shape for both citation and axiom libraries — wrapper key renamed from `claimCitations` to `connections` in v0.12.0 |
| `TArgumentLibrarySnapshot`               | `arguments` (array of `TArgumentEngineSnapshot`)                                                                                                                   |
| `TForkLibrarySnapshot`                   | Five arrays (`arguments`, `premises`, `expressions`, `variables`, `claims`)                                                                                        |
| `TPropositCoreSnapshot`                  | All five library snapshots in one object: `claims`, `citations`, `axioms` (new in v0.12.0), `forks`, `arguments`                                                   |

`TReactiveSnapshot` is the type returned by `getSnapshot()` — optimized for React with Record-based lookups and structural sharing. The other snapshot types are for serialization and restoration.

Each snapshot captures only what the class **owns**. Dependencies (e.g., variables for a premise) are excluded and must be passed separately during restoration via `fromSnapshot()`.

---

### Variable Types

Variables are a discriminated union (`TCorePropositionalVariable = TClaimBoundVariable | TPremiseBoundVariable`). Type guards `isClaimBound(v)` and `isPremiseBound(v)` narrow the union.

| Type                             | Description                                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `TClaimBoundVariable`            | Claim-bound variable with `claimId`/`claimVersion` referencing a global claim                                     |
| `TPremiseBoundVariable`          | Premise-bound variable with `boundPremiseId`/`boundArgumentId`/`boundArgumentVersion`; resolved during evaluation |
| `CoreClaimBoundVariableSchema`   | Typebox schema for claim-bound variables                                                                          |
| `CorePremiseBoundVariableSchema` | Typebox schema for premise-bound variables                                                                        |
| `isClaimBound(v)`                | Type guard — returns `true` if variable has `claimId`                                                             |
| `isPremiseBound(v)`              | Type guard — returns `true` if variable has `boundPremiseId`                                                      |

Premise-bound variables enable hierarchical argument structure: variable Q bound to premise P1 derives its truth value from P1's evaluation. **Internal bindings** (same argument) are resolved lazily during `evaluate()` and `checkValidity()` — they are NOT free variables. **External bindings** (different argument, created via `bindVariableToExternalPremise`) are evaluator-assigned and ARE included in truth-table generation as free variables. `isExternallyBound(v, argumentId)` distinguishes the two at runtime. Circular bindings (direct or transitive) are rejected at bind time for internal bindings; external bindings have no cycle concern since they're evaluator-assigned.

---

### Fork Types

| Type                             | Description                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `TForkArgumentOptions`           | Options for `forkArgumentEngine`: `generateId`, `checksumConfig`, `positionConfig`, `behavior`                 |
| `TForkRemapTable`                | Maps original entity IDs to forked counterparts: `argumentId`, `premises`, `expressions`, `variables` (Maps)   |
| `TCoreEntityForkRecord`          | Base fork record (`{ entityId, forkedFromEntityId, forkedFromArgumentId, forkedFromArgumentVersion, forkId }`) |
| `TCoreArgumentForkRecord`        | Alias for `TCoreEntityForkRecord` (no extra fields)                                                            |
| `TCorePremiseForkRecord`         | Alias for `TCoreEntityForkRecord` (no extra fields)                                                            |
| `TCoreExpressionForkRecord`      | Extends base with `forkedFromPremiseId`                                                                        |
| `TCoreVariableForkRecord`        | Alias for `TCoreEntityForkRecord` (no extra fields)                                                            |
| `TCoreClaimForkRecord`           | Extends base with `forkedFromEntityVersion` (claim version that was cloned)                                    |
| `TForkLibrarySnapshot`           | Snapshot type for `ForkLibrary` (five arrays, one per namespace)                                               |
| `TArgumentLibrarySnapshot`       | Snapshot type for `ArgumentLibrary` (`{ arguments: TArgumentEngineSnapshot[] }`)                               |
| `TPropositCoreSnapshot`          | Snapshot type for `PropositCore` (all four library snapshots)                                                  |
| `CoreEntityForkRecordSchema`     | Typebox schema for `TCoreEntityForkRecord`                                                                     |
| `CoreExpressionForkRecordSchema` | Typebox schema for `TCoreExpressionForkRecord`                                                                 |
| `CoreClaimForkRecordSchema`      | Typebox schema for `TCoreClaimForkRecord`                                                                      |

Fork provenance lives entirely in `ForkLibrary` — entity schemas (argument, premises, expressions, variables) do NOT carry `forkedFrom*` or `forkId` fields. Use `ForkLibrary.arguments.get(entityId)` (or the appropriate namespace) to look up whether an entity was forked and from which original.

---

### Claim, Citation, and Axiom Types

As of v0.10.0 the previously separate `Source` / `ClaimSourceAssociation` types are gone — sources are claims with `type: 'citation'`. As of v0.12.0 the citation-specific edge interfaces collapsed into a generic `TCoreClaimConnection` shape with neutral field names. Citation and axiom connections share that single shape; the supporting-side type-discriminator constraint is enforced by the owning library (`ClaimCitationLibrary` requires `type: 'citation'`; `ClaimAxiomLibrary` requires `type: 'axiomatic'` and `type: 'normal'` on the dependent side).

The `type` discriminator literal schemas are exported individually for use in app-layer extensions: `CoreClaimNormalTypeSchema` / `TCoreClaimNormalType`, `CoreClaimCitationTypeSchema` / `TCoreClaimCitationType`, `CoreClaimAxiomaticTypeSchema` / `TCoreClaimAxiomaticType`. The union schema is `CoreClaimTypeSchema` / `TCoreClaimType`.

| Type                                       | Description                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCoreClaim`                               | Base claim entity (`{ id, version, frozen, checksum, type: 'normal' \| 'citation' \| 'axiomatic' }`); `type` is immutable post-creation                     |
| `TCoreClaimType`                           | Discriminator union (`'normal' \| 'citation' \| 'axiomatic'`)                                                                                               |
| `TCoreClaimConnection`                     | Generic support edge `{ id, claimId, claimVersion, supportingClaimId, supportingClaimVersion, checksum }`; specialised by which library holds it            |
| `TClaimLookup`                             | Narrow read-only interface for claim lookups (`get(id, version)`)                                                                                           |
| `TClaimLibraryManagement`                  | Full management interface for `ClaimLibrary` (extends `TClaimLookup`; adds `create`, `update`, `freeze`, `getCurrent`, `getAll`, `getVersions`, `snapshot`) |
| `TClaimConnectionLookup<TConn>`            | Narrow read-only interface for connection lookups (`getConnectionsForClaim`, `get`); implemented by both citation and axiom libraries                       |
| `TClaimConnectionLibraryManagement<TConn>` | Full management interface for a connection library (extends `TClaimConnectionLookup`; adds `add`, `remove`, `getAll`, `filter`, `snapshot`, `validate`)     |
| `TClaimLibrarySnapshot`                    | Snapshot type for `ClaimLibrary` state (`{ claims: TClaim[] }`)                                                                                             |
| `TClaimConnectionLibrarySnapshot<TConn>`   | Snapshot type for both connection libraries (`{ connections: TConn[] }`); the wrapper key renamed from `claimCitations` to `connections` in v0.12.0         |

## Errors

### Claim, citation, and axiom error codes

These codes are emitted as `TInvariantViolation.code` values by `ClaimLibrary`, `ClaimCitationLibrary`, and `ClaimAxiomLibrary`. Unless noted otherwise, the citation codes are the v0.12.0 renames; the previous code names (`CITATION_CITING_REF_NOT_FOUND`, `CITATION_SOURCE_REF_NOT_FOUND`, `CITATION_SOURCE_NOT_CITATION_TYPE`) were dropped without a deprecation alias.

| Code                                    | Source                                                            | Meaning                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAIM_TYPE_IMMUTABLE`                  | `ClaimLibrary.update()`                                           | An update tried to change a claim's `type` discriminator after creation.                                                                                             |
| `LEGACY_CLAIM_MISSING_TYPE`             | `ClaimLibrary.fromSnapshot()`                                     | A claim entry in the snapshot lacks the `type` field (pre-v0.10 data); migration required.                                                                           |
| `CITATION_SCHEMA_INVALID`               | `ClaimCitationLibrary.validate()`                                 | A citation does not match `CoreClaimConnectionSchema`.                                                                                                               |
| `CITATION_DUPLICATE_ID`                 | `ClaimCitationLibrary.add()`                                      | A citation with the given `id` already exists.                                                                                                                       |
| `CITATION_CLAIM_REF_NOT_FOUND`          | `ClaimCitationLibrary.add/validate()`                             | The citation's `claimId@claimVersion` does not resolve in the claim lookup.                                                                                          |
| `CITATION_SUPPORTING_REF_NOT_FOUND`     | `ClaimCitationLibrary.add/validate()`                             | The citation's `supportingClaimId@supportingClaimVersion` does not resolve in the claim lookup.                                                                      |
| `CITATION_SUPPORTING_NOT_CITATION_TYPE` | `ClaimCitationLibrary.add/validate()`                             | The supporting-side claim has `type !== 'citation'`. Only citation-typed claims are valid as the supporting endpoint.                                                |
| `CITATION_CYCLE_DETECTED`               | `ClaimCitationLibrary.add()`                                      | Adding the citation would introduce a cycle in the global claim-citation graph (ID-only — versions ignored).                                                         |
| `CITATION_NOT_FOUND`                    | `ClaimCitationLibrary.remove()`                                   | Calling `remove(id)` with an id that does not exist in the citation library.                                                                                         |
| `AXIOM_SCHEMA_INVALID`                  | `ClaimAxiomLibrary.validate()`                                    | An axiom connection does not match `CoreClaimConnectionSchema`.                                                                                                      |
| `AXIOM_DUPLICATE_ID`                    | `ClaimAxiomLibrary.add()`                                         | An axiom connection with the given `id` already exists.                                                                                                              |
| `AXIOM_CLAIM_REF_NOT_FOUND`             | `ClaimAxiomLibrary.add/validate()`                                | The axiom's `claimId@claimVersion` does not resolve in the claim lookup.                                                                                             |
| `AXIOM_SUPPORTING_REF_NOT_FOUND`        | `ClaimAxiomLibrary.add/validate()`                                | The axiom's `supportingClaimId@supportingClaimVersion` does not resolve in the claim lookup.                                                                         |
| `AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE`   | `ClaimAxiomLibrary.add/validate()`                                | The supporting-side claim has `type !== 'axiomatic'`. Only axiomatic-typed claims are valid as the supporting endpoint.                                              |
| `AXIOM_CLAIM_NOT_NORMAL_TYPE`           | `ClaimAxiomLibrary.add/validate()`                                | The dependent-side claim has `type !== 'normal'`. Citation and axiomatic claims cannot themselves be backed by axioms.                                               |
| `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`   | `ArgumentEngine.evaluate/checkValidity`                           | Caller passed an explicit assignment for a claim-bound variable whose claim has `type='axiomatic'`. Reject the axiom in the antecedent via `toggleNegation` instead. |
| `AXIOM_NOT_FOUND`                       | `ClaimAxiomLibrary.remove()`                                      | Calling `remove(id)` with an id that does not exist in the axiom library.                                                                                            |
| `LEGACY_CLAIM_CITATION_SHAPE`           | `ClaimCitationLibrary.fromSnapshot` / `PropositCore.fromSnapshot` | Snapshot uses pre-v0.12 wrapper key (`claimCitations`) or per-entity legacy field names (`citingClaimId`/`sourceClaimId`). Run the v0.12 CLI migration.              |
| `LEGACY_MISSING_AXIOM_SLOT`             | `PropositCore.fromSnapshot`                                       | Snapshot lacks an `axioms` slot (pre-v0.12 data). Run the v0.12 CLI migration.                                                                                       |

### `InvalidArgumentStructureError`

Thrown when an argument's structural invariants preclude a review-helper operation — e.g., two variables binding to the same claim with different versions. Carries a human-readable message.

### `UnknownExpressionError`

Thrown by `canonicalizeOperatorAssignments` when an override references an expression id not present in any premise. Exposes `expressionId: string`.

### `NotOperatorNotDecidableError`

Thrown by `canonicalizeOperatorAssignments` when an override targets an expression that cannot carry an accept/reject assignment. Exposes `expressionId: string` and `reason: TNotOperatorNotDecidableReason` (`"is-not-operator"` for `"not"` operators, `"not-an-operator-type"` for variable/formula expressions).

---
