# Upcoming release notes

> **Working draft for `@proposit/proposit-core@1.0.0`.** Content is
> stable; specific symbol names will be reconciled against the final
> implementation before the publish commit renames this file to
> `v1.0.0.md`.

`1.0.0` is a major release. The grammar enforcement model is rebuilt
from the ground up. There is **no deprecation period** — the pre-1.0
`grammarConfig` / `autoNormalize` / `ManagedDerivationPremiseEngine`
machinery is removed outright. Migration is short but breaking.

## What's new

### The four-tier grammar model

Grammar enforcement splits into four tiers in a strict subset chain:

```
Structural  ⊇  Evaluable  ⊇  Derivable  ⊇  Presentable
(most permissive)                           (most restrictive)
```

- **Structural** is the floor: data integrity, FK soundness, unique IDs and variable symbols, fixed-arity invariants for `not`/`formula`/`implies`/`iff`, sibling-position uniqueness, derivation-premise root-operator restrictions. Mutations throw on Structural violations.
- **Evaluable** is what `evaluate()` and `checkValidity()` need —
  variadic-arity floor for `and`/`or`, resolvable variable bindings,
  consequent presence in derivation premises, claim-derivation pairing
  cardinality, conclusion-premise designation. These are returned as
  violation lists, never thrown.
- **Derivable** is the canonical-form constraint for derivation
  premises and the placement of typed claims (citation, axiomatic).
  Surfaced via `validate('derivable')` for UI hints.
- **Presentable** is the ideal shape — formula buffers between
  operators, no double negation, no single-leaf or single-child
  formulas, no same-operator adjacency through a formula. The publish
  endpoint enforces this tier.

See `docs/Proposit_Grammar.md` for the full rule inventory and worked
examples.

### `validate(tier)`

```ts
const issues = engine.validate("presentable")
// → readonly TViolation[]
```

Returns violations across all tiers _up to and including_ the requested
tier. Never throws on grammar issues. `TViolation`, `TGrammarTier`, and
`TGrammarRuleCode` are defined here in `proposit-core` (as TypeBox
schemas in `src/lib/grammar/types.ts`) and re-exported from
`@proposit/shared/schemas/grammar` for `proposit-server` and
`proposit-mobile`.

### `normalize(tier?)`

```ts
engine.normalize() // defaults to 'presentable'
```

Explicit, user-initiated global pass that converges the argument toward
the requested tier without changing logical meaning. Never deletes a
variable, never changes a claim reference, never modifies an operator's
semantics. Cannot recover from Evaluable or Derivable violations — those
need user intent, exposed via the repair primitives. In `1.0.0` every
auto-normalization rule targets a Presentable invariant, so calls with
`tier` ∈ {`structural`, `evaluable`, `derivable`} are forward-compatible
no-ops.

### Engine behavior: `'assistive' | 'permissive'`

```ts
const engine = new ArgumentEngine(arg, claims, citations, {
    behavior: "assistive", // default
})
engine.setBehavior("permissive")
```

- **`assistive`** (default): the engine runs auto-normalization (AN-1..AN-4)
  as a post-hook after every successful Structural mutation. AN preserves
  Presentable — if the pre-mutation state was Presentable, the
  post-mutation state is Presentable.
- **`permissive`**: AN does not run. The engine accepts mutations that
  leave the argument outside the Presentable / Derivable / Evaluable
  tiers (down to but not including Structural). Power users opt in
  through their advanced-mode preference; `proposit-server` / `proposit-mobile`
  wire this through to the engine.

There is **no per-rule opt-in or opt-out** — assistive runs the full AN
set, permissive runs none.

### Repair primitives

For Evaluable and Derivable violations that `normalize()` cannot resolve
(because the fix would change argument meaning), targeted repair
primitives expose user-initiated destructive fixes. Each returns the
violations it resolved, for UX confirmation messaging / undo /
"we made these N changes" feedback. They respect the engine's `behavior`
— AN runs after the repair in assistive mode, doesn't in permissive.
See the API reference for the current list.

### `populateFromCitations` / `populateFromAxioms`

```ts
// before (pre-1.0):
managed.populateFromSupports(citations, axioms, materializer)
// → IMPLIES(OR(cit-vars + axiom-vars), Q)   — illegal under 1.0 (D-3)

// after (1.0):
engine.populateFromCitations(derivedClaimId) // citations only
engine.populateFromAxioms(derivedClaimId) // axioms only
```

Two methods, one per grounding kind. Each operates on one grounding kind
at a time — there is no silent dropping of user-provided data at
runtime. Switching grounding kinds on the same derivation premise is
"empty the antecedent, then call the other method"; the premise
persists across the switch.

### Fork inherits `behavior`

`forkArgumentEngine(source, …)` and `PropositCore.forkArgument(id, …)`
both inherit the source engine's `behavior` setting (`'assistive'` or
`'permissive'`) in the forked engine. Pass `options.behavior` to
override — useful for flows that fork a permissive editing state into
an assistive "publish-ready" copy.

