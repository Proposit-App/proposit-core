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

Derivation premises with broken trees produce violations with code `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`.

_Since v0.11.0._

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

Checks whether the argument is structurally ready to evaluate. Returns `{ ok, issues }`. As of v0.11.0, the sweep includes a derivation premise pre-flight: every `type: "derivation"` premise is validated via `validateDerivationStructure`. Broken derivation premises produce issues with code `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` and prevent `evaluate()` and `checkValidity()` from proceeding. Use `validateDerivationStructures()` to isolate derivation checks without running the full evaluability sweep.

As of v0.12.0, `evaluate()` and `checkValidity()` additionally run a claim-type pre-pass on their assignment input. If the assignment contains an entry for a claim-bound variable whose bound claim has `type === "axiomatic"`, the call is rejected with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` before any evaluation work runs. This is enforced inside `ArgumentEngine` (not in the standalone evaluator), so the structural `TArgumentEvaluationContext` interface is unchanged.

---

### `evaluate(assignment, options?)` → `TArgumentEvaluationResult`

Evaluates all relevant premises under the given expression assignment (`TCoreExpressionAssignment`). The assignment contains `variables` (a `Record<string, boolean | null>`) and `operatorAssignments` (a `Record<string, "accepted" | "rejected">` mapping operator expression IDs to their override state — `"accepted"` propagates constraints to unknown variables, `"rejected"` forces `false` with children skipped, absent means normal evaluation). Returns per-premise truth values, counterexample status, and an admissibility flag.

Claim-type-aware pre-pass (v0.12.0): before delegating to the standalone evaluator, `ArgumentEngine.evaluate` walks all claim-bound variables. If the caller's assignment includes an entry for any axiomatic-bound variable, evaluation aborts with `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`. Otherwise the engine builds an effective assignments map: caller entries unchanged, plus a forced `true` for every axiomatic-bound variable. Citation- and normal-bound variables continue to behave exactly as today (caller assigns; unassigned → `null`).

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

### `static fromSnapshot(snapshot, claimLibrary, claimCitationLibrary, grammarConfig?, checksumVerification?, generateId?)` → `ArgumentEngine`

Reconstructs an `ArgumentEngine` from a previously captured snapshot. Requires the same `claimLibrary` (implementing `TClaimLookup`) and `claimCitationLibrary` (implementing `TClaimConnectionLookup<TCitation>` as of v0.12.0) that would be passed to the constructor. Creates a `VariableManager` from the snapshot's variable data, then passes it as a dependency to each `PremiseEngine.fromSnapshot()`. The optional `grammarConfig` parameter overrides expression-tree grammar enforcement during restoration — defaults to `PERMISSIVE_GRAMMAR_CONFIG` so that previously saved trees load without validation errors. The optional `checksumVerification` (`"ignore" | "strict"`) controls whether stored checksums are verified or ignored on load; the optional `generateId` overrides the snapshot's persisted ID generator.

---

### `validate()` → `TInvariantValidationResult`

Runs a comprehensive invariant validation sweep on the entire argument. Delegates to `VariableManager.validate()` and each `PremiseEngine.validate()` (which delegates to `ExpressionManager.validate()`), then checks argument-level invariants: schema conformance, argument ownership on all entities, claim-bound variable references, internal premise-bound variable references, circularity detection, conclusion premise existence, and checksum consistency. Returns `{ ok: boolean, violations: TInvariantViolation[] }`. Called automatically after every mutation via the `withValidation` bracket — can also be called explicitly at any time.

---

### `rollback(snapshot)` → `void`

Restores the engine's internal state in place from a previously captured snapshot. Validates the restored state against the engine's grammar config; if validation fails, the pre-rollback state is restored and `InvariantViolationError` is thrown. Equivalent to reconstructing via `fromSnapshot` but mutates the existing instance (preserving references held by callers).

---

### `static fromData(argument, claimLibrary, claimCitationLibrary, variables, premises, expressions, roles, config?, grammarConfig?, checksumVerification?)` → `ArgumentEngine`

Bulk-loads an engine from flat arrays (as returned by DB queries). Requires `claimLibrary` and `claimCitationLibrary` instances. Groups expressions by `premiseId`, creates a shared `VariableManager`, creates each `PremiseEngine` with its expressions loaded in BFS order, and sets roles. Generic type parameters are inferred from the arguments. The optional `grammarConfig` parameter controls grammar enforcement during loading — defaults to the config in `options`, or `DEFAULT_GRAMMAR_CONFIG` if none is provided. Validates the loaded state; throws `InvariantViolationError` if the data is invalid under the grammar config.

---

### `canFork()` → `boolean` _(public)_

Returns whether this argument may be forked. Default implementation returns `true`. Override in subclasses to inject validation policy (e.g., only allow forking published arguments). Called by `PropositCore.forkArgument()` and `forkArgumentEngine()` before any work; throws if `false`.

---

## `PropositCore`

Top-level orchestrator that owns all five libraries and provides unified snapshot/restore, validation, and cross-library operations. Recommended entry point for new applications.

### `new PropositCore(options?)`

Creates a new `PropositCore` instance. All libraries are constructed automatically in dependency order (claims → citations → axioms → forks → arguments). Pass a `TPropositCoreOptions` object to inject pre-constructed library instances or shared configuration (`checksumConfig`, `positionConfig`, `grammarConfig`).

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
- `grammarConfig?: TGrammarConfig` — override grammar config (defaults to source's config)

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

The `TConn` parameter defaults to the base `TCoreClaimConnection`; pass `TCoreClaimCitation` or `TCoreClaimAxiom` (or an extended app-layer type) to narrow it. The `emptyClaimConnectionLookup<TConn>()` factory returns an empty lookup that type-checks at either narrowing.

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

## `ManagedDerivationPremiseEngine`

Opt-in subclass of `PremiseEngine` that enforces the derivation premise invariants on every mutation. Import from `@proposit/proposit-core`.

_Since v0.11.0._

### `new ManagedDerivationPremiseEngine(premise, deps, config?)`

Constructs a managed engine. Validates immediately that `premise.type === "derivation"` — throws `InvariantViolationError(DERIVATION_TYPE_MISMATCH)` otherwise. Expression-tree structural validation is deferred to `fromSnapshot` and mutation overrides because premises are always constructed before expressions are loaded.

- `premise` — `TOptionalChecksum<TPremise>` with `type: "derivation"` and `derivedClaimId`.
- `deps` — `{ argument, variables, expressionIndex? }` (same as `PremiseEngine` constructor).
- `config?` — optional `TLogicEngineOptions`.

---

### `static fromSnapshot(snapshot, argument, variables, expressionIndex?, grammarConfig?, generateId?)` → `ManagedDerivationPremiseEngine`

Reconstructs a `ManagedDerivationPremiseEngine` from a snapshot. Delegates to `PremiseEngine.fromSnapshot` for full restoration, then upgrades the prototype and validates:

1. Checks `snapshot.premise.type === "derivation"` — throws `DERIVATION_TYPE_MISMATCH` if not.
2. Restores all expressions via the parent's restoration logic.
3. Validates the full tree against derivation structural rules — throws `DERIVATION_STRUCTURE_INVALID` if the tree is malformed.

The `generateId` parameter is stored on the instance for use by `populateFromSupports`.

---

### `populateFromSupports(citationLib, axiomLib, argumentEngine)` → `void`

_Renamed from `populateFromCitations` in v0.12.0; signature gains the `axiomLib` parameter._

One-shot helper that builds the antecedent of this derivation premise from the combined support set drawn from the global citation library and the global axiom library for the derived claim.

The supporting connections are concatenated in a stable order — citations first (in their `getConnectionsForClaim` order), then axioms (also in their `getConnectionsForClaim` order). Behavior by total count `n`:

- **`n = 0`** — no change; the premise stays in its current form (typically naked-Q).
- **`n = 1`** — produces `IMPLIES(VariableExpression(S1), VariableExpression(Q))`.
- **`n ≥ 2`** — produces `IMPLIES(formula(OR(VariableExpression(S1), …, VariableExpression(Sn))), VariableExpression(Q))`. The `formula` buffer between `IMPLIES` and `OR` is auto-inserted by the engine's standard grammar (`wrapInsertFormula`).

For each supporting connection, calls `argumentEngine.ensureClaimBoundVariable(connection.supportingClaimId)` to materialize a claim-bound variable, and registers the result in the engine's local `VariableManager`. The antecedent construction uses `super.*` calls internally to bypass per-mutation overrides, then validates the final tree with `assertWellFormed()`.

Throws `InvariantViolationError(DERIVATION_ANTECEDENT_NON_EMPTY)` when the derivation premise already has a non-empty antecedent (i.e., root is `implies`/`iff` with a position-0 child). Delete and re-create the premise to repopulate.

> **Append-mode is deferred.** v0.12 keeps the naked-Q precondition. A user who wants to revise the support set (e.g., add an axiom after a citation-only populate) must delete and re-create the derivation premise.

> **Changed in v0.11.2:** the n ≥ 2 branch uses standard grammar throughout, so the produced shape matches what every other engine path (auto-normalize on load, manual rebuild) would emit. Pre-v0.11.2 produced `IMPLIES(OR(...), Q)` without the formula buffer by temporarily switching to `PERMISSIVE_GRAMMAR_CONFIG`. Stored pre-v0.11.2 data remains valid — `validateDerivationStructure` accepts both shapes — but consumer-side `combinedChecksum` checks may now report drift on pre-v0.11.2 trees and converge after a one-time normalization pass.

---

### Mutation overrides

All `PremiseEngine` mutation methods are overridden to enforce derivation rules. Each override calls `assertWellFormed()` after the mutation (or before, for `loadExpressions`):

| Method                  | Additional enforcement                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addExpression`         | Validates tree after.                                                                                                                              |
| `appendExpression`      | Validates tree after.                                                                                                                              |
| `addExpressionRelative` | Validates tree after.                                                                                                                              |
| `updateExpression`      | Blocks changes to the consequent's `variableId` or `operator` (`DERIVATION_CONSEQUENT_LOCKED`); validates tree after.                              |
| `removeExpression`      | Blocks removal of the consequent expression (`DERIVATION_CONSEQUENT_LOCKED`); validates tree after.                                                |
| `insertExpression`      | Blocks insertion into the consequent slot (`DERIVATION_CONSEQUENT_LOCKED`); validates tree after.                                                  |
| `toggleNegation`        | Blocks negation of the consequent expression (`DERIVATION_CONSEQUENT_LOCKED`); validates tree after.                                               |
| `wrapExpression`        | Blocks wrapping of the consequent expression (`DERIVATION_CONSEQUENT_LOCKED`); validates tree after.                                               |
| `changeOperator`        | Blocks swapping the root operator to `and`/`or`/`not` (`DERIVATION_ROOT_OPERATOR_INVALID`); only `implies↔iff` is permitted; validates tree after. |
| `normalizeExpressions`  | Validates tree after normalization (normalization could destroy the consequent structure).                                                         |
| `loadExpressions`       | Validates the entire proposed expression set before mutation — atomically rejects malformed bulk loads.                                            |

