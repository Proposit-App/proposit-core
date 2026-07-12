# Spec — enrich `diffArguments` with an explicit four-state model

Core slice of epic `2026-07-12-argument-diff-unified-modification-semantics-cross-repo`.
Authoritative design (workspace root):
`docs/design/2026-07-12-argument-diff-modification-semantics.md`. This spec is the
concrete, file-grounded core-level design; it does not restate the cross-repo
model.

## Resolved open questions

### OQ3 — current `diffArguments` shape: **enrichment, not restructure**

The current output already carries the top-level structure the four-state model
needs — argument / variables / premises(+nested expressions) / roles. The gap is
an **explicit** own-vs-within state label and **reference-edge propagation**. No
structural teardown is required.

Current types (`src/lib/types/diff.ts`):

- `TCoreEntitySetDiff<T>` (lines 22-27): `{ added: T[]; removed: T[]; modified: TCoreEntityFieldDiff<T>[] }` — the three-bucket set diff, used for variables.
- `TCoreEntityFieldDiff<T>` (lines 16-20): `{ before: T; after: T; changes: TCoreFieldChange[] }` — a matched entity's own field-level changes.
- `TCorePremiseDiff` (lines 30-35): `extends TCoreEntityFieldDiff<TPremise>` and adds `expressions: TCoreEntitySetDiff<TExpr>` — so a premise diff already separates **own** field `changes` from **within** (`expressions`).
- `TCorePremiseSetDiff` (lines 37-44): `{ added; removed; modified: TCorePremiseDiff[] }`.
- `TCoreRoleDiff` (lines 47-49): `{ conclusion: { before: string | undefined; after: string | undefined } }` — **conclusion diffing already exists**.
- `TCoreArgumentDiff` (lines 52-62): `{ argument: TCoreEntityFieldDiff<TArg>; variables: TCoreEntitySetDiff<TVar>; premises: TCorePremiseSetDiff; roles: TCoreRoleDiff }`.

Current implementation (`src/lib/core/diff.ts`):

- `diffArguments` (lines 332-399) is comparator-driven and **flat** — expressions are diffed as one flat list per premise via `diffEntitySet` over `pe.getExpressions()` (lines 348-353, 216-221). It never consults checksums.
- `defaultCompareArgument` (lines 21-26) returns `[]` always — core argument has only identity fields (`id`, `version`); title/description are consumer extensions surfaced via a `compareArgument` override.
- `defaultCompareVariable` (lines 29-59) compares `symbol` plus binding fields `claimId`, `claimVersion`, `boundPremiseId`, `boundArgumentId`, `boundArgumentVersion` (lines 42-48).
- `defaultCompareExpression` (lines 70-115) compares `type`, `parentId`, `position`, and (type-polymorphically) `variableId` (variable exprs) / `operator` (operator exprs). **An in-place operator edit (`and`→`or`) already lands in `expressions.modified[].changes` today** — the invisibility reported in the design is purely the server reshape dropping it, not a core gap.
- `diffRoles` (lines 293-300) emits conclusion before/after; `roles` is a standalone top-level field never folded into `argument.changes`.