Pre-1.0 the fork path silently reset the forked engine to the default
`'assistive'` (`behavior` was deliberately omitted from snapshots, and
the fork path rebuilds via `fromSnapshot`). 1.0 threads the setting
through both fork entry points.

### Snapshot loading accepts any Structural state

`fromSnapshot()` and `fromData()` no longer take a `grammarConfig`
parameter. They load any Structural-valid snapshot. Lower-tier
violations are queryable post-load via `validate(tier)`. The only load
failure is a truly broken (non-Structural) snapshot, which throws with
the violation list.

### Naked-Q derivation premises are a valid evaluation no-op

A derivation premise whose tree is a single variable at the root
(naked-Q form, "no grounding added yet") is a **valid Derivable state**
and a **no-op for evaluation**. Pre-1.0 the engine threw
`DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` when `evaluate()` or
`checkValidity()` hit a naked-Q. In 1.0 those methods skip naked-Q
premises — they neither assert their consequent nor support its
derivation.

The publish-time pruning step (server-side) deletes naked-Q derivation
premises before storage, so post-publish arguments never carry them.

## What's removed (no deprecation period)

If your code references any of these names, it needs to be updated
before bumping to 1.0:

| Removed name                                                | Replacement                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `grammarConfig` constructor option                          | `behavior: 'assistive' \| 'permissive'`                                                          |
| `grammarConfig.autoNormalize` (boolean or object form)      | Engine `behavior` setting                                                                        |
| `grammarConfig.enforceFormulaBetweenOperators`              | Folded into AN-1 post-hook + Presentable rule P-1                                                |
| `TGrammarConfig`, `TGrammarOptions`, `TAutoNormalizeConfig` | _(removed types)_                                                                                |
| `DEFAULT_GRAMMAR_CONFIG`, `PERMISSIVE_GRAMMAR_CONFIG`       | _(removed constants)_                                                                            |
| `resolveAutoNormalize(...)`                                 | _(removed helper)_                                                                               |
| `LOAD_GRAMMAR_CONFIG`, `STRICT_GRAMMAR_CONFIG`              | Snapshot loading always accepts Structural state                                                 |
| `ManagedDerivationPremiseEngine`                            | Regular `PremiseEngine` + `engine.validate('derivable')`                                         |
| `TVariableMaterializer`                                     | _(removed type)_                                                                                 |
| `populateFromSupports(...)`                                 | `populateFromCitations` + `populateFromAxioms`                                                   |
| `validateDerivationStructure(...)` standalone utility       | `validateD1(...)` from the grammar module (or `engine.validate('derivable')` filtered for `D-1`) |
| `engine.validateDerivationStructures()`                     | `engine.validate('derivable').filter(v => v.code === 'D-1')`                                     |
| `DERIVATION_STRUCTURE_INVALID_AT_EVALUATION` error code     | _(removed; naked-Q is now a valid eval no-op)_                                                   |
| `EXPR_FORMULA_BETWEEN_OPERATORS_VIOLATED` error code        | _(removed; P-1 surfaces via `engine.validate('presentable')`)_                                   |
| `engine.validate()` no-arg overload                         | `engine.validateInvariants()` (returns the same `TInvariantValidationResult`)                    |

## Wire format coordination

The grammar rule-code namespace (`TGrammarRuleCode`) lives in
`proposit-core` (`src/lib/grammar/types.ts`). Adding or renaming a code
is a single-repo coordinated change here — extend the TypeBox union and
ship the validator implementation in the same commit. The two
error-code namespaces (engine errors in `src/lib/types/validation.ts`
vs grammar-rule codes in `src/lib/grammar/types.ts`) are both stable
wire format — server and mobile pick up changes via dep bumps.

`@proposit/shared@0.9.0` re-exports the grammar wire format from
`@proposit/shared/schemas/grammar` and adds the 422 response envelope
(`GrammarViolationsResponseSchema`) that composes `TViolation`. Shared
0.9.0 publishes _after_ this release.

This release has **no new dependencies** — wire-format types live in
core's own source tree.

## Legacy snapshot loading

Pre-1.0 snapshots load under the new model: 1.0 is strictly _more_
permissive at load time than any pre-1.0 configuration. Snapshots that
carried states the pre-1.0 engine would have rejected as
"non-Presentable" load fine in 1.0 and surface their issues via
`validate(tier)` for the UI to render inline. The pre-1.0 `LEGACY_*`
load-failure codes for genuinely broken snapshots continue to throw at
the library level (claim library, citation library, axiom library)
before any engine is constructed.

A small number of pre-1.0 stored arguments may carry mixed-grounding
derivation antecedents (axioms + citations in one premise). Those
violate the new D-3 rule (no mixing). The server-side migration drops
the axiom-bound variables from those antecedents and preserves the
citations, audit-logging every change. Users see a "needs cleanup" hint
in the UI for any residue.