---

## `validateDerivationStructure(premise, expressions, variables)` → `TInvariantValidationResult`

Standalone pure function. Validates that a derivation premise's expression tree conforms to the structural rules:

- Root must be either a single variable expression for the derived claim's variable (naked form), or an `implies`/`iff` operator with arity 2.
- In implication/biconditional form: position-1 child (consequent slot) must be the variable expression for `derivedClaimId`'s variable. Position-0 child (antecedent) can be any valid expression.

Returns a `TInvariantValidationResult` with one violation per detected rule break, all using `DERIVATION_STRUCTURE_INVALID` (the message differentiates them). Has no engine dependencies; takes raw arrays of expressions and variables.

Exported from `@proposit/proposit-core`.

_Since v0.11.0._

---

## Error Codes

### Derivation premise errors (v0.11.0)

| Code                                          | When thrown                                                                                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DERIVATION_TYPE_MISMATCH`                    | `ManagedDerivationPremiseEngine` constructed or restored on a non-derivation premise.                                                                               |
| `DERIVATION_STRUCTURE_INVALID`                | Expression tree violates derivation structural rules (used by `validateDerivationStructure`, `ManagedDerivationPremiseEngine.fromSnapshot`, and `loadExpressions`). |
| `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION`  | A derivation premise tree is broken at `validateEvaluability()` / `validateDerivationStructures()` call time.                                                       |
| `DERIVATION_CONSEQUENT_LOCKED`                | Mutation targets the locked consequent expression — removal, negation, variable change, operator change, or insertion into consequent slot.                         |
| `DERIVATION_ROOT_OPERATOR_INVALID`            | `changeOperator` attempted to swap root `implies`/`iff` to a non-implication operator.                                                                              |
| `DERIVATION_ANTECEDENT_NON_EMPTY`             | `populateFromSupports` called on a premise that already has a non-empty antecedent.                                                                                 |
| `CREATE_DERIVATION_REQUIRES_DERIVED_CLAIM_ID` | `createPremise({ type: "derivation" })` called without `derivedClaimId`.                                                                                            |
| `CREATE_DERIVATION_CLAIM_NOT_FOUND`           | `createPremise({ type: "derivation", derivedClaimId })` but claim is not in the library.                                                                            |
| `CLAIM_NOT_FOUND`                             | `ensureClaimBoundVariable(claimId)` but claim is not in the library.                                                                                                |
| `LEGACY_PREMISE_MISSING_TYPE`                 | Snapshot restore encountered a premise record without the `type` field (pre-v0.11 data). Use this as a migration trigger.                                           |

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

## Grammar Configuration

Types and constants for controlling structural rule enforcement in expression trees, exported from `types/grammar.ts`:

### `TGrammarOptions`

Individual structural rule toggles. Each boolean controls whether a specific constraint is enforced:

| Field                            | Default | Description                                                                        |
| -------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `enforceFormulaBetweenOperators` | `true`  | Require a `formula` node between a parent operator and a non-`not` operator child. |

### `TAutoNormalizeConfig`

Granular auto-normalization flags. Each flag controls a specific automatic structural correction:

| Field                    | Description                                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `wrapInsertFormula`      | Insert a formula node when `addExpression`/`insertExpression`/`wrapExpression` creates operator-under-operator. |
| `negationInsertFormula`  | Insert a formula buffer when `toggleNegation` wraps a non-not operator in NOT.                                  |
| `collapseDoubleNegation` | Collapse NOT(NOT(x)) → x during `toggleNegation` and `normalize`.                                               |
| `collapseEmptyFormula`   | Collapse empty formulas/operators and promote single children after `removeExpression`.                         |
| `repositionOnCollision`  | Auto-redistribute sibling positions when a midpoint collision is detected.                                      |
| `absorbSameOperator`     | Absorb same-operator children through a formula after an operator swap in `updateExpression`.                   |

### `TGrammarConfig`

Extends `TGrammarOptions` with an additional control:

| Field           | Type                              | Default | Description                                                                                               |
| --------------- | --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `autoNormalize` | `boolean \| TAutoNormalizeConfig` | `true`  | `true` enables all normalizations; `false` disables all; an object enables per-behavior granular control. |

### `resolveAutoNormalize(grammarConfig, flag)` → `boolean`

Resolves a single granular flag from the grammar config. Returns `true`/`false` for boolean configs; looks up the specific flag for object configs.

### `DEFAULT_GRAMMAR_CONFIG`

`{ enforceFormulaBetweenOperators: true, autoNormalize: true }` — all rules enforced, auto-normalize on. Used by all mutating engine operations by default.

### `PERMISSIVE_GRAMMAR_CONFIG`

`{ enforceFormulaBetweenOperators: false, autoNormalize: false }` — no structural rules enforced. Used by default in `fromData`, `fromSnapshot`, and `rollback` so that previously persisted trees load without validation errors.

---

## Position Utilities

Constants, types, and a helper for midpoint-based position computation, exported from `utils/position.ts`:

| Export                    | Value / Signature                                      | Description                                           |
| ------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| `POSITION_MIN`            | `-2147483647`                                          | Default lower bound (signed int32).                   |
| `POSITION_MAX`            | `2147483647`                                           | Default upper bound (signed int32).                   |
| `POSITION_INITIAL`        | `0`                                                    | Default position for first children.                  |
| `DEFAULT_POSITION_CONFIG` | `{ min, max, initial }`                                | Default `TCorePositionConfig` matching the above.     |
| `TCorePositionConfig`     | `{ min, max, initial }`                                | Type for configurable position range.                 |
| `TLogicEngineOptions`     | `{ checksumConfig?, positionConfig?, grammarConfig? }` | Universal config type for all engine/manager classes. |
| `midpoint(a, b)`          | `a + (b - a) / 2`                                      | Overflow-safe midpoint of two positions.              |

~52 bisections at the same insertion point before losing floating-point precision.

---

## Types

### `TExpressionInput`

A version of `TPropositionalExpression` with the `checksum` field omitted. Uses a distributive conditional type to preserve discriminated-union narrowing across the `variable`/`operator`/`formula` variants. Used as the input type for `addExpression` and `insertExpression`.

---

### `TExpressionWithoutPosition`

A version of `TPropositionalExpression` with both the `position` and `checksum` fields omitted. Uses a distributive conditional type to preserve discriminated-union narrowing across the `variable`/`operator`/`formula` variants. Used as the input type for `appendExpression` and `addExpressionRelative`.

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
| `TForkArgumentOptions`           | Options for `forkArgumentEngine`: `generateId`, `checksumConfig`, `positionConfig`, `grammarConfig`            |
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

As of v0.10.0 the previously separate `Source` / `ClaimSourceAssociation` types are gone — sources are claims with `type: 'citation'`. As of v0.12.0 the citation-specific edge interfaces collapsed into a generic `TCoreClaimConnection` shape with neutral field names, and `TCoreClaimAxiom` was added for axiom-invocation connections.

| Type                                       | Description                                                                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCoreClaim`                               | Base claim entity (`{ id, version, frozen, checksum, type: 'normal' \| 'citation' \| 'axiomatic' }`); `type` is immutable post-creation                             |
| `TCoreClaimConnection`                     | Generic support edge `{ id, claimId, claimVersion, supportingClaimId, supportingClaimVersion, checksum }`; specialised by which library holds it                    |
| `TCoreClaimCitation`                       | Citation connection (alias of `TCoreClaimConnection`); supporting-side claim must have `type: 'citation'`                                                           |
| `TCoreClaimAxiom`                          | Axiom-invocation connection (alias of `TCoreClaimConnection`); supporting-side claim must have `type: 'axiomatic'`, dependent-side claim must have `type: 'normal'` |
| `TClaimLookup`                             | Narrow read-only interface for claim lookups (`get(id, version)`)                                                                                                   |
| `TClaimLibraryManagement`                  | Full management interface for `ClaimLibrary` (extends `TClaimLookup`; adds `create`, `update`, `freeze`, `getCurrent`, `getAll`, `getVersions`, `snapshot`)         |
| `TClaimConnectionLookup<TConn>`            | Narrow read-only interface for connection lookups (`getConnectionsForClaim`, `get`); implemented by both citation and axiom libraries                               |
| `TClaimConnectionLibraryManagement<TConn>` | Full management interface for a connection library (extends `TClaimConnectionLookup`; adds `add`, `remove`, `getAll`, `filter`, `snapshot`, `validate`)             |
| `TClaimLibrarySnapshot`                    | Snapshot type for `ClaimLibrary` state (`{ claims: TClaim[] }`)                                                                                                     |
| `TClaimConnectionLibrarySnapshot<TConn>`   | Snapshot type for both connection libraries (`{ connections: TConn[] }`); the wrapper key renamed from `claimCitations` to `connections` in v0.12.0                 |

