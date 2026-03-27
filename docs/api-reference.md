# API Reference

## `ArgumentEngine`

### `new ArgumentEngine(argument, claimLibrary, sourceLibrary, claimSourceLibrary, options?)`

Creates an engine scoped to `argument` (`{ id, version, title, description }`, without `checksum` — it is computed lazily). Requires a `claimLibrary` implementing `TClaimLookup` (used to validate claim references on variables), a `sourceLibrary` implementing `TSourceLookup`, and a `claimSourceLibrary` implementing `TClaimSourceLookup` (the global claim-source association store). Accepts an optional `config?: TLogicEngineOptions` parameter with `checksumConfig?: TCoreChecksumConfig` (configures which fields are included in entity checksums) and `positionConfig?: TCorePositionConfig` (configures the position range for expression ordering — defaults to signed int32: `[-2147483647, 2147483647]` with initial `0`). `TLogicEngineOptions` is the universal config type accepted by all engine/manager classes.

---

### `createPremise(extras?, symbol?)` → `TCoreMutationResult<PremiseEngine>`

Creates a new `PremiseEngine`, registers it with the engine, and returns it wrapped in a mutation result with the changeset. If no conclusion is currently set, the new premise is automatically designated as the conclusion (reflected in the changeset's `roles` field).

Also auto-creates a premise-bound variable for the new premise, included in the changeset's `variables.added`. The optional `symbol` parameter sets the variable's symbol; if omitted, an auto-generated symbol (`"P0"`, `"P1"`, ...) is used with collision avoidance.

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

Checks whether the argument is structurally ready to evaluate. Returns `{ ok, issues }`.

---

### `evaluate(assignment, options?)` → `TArgumentEvaluationResult`

Evaluates all relevant premises under the given expression assignment (`TCoreExpressionAssignment`). The assignment contains `variables` (a `Record<string, boolean | null>`) and `rejectedExpressionIds` (expression IDs that evaluate to `false` with children skipped). Returns per-premise truth values, counterexample status, and an admissibility flag.

Options:

- `validateFirst` (default `true`) — run validation before evaluating.
- `includeExpressionValues` (default `true`) — include per-expression truth maps.
- `includeDiagnostics` (default `true`) — include inference diagnostics.
- `strictUnknownAssignmentKeys` (default `false`) — reject assignment keys not referenced by evaluated premises.

---

### `checkValidity(options?)` → `TValidityCheckResult`

Runs a truth-table search over all 2ⁿ assignments (n = distinct referenced variable count). Returns `isValid` (`true`, `false`, or `undefined` if truncated), counterexamples, and statistics.

Options:

- `mode` (`"firstCounterexample"` | `"exhaustive"`, default `"firstCounterexample"`) — stop at first counterexample or continue exhaustively.
- `maxVariables` — safety limit on the number of variables.
- `maxAssignmentsChecked` — safety limit on the number of assignments evaluated.
- `includeCounterexampleEvaluations` (default `false`) — attach full evaluation payloads to counterexamples.
- `validateFirst` (default `true`) — run validation before the search.

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

### `static fromSnapshot(snapshot, claimLibrary, sourceLibrary, claimSourceLibrary, grammarConfig?)` → `ArgumentEngine`

Reconstructs an `ArgumentEngine` from a previously captured snapshot. Requires the same `claimLibrary` (implementing `TClaimLookup`), `sourceLibrary` (implementing `TSourceLookup`), and `claimSourceLibrary` (implementing `TClaimSourceLookup`) that would be passed to the constructor. Creates a `VariableManager` from the snapshot's variable data, then passes it as a dependency to each `PremiseEngine.fromSnapshot()`. The optional `grammarConfig` parameter overrides expression-tree grammar enforcement during restoration — defaults to `PERMISSIVE_GRAMMAR_CONFIG` so that previously saved trees load without validation errors.

---

### `rollback(snapshot)` → `void`

Restores the engine's internal state in place from a previously captured snapshot. Equivalent to reconstructing via `fromSnapshot` but mutates the existing instance (preserving references held by callers).

---

### `static fromData(argument, claimLibrary, sourceLibrary, claimSourceLibrary, variables, premises, expressions, roles, config?, grammarConfig?)` → `ArgumentEngine`

Bulk-loads an engine from flat arrays (as returned by DB queries). Requires `claimLibrary`, `sourceLibrary`, and `claimSourceLibrary` instances. Groups expressions by `premiseId`, creates a shared `VariableManager`, creates each `PremiseEngine` with its expressions loaded in BFS order, and sets roles. Generic type parameters are inferred from the arguments. The optional `grammarConfig` parameter controls grammar enforcement during loading — defaults to `PERMISSIVE_GRAMMAR_CONFIG` so that data from the database loads without validation errors regardless of how it was originally constructed.

---

### `canFork()` → `boolean` _(protected)_

Returns whether this argument may be forked. Default implementation returns `true`. Override in subclasses to inject validation policy (e.g., only allow forking published arguments). Called by `forkArgument` before any work; throws if `false`.

---

### `forkArgument(newArgumentId, claimLibrary, sourceLibrary, claimSourceLibrary, options?)` → `TForkArgumentResult`

Creates an independent copy of the current argument with new UUIDs for all entities. Every forked entity carries `forkedFrom` provenance metadata pointing back to the original. Internal references (expression `parentId`, `premiseId`, `variableId`, premise-bound variable `boundPremiseId`, conclusion role) are remapped to the new IDs. The forked engine starts at version `0`.

Returns `{ engine, remapTable }` where `engine` is the new `ArgumentEngine` and `remapTable` maps original entity IDs to their forked counterparts.

Options (`TForkArgumentOptions`):

- `generateId?: () => string` — custom ID generator (defaults to `crypto.randomUUID`)
- `checksumConfig?: TCoreChecksumConfig` — override checksum config (defaults to source's config)
- `positionConfig?: TCorePositionConfig` — override position config (defaults to source's config)
- `grammarConfig?: TGrammarConfig` — override grammar config (defaults to source's config)

```typescript
const { engine: forked, remapTable } = sourceEngine.forkArgument(
    "new-argument-id",
    claimLibrary,
    sourceLibrary,
    claimSourceLibrary
)
```

---

### `toDisplayString()` → `string`

Renders the full argument as a multi-line string. Each premise is prefixed with its role label (`[Conclusion]`, `[Supporting]`, or `[Constraint]`) followed by the premise's `toDisplayString()` output.

---

## `ClaimSourceLibrary<TAssoc>`

Global standalone repository for claim-source associations. Implements `TClaimSourceLibraryManagement<TAssoc>` (which extends `TClaimSourceLookup<TAssoc>`). Associations link a claim version to a source version. Create-or-delete only — no update path.

Pass an instance to `ArgumentEngine` constructor (and `fromSnapshot`) as the fourth parameter.

### `new ClaimSourceLibrary(claimLookup, sourceLookup, options?)`

Creates an empty library. Validates against `claimLookup` (implementing `TClaimLookup`) and `sourceLookup` (implementing `TSourceLookup`) on every `add()` call. Accepts an optional `{ checksumConfig? }` parameter.

---

### `add(assoc)` → `TAssoc`

Adds a new association (without `checksum` — it is computed automatically). The `assoc` parameter is `Omit<TAssoc, "checksum">`. Throws if an association with the given `id` already exists, or if the referenced claim version or source version does not exist in the respective lookup.

---

### `remove(id)` → `TAssoc`

Removes an association by ID and returns the removed entity. Throws if the association does not exist.

---

### `get(id)` → `TAssoc | undefined`

Returns an association by ID, or `undefined` if not found.

---

### `getForClaim(claimId)` → `TAssoc[]`

Returns all associations for the given claim ID (across all versions).

---

### `getForSource(sourceId)` → `TAssoc[]`

Returns all associations for the given source ID (across all versions).

---

### `getAll()` → `TAssoc[]`

Returns all associations.

---

### `filter(predicate)` → `TAssoc[]`

Returns associations matching the given predicate.

---

### `snapshot()` → `TClaimSourceLibrarySnapshot<TAssoc>`

Returns a serialisable snapshot `{ claimSourceAssociations: TAssoc[] }`.

---

### `static fromSnapshot(snapshot, claimLookup, sourceLookup, options?)` → `ClaimSourceLibrary<TAssoc>`

Reconstructs a `ClaimSourceLibrary` from a previously captured snapshot. Does not re-validate associations against the lookups.

---

## `ClaimLibrary<TClaim>`

Global versioned repository for claim entities. Implements `TClaimLibraryManagement<TClaim>` (which extends `TClaimLookup<TClaim>`). Pass an instance to `ArgumentEngine` constructor and `fromSnapshot` to enable claim reference validation on variables.

Each claim has a `version` (starting at `0`) and a `frozen` flag. Freezing locks the current version and auto-creates a new mutable copy at the next version number.

### `new ClaimLibrary(options?)`

Creates an empty library. Accepts an optional `{ checksumConfig? }` parameter.

---

### `create(claim)` → `TClaim`

Creates a new claim at version `0` (unfrozen). The `claim` parameter omits `version`, `frozen`, and `checksum` fields — these are set automatically. Throws if a claim with the given ID already exists.

---

### `update(id, updates)` → `TClaim`

Updates fields on the latest (unfrozen) version of a claim. Throws if the claim does not exist or its latest version is frozen.

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

### `snapshot()` → `TClaimLibrarySnapshot<TClaim>`

Returns a serialisable snapshot `{ claims: TClaim[] }` containing all claim entities across all versions.

---

### `static fromSnapshot(snapshot, options?)` → `ClaimLibrary<TClaim>`

Reconstructs a `ClaimLibrary` from a previously captured snapshot.

---

## `SourceLibrary<TSource>`

Global versioned repository for source entities. Implements `TSourceLibraryManagement<TSource>` (which extends `TSourceLookup<TSource>`). Pass an instance to `ArgumentEngine` constructor and `fromSnapshot` to enable source reference validation on `ClaimSourceLibrary` associations.

Has the same versioning and freeze semantics as `ClaimLibrary`.

### `new SourceLibrary(options?)`

Creates an empty library. Accepts an optional `{ checksumConfig? }` parameter.

---

### `create(source)` → `TSource`

Creates a new source at version `0` (unfrozen). The `source` parameter omits `version`, `frozen`, and `checksum` fields. Throws if a source with the given ID already exists.

---

### `update(id, updates)` → `TSource`

Updates fields on the latest (unfrozen) version of a source. Throws if the source does not exist or its latest version is frozen.

---

### `freeze(id)` → `{ frozen: TSource; current: TSource }`

Marks the current version as frozen and creates the next mutable version. Returns both the frozen and new current entity. Throws if the source does not exist or is already frozen.

---

### `get(id, version)` → `TSource | undefined`

Returns a specific version of a source, or `undefined` if not found.

---

### `getCurrent(id)` → `TSource | undefined`

Returns the latest version of a source, or `undefined` if not found.

---

### `getAll()` → `TSource[]`

Returns all source entities across all versions and IDs.

---

### `getVersions(id)` → `TSource[]`

Returns all versions of a given source ID, sorted by version number ascending.

---

### `snapshot()` → `TSourceLibrarySnapshot<TSource>`

Returns a serialisable snapshot `{ sources: TSource[] }` containing all source entities across all versions.

---

### `static fromSnapshot(snapshot, options?)` → `SourceLibrary<TSource>`

Reconstructs a `SourceLibrary` from a previously captured snapshot.

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

### `toPremiseData()` → `TPremise`

Returns a serialisable premise object (`{ id, argumentId, argumentVersion, checksum }` plus any extension fields). Does not include `rootExpressionId`, expressions, or variables — use `getRootExpressionId()`, `getExpressions()`, and `getReferencedVariableIds()` for those.

---

### `snapshot()` → `TPremiseEngineSnapshot`

Returns a snapshot of the premise's owned state (premise metadata, expression snapshot, config). Excludes dependencies (argument, variables) owned by the parent `ArgumentEngine`.

---

### `static fromSnapshot(snapshot, argument, variables, expressionIndex?)` → `PremiseEngine`

Reconstructs a `PremiseEngine` from a snapshot, with the argument and `VariableManager` passed as dependencies. An optional `expressionIndex` map (expressionId → premiseId) is populated with the restored expressions.

---

## Standalone Functions

### `diffArguments(engineA, engineB, options?)` → `TCoreArgumentDiff`

Compares two `ArgumentEngine` instances and returns a structured diff covering argument metadata, variables, premises (with nested expression diffs), and role changes. Each entity category reports added, removed, and modified items with field-level change details.

Options allow plugging custom comparators per entity type via `TCoreDiffOptions`:

```typescript
import { diffArguments, defaultCompareVariable } from "@polintpro/proposit-core"

const diff = diffArguments(engineA, engineB, {
    compareVariable: (before, after) => {
        // Wrap the default comparator with custom logic
        return defaultCompareVariable(before, after)
    },
})
```

Default comparators exported: `defaultCompareArgument`, `defaultCompareVariable`, `defaultComparePremise`, `defaultCompareExpression`.

`TCoreDiffOptions` also accepts optional entity matchers (`premiseMatcher`, `variableMatcher`, `expressionMatcher`) for custom entity pairing. When provided, matchers override the default ID-based pairing — useful for comparing forked arguments where entities have different IDs but carry `forkedFrom` provenance metadata. See `createForkedFromMatcher()`.

---

### `createForkedFromMatcher()` → `{ premiseMatcher, variableMatcher, expressionMatcher }`

Returns entity matchers for fork-aware diffing. Pairs entity A with entity B when B's `forkedFrom*Id` matches A's `id` and the argument identity matches. No remap table required — uses self-describing provenance metadata.

```typescript
import {
    diffArguments,
    createForkedFromMatcher,
} from "@polintpro/proposit-core"

const diff = diffArguments(originalEngine, forkedEngine, {
    ...createForkedFromMatcher(),
})
// diff.premises.modified shows what changed; .added/.removed show new/deleted premises
```

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
import { analyzePremiseRelationships } from "@polintpro/proposit-core"

const analysis = analyzePremiseRelationships(engine, conclusionPremiseId)
for (const r of analysis.premises) {
    console.log(`${r.premiseId}: ${r.relationship}`)
}
```

---

### `buildPremiseProfile(premise)` → `TCorePremiseProfile`

Builds a profile of a premise's variable appearances, recording each variable's side (`antecedent` or `consequent`) and polarity (`positive` or `negative`, determined by negation depth). Used internally by `analyzePremiseRelationships` but also exported for direct use.

---

### `parseFormula(input)` → `TFormulaAST`

Parses a logical formula string into an AST. Supports standard logical notation with operators `not`/`¬`, `and`/`∧`, `or`/`∨`, `implies`/`→`, `iff`/`↔`, and parentheses for grouping.

```typescript
import { parseFormula } from "@polintpro/proposit-core"
import type { TFormulaAST } from "@polintpro/proposit-core"

const ast: TFormulaAST = parseFormula("(P and Q) implies R")
```

---

### `DEFAULT_CHECKSUM_CONFIG`

Readonly default checksum configuration with `Set<string>` fields for each entity type (`expressionFields`, `variableFields`, `premiseFields`, `argumentFields`, `roleFields`, `claimFields`, `sourceFields`, `claimSourceAssociationFields`). Used by `ArgumentEngine`, `PremiseEngine`, and `ClaimSourceLibrary` when no custom config is provided.

---

### `createChecksumConfig(additional)` → `TCoreChecksumConfig`

Merges additional fields into the defaults via set union. The `additional` parameter has the same shape as `TCoreChecksumConfig` — any omitted fields inherit the defaults from `DEFAULT_CHECKSUM_CONFIG`.

```typescript
import {
    createChecksumConfig,
    DEFAULT_CHECKSUM_CONFIG,
} from "@polintpro/proposit-core"

// Add a custom field to expression checksums while keeping all defaults
const config = createChecksumConfig({
    expressionFields: new Set(["myCustomField"]),
})
```

---

### `normalizeChecksumConfig(config)` → `TCoreChecksumConfig | undefined`

Ensures all fields on a `TCoreChecksumConfig` are `Set<string>` instances, converting from arrays or other iterables as needed. Returns `undefined` when passed `undefined`. Useful after JSON round-trips where `Set` values are serialized as arrays. Called automatically by `fromSnapshot`, `fromData`, and `rollback`, but exported for consumers who deserialize checksum configs independently.

```typescript
import { normalizeChecksumConfig } from "@polintpro/proposit-core"

// After JSON round-trip, Set fields become arrays
const deserialized = JSON.parse(storedConfig)
const config = normalizeChecksumConfig(deserialized.checksumConfig)
// config.premiseFields is now a Set<string>
```

---

### `serializeChecksumConfig(config)` → `TCoreChecksumConfig | undefined`

Converts all `Set<string>` fields on a `TCoreChecksumConfig` to `string[]` arrays for JSON-safe serialization. Returns `undefined` when passed `undefined`. Called automatically by all `snapshot()` methods (`ArgumentEngine`, `PremiseEngine`, `ExpressionManager`, `VariableManager`), but exported for consumers who serialize checksum configs independently.

```typescript
import { serializeChecksumConfig } from "@polintpro/proposit-core"

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

### `TGrammarConfig`

Extends `TGrammarOptions` with an additional control:

| Field           | Default | Description                                                                                                                                                  |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `autoNormalize` | `false` | When `true`, auto-insert `formula` buffers instead of throwing when a rule is violated. Only supported by `addExpression`; compound operations always throw. |

### `DEFAULT_GRAMMAR_CONFIG`

`{ enforceFormulaBetweenOperators: true, autoNormalize: false }` — all rules enforced, auto-normalize off. Used by all mutating engine operations by default.

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

| Type                          | Contains                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `TExpressionManagerSnapshot`  | `expressions` (with checksums), `config`                                                    |
| `TVariableManagerSnapshot`    | `variables`, `config`                                                                       |
| `TPremiseEngineSnapshot`      | `premise` metadata, `rootExpressionId`, `expressions` snapshot, `config`                    |
| `TArgumentEngineSnapshot`     | `argument`, `variables` snapshot, `premises` snapshots, `conclusionPremiseId`, `config`     |
| `TReactiveSnapshot`           | `argument`, `variables` (Record by ID), `premises` (Record by ID with expressions), `roles` |
| `TReactivePremiseSnapshot`    | `premise`, `expressions` (Record by ID), `rootExpressionId`                                 |
| `TClaimLibrarySnapshot`       | `claims` (all versions of all claims)                                                       |
| `TSourceLibrarySnapshot`      | `sources` (all versions of all sources)                                                     |
| `TClaimSourceLibrarySnapshot` | `claimSourceAssociations` (all associations)                                                |

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

| Type                   | Description                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `TForkArgumentOptions` | Options for `forkArgument`: `generateId`, `checksumConfig`, `positionConfig`, `grammarConfig`                |
| `TForkRemapTable`      | Maps original entity IDs to forked counterparts: `argumentId`, `premises`, `expressions`, `variables` (Maps) |
| `TForkArgumentResult`  | Return type of `forkArgument`: `{ engine, remapTable }`                                                      |

All entity schemas now carry optional nullable `forkedFrom` provenance fields (e.g., `forkedFromArgumentId`, `forkedFromPremiseId`, etc.). These are `null`/absent on non-forked entities and populated by `forkArgument` on forked entities.

---

### Source and Claim-Source Types

| Type                            | Description                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TCoreSource`                   | Base source entity (`{ id, version, frozen, checksum }`)                                                                                                      |
| `TCoreClaim`                    | Base claim entity (`{ id, version, frozen, checksum }`)                                                                                                       |
| `TCoreClaimSourceAssociation`   | Links a claim version to a source version (`{ claimId, claimVersion, sourceId, sourceVersion, … }`)                                                           |
| `TClaimLookup`                  | Narrow read-only interface for claim lookups (`get(id, version)`)                                                                                             |
| `TClaimLibraryManagement`       | Full management interface for `ClaimLibrary` (extends `TClaimLookup`; adds `create`, `update`, `freeze`, `getCurrent`, `getAll`, `getVersions`, `snapshot`)   |
| `TSourceLookup`                 | Narrow read-only interface for source lookups (`get(id, version)`)                                                                                            |
| `TSourceLibraryManagement`      | Full management interface for `SourceLibrary` (extends `TSourceLookup`; adds `create`, `update`, `freeze`, `getCurrent`, `getAll`, `getVersions`, `snapshot`) |
| `TClaimSourceLookup`            | Narrow read-only interface for claim-source lookups (`getForClaim`, `getForSource`, `get`)                                                                    |
| `TClaimSourceLibraryManagement` | Full management interface for `ClaimSourceLibrary` (extends `TClaimSourceLookup`; adds `add`, `remove`, `getAll`, `filter`, `snapshot`)                       |
| `TClaimLibrarySnapshot`         | Snapshot type for `ClaimLibrary` state                                                                                                                        |
| `TSourceLibrarySnapshot`        | Snapshot type for `SourceLibrary` state                                                                                                                       |
| `TClaimSourceLibrarySnapshot`   | Snapshot type for `ClaimSourceLibrary` state                                                                                                                  |
