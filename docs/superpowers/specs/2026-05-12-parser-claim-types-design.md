# Type-aware argument parser via formula inference

**Status:** Design draft
**Owner:** Brian Cefali
**Target version:** patch bump (next release after v0.12.1)

## Problem

The LLM-driven argument parser in `src/lib/parsing/` was designed before the
claim-type discriminator (`'normal' | 'citation' | 'axiomatic'`) and the split
between `ClaimCitationLibrary` and `ClaimAxiomLibrary` landed. As a result:

- The parsed-claim schema carries a `citationMiniIds` array on every claim
  that lists which citation-typed claims back it. This duplicates information
  that the propositional formulas already encode (or should encode).
- The miniId convention in the system prompt asks the LLM to use distinct
  prefixes (`c`, `s`, `a`) for normal vs citation vs axiomatic claims. With a
  `type` discriminator now present on every claim, the prefix distinction is
  redundant noise.
- The parser builds a `ClaimCitationLibrary` but does **not** build a
  `ClaimAxiomLibrary`, even though axiomatic claims have been first-class in
  core since v0.12. Axiom-typed claims emitted by the LLM are dropped on the
  floor at the support-graph layer.
- The `mapClaimCitation` hook gives override authors the citing claim and two
  IDs, but not the supporting claim's parsed form — limiting the kinds of
  extension fields a consumer can compute for an edge.

## Goals

1. Unify the miniId convention so every claim shares one prefix space and the
   `type` field is the sole discriminator.
2. Drop `citationMiniIds` from the parsed-claim schema. Derive citation and
   axiom edges from premise formulas: any citation- or axiomatic-typed claim
   whose variable appears in the antecedent of an `implies`/`iff` premise
   automatically becomes a support edge against the consequent claim.
3. Have the parser build and return both `ClaimCitationLibrary` and
   `ClaimAxiomLibrary`.
4. Update the `mapClaimCitation` hook signature to expose the supporting claim
   alongside the dependent, and add a sibling `mapClaimAxiom` hook.
5. Update the LLM system prompt to describe the new model.

## Non-goals

- Pre-populating the parser with a fixed catalog of axiomatic claims for the
  LLM to choose from (e.g., a closed enum of "well-known axioms"). Consumers
  who want this today can already constrain axiom-specific extension fields
  via a closed `Type.Union([Type.Literal(...), ...])` in their schema
  extension; a catalog-injection feature is a separate future spec.
- Parser-side semantic validation of claim-type relationships beyond what the
  libraries' own `add()` methods already enforce. The parser routes edges and
  lets the libraries throw on invariant violations.
- Backwards compatibility shims for the old `citationMiniIds` field. Parsed
  output is a live LLM artifact, not persisted state — there is no on-disk
  migration to write.

## Design

### Parsed-claim schema

`ParsedClaimSchema` in `src/lib/parsing/schemata.ts` keeps only the core
identification and routing fields:

```ts
export const ParsedClaimSchema = Type.Object(
    {
        miniId: Type.String(),
        role: ParsedClaimRoleType,
        type: ParsedClaimTypeType,
    },
    { additionalProperties: true }
)
```

The `citationMiniIds` field is removed. The corresponding entry in
`CORE_CLAIM_KEYS` (`src/lib/parsing/prompt-builder.ts:8`) drops to
`["miniId", "role", "type"]`.

### Unified miniId convention

All parsed claims share a single prefix in the LLM-facing convention.
Recommended: `c1, c2, c3, ...` for every claim regardless of `type`. Variables
keep `v` and premises keep `p`. The `type` field carries the kind information
that used to be smuggled through the prefix.

### Formula-inferred citation and axiom edges

After parsing premises and constructing variables, the parser walks each
premise whose root expression is `implies` or `iff`:

1. The **consequent claim** is the bound claim of the variable referenced at
   the position-1 child of the root. This mirrors the convention enforced by
   `ManagedDerivationPremiseEngine` (Q is always the right-hand child for
   both `implies` and `iff`).