## Errors

### Claim, citation, and axiom error codes

These codes are emitted as `TInvariantViolation.code` values by `ClaimLibrary`, `ClaimCitationLibrary`, and `ClaimAxiomLibrary`. Unless noted otherwise, the citation codes are the v0.12.0 renames; the previous code names (`CITATION_CITING_REF_NOT_FOUND`, `CITATION_SOURCE_REF_NOT_FOUND`, `CITATION_SOURCE_NOT_CITATION_TYPE`) were dropped without a deprecation alias.

| Code                                    | Source                                                            | Meaning                                                                                                                                                              |
| --------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAIM_TYPE_IMMUTABLE`                  | `ClaimLibrary.update()`                                           | An update tried to change a claim's `type` discriminator after creation.                                                                                             |
| `LEGACY_CLAIM_MISSING_TYPE`             | `ClaimLibrary.fromSnapshot()`                                     | A claim entry in the snapshot lacks the `type` field (pre-v0.10 data); migration required.                                                                           |
| `CITATION_SCHEMA_INVALID`               | `ClaimCitationLibrary.validate()`                                 | A citation does not match `CoreClaimCitationSchema`.                                                                                                                 |
| `CITATION_DUPLICATE_ID`                 | `ClaimCitationLibrary.add()`                                      | A citation with the given `id` already exists.                                                                                                                       |
| `CITATION_CLAIM_REF_NOT_FOUND`          | `ClaimCitationLibrary.add/validate()`                             | The citation's `claimId@claimVersion` does not resolve in the claim lookup.                                                                                          |
| `CITATION_SUPPORTING_REF_NOT_FOUND`     | `ClaimCitationLibrary.add/validate()`                             | The citation's `supportingClaimId@supportingClaimVersion` does not resolve in the claim lookup.                                                                      |
| `CITATION_SUPPORTING_NOT_CITATION_TYPE` | `ClaimCitationLibrary.add/validate()`                             | The supporting-side claim has `type !== 'citation'`. Only citation-typed claims are valid as the supporting endpoint.                                                |
| `CITATION_CYCLE_DETECTED`               | `ClaimCitationLibrary.add()`                                      | Adding the citation would introduce a cycle in the global claim-citation graph (ID-only — versions ignored).                                                         |
| `AXIOM_SCHEMA_INVALID`                  | `ClaimAxiomLibrary.validate()`                                    | An axiom connection does not match `CoreClaimAxiomSchema`.                                                                                                           |
| `AXIOM_DUPLICATE_ID`                    | `ClaimAxiomLibrary.add()`                                         | An axiom connection with the given `id` already exists.                                                                                                              |
| `AXIOM_CLAIM_REF_NOT_FOUND`             | `ClaimAxiomLibrary.add/validate()`                                | The axiom's `claimId@claimVersion` does not resolve in the claim lookup.                                                                                             |
| `AXIOM_SUPPORTING_REF_NOT_FOUND`        | `ClaimAxiomLibrary.add/validate()`                                | The axiom's `supportingClaimId@supportingClaimVersion` does not resolve in the claim lookup.                                                                         |
| `AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE`   | `ClaimAxiomLibrary.add/validate()`                                | The supporting-side claim has `type !== 'axiomatic'`. Only axiomatic-typed claims are valid as the supporting endpoint.                                              |
| `AXIOM_CLAIM_NOT_NORMAL_TYPE`           | `ClaimAxiomLibrary.add/validate()`                                | The dependent-side claim has `type !== 'normal'`. Citation and axiomatic claims cannot themselves be backed by axioms.                                               |
| `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`   | `ArgumentEngine.evaluate/checkValidity`                           | Caller passed an explicit assignment for a claim-bound variable whose claim has `type='axiomatic'`. Reject the axiom in the antecedent via `toggleNegation` instead. |
| `LEGACY_CLAIM_CITATION_SHAPE`           | `ClaimCitationLibrary.fromSnapshot` / `PropositCore.fromSnapshot` | Snapshot uses pre-v0.12 wrapper key (`claimCitations`) or per-entity legacy field names (`citingClaimId`/`sourceClaimId`). Run the v0.12 CLI migration.              |
| `LEGACY_MISSING_AXIOM_SLOT`             | `PropositCore.fromSnapshot`                                       | Snapshot lacks an `axioms` slot (pre-v0.12 data). Run the v0.12 CLI migration.                                                                                       |

### `InvalidArgumentStructureError`

Thrown when an argument's structural invariants preclude a review-helper operation — e.g., two variables binding to the same claim with different versions. Carries a human-readable message.

### `UnknownExpressionError`

Thrown by `canonicalizeOperatorAssignments` when an override references an expression id not present in any premise. Exposes `expressionId: string`.

### `NotOperatorNotDecidableError`

Thrown by `canonicalizeOperatorAssignments` when an override targets an expression that cannot carry an accept/reject assignment. Exposes `expressionId: string` and `reason: TNotOperatorNotDecidableReason` (`"is-not-operator"` for `"not"` operators, `"not-an-operator-type"` for variable/formula expressions).

---