Checksum decomposition available to key own-vs-within (design's stated basis):

- Argument: `checksum` / `descendantChecksum` / `combinedChecksum` — `src/lib/schemata/argument.ts:8-18`.
- Expression: same three — `src/lib/schemata/propositional.ts:32-44`.
- Premise: same three — `src/lib/schemata/propositional.ts:187-197`.
- Variable: **`checksum` only** (`src/lib/schemata/propositional.ts:109-111`) — variables are containment leaves, so they have no `modified-within`; a matched variable is either `modified-own` or unchanged.

**Conclusion:** enrichment. Add a state discriminant + reference-edge
propagation on top of the existing comparator machinery. Keep comparator-driven
own-detection (not raw checksum equality) so the server's pluggable
`compareVariable` / `compareExpression` overrides continue to control what counts
as an "own" change (this is what lets the server later filter `boundArgumentVersion`
noise without core knowing about it). Comparator-returns-changes is the
implementation of "own `checksum` differs" for the fields the comparator inspects.

### OQ5 — derivation premises: **core filters nothing; nothing to leak**

There is **no** derivation/synthesized filter anywhere in the core diff path.
`diff.ts`, `collectVariables` (lines 302-319), and the premise/expression
collection (lines 344-353) walk **every** premise and variable the engine holds,
including derivation premises and the auto-created premise-bound variables
(README "Auto-variable creation"). Grep confirms zero `derivation` / `synthesi` /
`filter` references in `src/lib/core/diff.ts` and `src/lib/types/diff.ts`.

The design's "already filtered from the diff" refers to **upstream** pruning, not
a core diff filter: naked-Q derivation premises are deleted at server publish time
before storage (README line 862: "Server-side publish-time pruning deletes naked-Q
derivation premises before storage, so post-publish arguments never carry them").
The diff runs over stored/persisted arguments, so those pruned premises never
reach it — core has nothing to filter and nothing synthesized to inject.

**Consequence for the four-state model:** derivation premises diff exactly like
freeform premises (they are ordinary `TCorePremise`s). The uniform state rule
applies to them with no special case, so there is no synthesized within-change to
leak. The regression-lock (plan Task 7) asserts: (a) an unchanged derivation
premise produces no diff entry, and (b) editing a derivation premise's tree yields
the same own/within tagging as a freeform premise — proving no leakage and no
special-casing.

## Target design

### New state discriminant (`src/lib/types/diff.ts`)

```ts
export type TCoreDiffState =
    | "added"
    | "removed"
    | "modified-own"
    | "modified-within"
```

Tag matched (modified) entities with their `modified-*` state. `added`/`removed`
remain expressed by array membership as today; the discriminant on a
`TCoreEntityFieldDiff` / `TCorePremiseDiff` distinguishes own vs within. Concretely
add `state: "modified-own" | "modified-within"` to `TCoreEntityFieldDiff<T>` and
`TCorePremiseDiff`. The existing `added`/`removed`/`modified` arrays are retained
(additive, backward-shaped for the shared re-wrap).

### The one uniform rule

For each matched entity of any kind:

- **`modified-own`** — its own comparator returned field changes (≡ its `checksum`
  differs).
- **`modified-within`** — own comparator returned nothing, but at least one of:
  - a containment child changed (premise: a member of `expressions` was
    added/removed/modified — already computed at `diff.ts:222-233`;
    argument: any variable or premise added/removed/modified),
  - **a referenced entity is `modified-own`** (reference edge — new): a premise or
    expression whose variable-expression resolves to a variable that is
    `modified-own` becomes `modified-within`.
- entity omitted from `modified` entirely if neither own nor within changed.

An entity in `modified` today only for own/containment reasons keeps appearing;
the reference edge **adds** within-only entries (premises touched by a changed
claim) that are absent today.

### Reference-edge propagation (the genuinely new logic)

A claim edit surfaces as a variable's own change: `defaultCompareVariable` already
flags a `claimVersion` bump (`diff.ts:42-48`), so the claim-bound variable is
`modified-own`. Propagate `modified-within` along the reference edge:

variable `modified-own` → every expression that is a variable-expression pointing
at it (`expr.variableId === variable.id`) → the premise containing that expression.

Core walks only variable → expression → premise; it does **not** dereference the
claim body (design semantic #2: versioned references make change-detection local;
core deliberately does not own citations — design line 140). This is the
"reference-version awareness flowing through `defaultCompareExpression`" the design
calls for: the signal already lives on the variable's `claimVersion`; the
enrichment is traversing the edge to mark referencing containers.

### Conclusion-role folded into argument own-state

Per design semantic #1, `conclusionPremiseId` reassignment is *argument
own-content*. When `diffRoles` reports `conclusion.before !== conclusion.after`,
the argument's state is `modified-own` (even though `defaultCompareArgument`
returns `[]`). Keep the `roles` field for the detail; the enrichment is that
argument `state` now reflects a conclusion change, so a consumer reading only
`argument.state` sees it.

### Id-stability contract (doc comment on `diffArguments`)

Add to `diffArguments`' JSDoc (`src/lib/core/diff.ts:325-331`) the contract text
the whole `modified` state rests on, verbatim intent from design §"The invariant
it rests on":

> **Id-stability contract.** `modified` state is only expressible when an entity's
> id survives a content edit. Every version-producing path (copy/mutation,
> re-ingestion, reconcile) MUST preserve the id of any entity that logically
> persists across a version bump; mint a new id only for something genuinely new;
> drop an id only for something genuinely gone. A path that churns ids for
> persisted entities degrades every edit to remove + add. Enforcement is by
> construction plus a diff-stability test per version-producing path (unchanged
> content → empty diff; single edit → exactly one `modified-own` origin), not a
> runtime guard.

Mirror a one-line pointer in `PropositCore.diffArguments`' JSDoc
(`src/lib/core/proposit-core.ts:691-702`).

## Consumers touched inside core

- CLI `isDiffEmpty` (`src/cli/output/diff-renderer.ts:9-19`) and the renderer
  must keep compiling — the change is additive (`state` added; arrays retained).
  The renderer may optionally surface the state label, but the emptiness check is
  unchanged in meaning.
- `src/index.ts` / `src/lib/index.ts` re-export the diff types — export
  `TCoreDiffState`.

## Out of scope (other slices)

- Narrowing the server's `compareVariableIgnoringVersionMetadata` (`boundArgumentVersion`
  filter) — **server slice** (design semantic #2; OQ1). Core keeps
  `defaultCompareVariable` comparing all fields and exposes the pluggable override.
- Citation four-state, wire schema, render-intent policy — **shared slice**.
- Ancestor-operator `modified-within` for every interior operator whose descendant
  changed is derivable from `combinedChecksum` on the wire; core surfaces
  expression own-state and premise-level within (the render unit). Deeper
  per-operator within tagging is not built until a consumer needs it (YAGNI).