2. The **antecedent variables** are every variable reference reachable from
   the position-0 (and any other non-1) child, regardless of polarity. A
   variable wrapped in `not`, nested inside `and`/`or`, or appearing under a
   `formula` buffer all count equally — the edge graph cares about *which*
   claims participate, not how they are combined propositionally.
3. For each antecedent variable, look at its bound claim's `type`:
   - `'citation'` → accumulate citation edge `(consequentClaim,
     antecedentClaim)`.
   - `'axiomatic'` → accumulate axiom edge `(consequentClaim,
     antecedentClaim)`.
   - `'normal'` → no edge; the antecedent is part of the argument's
     reasoning, not an external support.

Edges are deduped by `(claimId, supportingClaimId)` per library before any
`add()` call — if multiple premises express the same support relationship,
only one library record is created.

Library invariants are not duplicated at the parser layer. The parser calls
`claimCitationLibrary.add(...)` and `claimAxiomLibrary.add(...)`; any throws
(cycle, axiom-dependent-not-normal, supporting-side type mismatch) propagate
in strict mode and are wrapped as warnings in non-strict mode.

### Result type changes

`ArgumentParser` gains a `TAxiom extends TCoreClaimConnection` type parameter
matching the existing `TCitation` parameter. The result type updates:

```ts
export type TArgumentParserResult<
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

Both libraries are always present in the result, even if empty. The parser
constructs `claimAxiomLibrary = new ClaimAxiomLibrary<TAxiom>(claimLibrary)`
alongside the existing `claimCitationLibrary`.

### Mapping-hook updates

`mapClaimCitation` changes its signature to expose the supporting parsed
claim, and a sibling `mapClaimAxiom` is added with the same shape:

```ts
protected mapClaimCitation(
    _dependentParsed: TParsedClaim,
    _supportingParsed: TParsedClaim,
    _dependentClaimId: string,
    _supportingClaimId: string,
): Record<string, unknown> {
    return {}
}

protected mapClaimAxiom(
    _dependentParsed: TParsedClaim,
    _supportingParsed: TParsedClaim,
    _dependentClaimId: string,
    _supportingClaimId: string,
): Record<string, unknown> {
    return {}
}
```

This is a breaking signature change to a `protected` hook. `extensions/basics`
does not override `mapClaimCitation` today, so the impact is contained to
external consumers who have subclassed `ArgumentParser` and overridden the
citation mapper.

### Prompt rewrite (`CORE_PROMPT`)

Section-by-section changes in `src/lib/parsing/prompt-builder.ts`:

- **Claim Types** — keep the three-type taxonomy. Remove the sentence about
  axiomatic claims not having a separate cross-reference field; with the new
  model, axiomatic-typed claims are referenced through the same mechanism as
  any other claim: via the formulas that mention their variables. Add a brief
  note that consumers will typically constrain axiom-specific extension
  fields (e.g., `reasonCode`, `axiom`) to a closed enum via their schema
  extension.
- **Citation Links** — delete this whole section. Replaced by:
- **Support via Formulas** (new section, replacing Citation Links) —
  explicitly tell the LLM: "To express that a citation- or axiomatic-typed
  claim supports a normal claim, include the supporting claim's variable in
  the antecedent of an `implies` or `iff` premise whose consequent (position-1
  child) is the supported claim's variable. The parser infers the citation
  and axiom graphs from these formulas; you do not list supports as a
  separate field."
- **MiniId Conventions** — collapse `c`/`s`/`a` to one prefix. The
  cross-type-reference notes about `citationMiniIds` become irrelevant and
  are removed; the `claimMiniId` and `conclusionPremiseMiniId` notes stay
  (they're still valid).
- **Self-Check** — remove item #5 (`citationMiniIds` invariant) and item #6
  is reworded slightly. The renumbered checklist has five items:
  1. Every formula symbol is declared in `variables`.
  2. Every `variable.claimMiniId` resolves.
  3. `conclusionPremiseMiniId` resolves.
  4. No `implies`/`iff` nested inside another operator.
  5. Every claim has a `type` of `"normal"`, `"citation"`, or
     `"axiomatic"`.

### Warning-code updates

In `src/lib/parsing/types.ts`:

- Remove `UNRESOLVED_CITATION_MINIID` from `TParserWarningCode`. Without the
  `citationMiniIds` field there is no unresolved-citation-id path.
- Add `CITATION_EDGE_REJECTED` and `AXIOM_EDGE_REJECTED` for non-strict mode
  wrapping of library throws (`add()` errors such as cycles or dependent-type
  mismatches).

In `src/lib/parsing/argument-parser.ts`:

- Replace the existing citation-walking pass (current `argument-parser.ts`
  lines 363–403) with the formula-inference pass described above.
- The new pass runs **after** premise creation (step 7) since it needs the
  built expression tree; it uses the per-premise root expression from the
  engine, the variables map, and the `claimMiniIdToId` lookup that already
  exists.

### Test updates

- `test/integration/parse-api.test.ts` — drop `citationMiniIds: []` from
  fixtures. Add at least one case where a parsed premise has the form
  `IMPLIES(c_citation_var, c_normal_var)` and assert that the resulting
  `claimCitationLibrary` contains exactly one edge with the expected
  dependent/supporting claim IDs. Add an axiom variant
  (`IMPLIES(c_axiom_var, c_normal_var)`) that asserts
  `claimAxiomLibrary` membership.
- `test/extensions/basics.test.ts` — drop `citationMiniIds: []` from
  fixtures.
- New unit tests (`test/core.test.ts` or a sibling `test/parser.test.ts`):
  - Citation edge extracted from antecedent (single citation in antecedent).
  - Multiple citations in `OR` antecedent produce multiple edges.
  - Axiomatic claim in antecedent produces an axiom edge in
    `claimAxiomLibrary`, not in `claimCitationLibrary`.
  - Mixed antecedent (citation + axiom + normal) produces one citation edge,
    one axiom edge, no entry for the normal claim.
  - Duplicate `(claimId, supportingClaimId)` across premises produces a
    single library edge (dedup).
  - Negated antecedent variable still produces an edge (polarity does not
    matter for edge extraction).
  - Non-strict mode: library throw (cycle in citation library) becomes a
    `CITATION_EDGE_REJECTED` warning rather than an exception.
  - Strict mode: same scenario throws.
  - Empty result: a parse with no `implies`/`iff` premise produces empty
    citation and axiom libraries, both returned in the result.

### Extensions impact

- `extensions/basics/schemata.ts` — unchanged. `BasicsClaimExtension`'s three
  per-type branches still slot into the unchanged core `ParsedClaimSchema`
  via `buildParsingResponseSchema`.
- `extensions/basics/argument-parser.ts` — unchanged. The class overrides
  only `mapArgument`, `mapClaim`, `mapPremise`; none of them touch the
  citation or axiom hooks.

## Versioning

Patch bump. Although the parser API surface changes (schema field removal,
new type parameter, hook signature update), there is no persisted-data
migration; the affected surface is internal to a single library release and
extensions do not depend on the changed shapes.

## Documentation sync triggers expected to fire

Per the `Documentation Sync` section of this repo's `CLAUDE.md`:

- `README.md` [Public-API] — only if the README mentions `citationMiniIds`
  or the c/s/a miniId convention explicitly. (Likely not; will verify during
  implementation.)
- `docs/api-reference.md` [Public-API] — parser API change: result-type
  shape, type-parameter list, hook signatures.
- `CLAUDE.md` [Public-API] — design rules section if any rule references the
  old field name or prefix convention.
- `docs/release-notes/upcoming.md` [Public-API] — user-facing summary of the
  parser change.
- `docs/changelogs/upcoming.md` [Any-Code-Change] — developer changelog.
