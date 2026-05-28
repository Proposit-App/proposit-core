# v2 ingestion pipeline: axiomatic-claim handling produces unsplitable wire shape

## Status — RESOLVED in `proposit-server@v0.17.1` via the existing extension surface

**No core change required.** The user reviewed the original proposal and rejected both "widen core's wire shape" (Option 1) and "disable axiomatic in v2" (Option 2). Instead, the server adopts the extension surface used to its full potential: a custom `TIngestionExtension` (`propositServerExtension` at `src/services/tasks/executors/proposit-server-extension.ts`) that mirrors `basicsExtension` but replaces the free-form `BasicsAxiomaticClaimExtension.axiom: Type.String({maxLength: 50})` with `AxiomKindSchema` (six structured enum values).

The extension's `claimSchema` threads through `createIngestionV2Pipeline` into `claim-canonicalization`'s `outputSchema` (the structured-output JSON schema sent to the LLM). OpenAI strict-mode emits `enum` + `required` constraints from the TypeBox union, so the LLM can only produce axiomatic claims whose `axiomKind` is one of the six enum values. The server's custom parser subclass (`PropositServerArgumentParser`) carries `axiomKind` through `mapClaim`; `persistParserOutput` inserts the row directly with `type='axiomatic', axiom=axiomKind`.

**Verified end-to-end with the reproducer test** at `src/model/integrations/__tests__/common.test.ts` (the "task c448fb1e-…" case). No `claim-canonicalization` change in core needed because the stage already consumes `extension.claimSchema` correctly (`v2-multi-stage.js:57` → `createClaimCanonicalizationStage(extension, ...)` → `buildResponseSchema(extension)` → `buildClaimRecordSchema(extension.claimSchema)` walks the union branches with `additionalProperties: false`).

The remaining sections below describe the historical proposal for posterity; the resolution is the extension-override approach.

---

## Context

Server `v0.17.x` runs `createIngestionV2Pipeline` from
`@proposit/proposit-core@1.3.1` as the default ingestion path (slice
2D flipped `INGESTION_PIPELINE_VERSION` to `v2-multi-stage`; Task 7.B
bumped the dep to `^1.3.1`). The v2 pipeline's
`claim-canonicalization` + `claim-type-classification` stages can emit
claims with `type='axiomatic'` (per spec §7.2 + the stage prompts);
v1's single-shot pipeline never did. This is the first user-visible
divergence in the wire-shape contract between v1 and v2.

Real-world reproducer (user task `c448fb1e-05b3-44a4-afb9-88807f139adf`,
2026-05-27): importing Singer's "Solution to World Poverty" via
v2-multi-stage crashed `persistParserOutput` with

```
insert into "propositionalVariables" ... violates foreign key
constraint "propositional_variables_statement_id_argument_id_..."
detail: Key (claimId, argumentId, claimVersion) = (...) is not present
in table "claims".
```

A minimal-reproducer test exists at
`proposit-server/src/model/integrations/__tests__/common.test.ts` (the
`regression — task c448fb1e-...` case under `persistParserOutput`); it
fails reliably against current core 1.3.1.

## Problem

Three concrete issues, all rooted in the v2 axiomatic-claim wire
shape:

### 1. `BasicsAxiomaticClaimExtension.axiom` is a free-form string, not a structured `axiomKind`

Defined at `dist/extensions/basics/schemata.js:37`:

```ts
export const BasicsAxiomaticClaimExtension = Type.Object({
    axiom: Type.String({
        maxLength: 50,
        description: "The axiom supporting the claim",
    }),
    type: CoreClaimAxiomaticTypeSchema,
})
```

The v2 canonicalization stage's prompt says: _"Populate `axiom` with
the gist of the self-evident proposition."_ That free-form gist text
has no structural relationship to the **server-side allowlist** that
the `claims` table enforces:

```sql
claims_axiom_kind_check: axiom IS NULL OR axiom IN (
    'definition',
    'stipulation',
    'logical-principle',
    'mathematical-principle',
    'domain-rule',
    'background-assumption'
)
```

(Matching `@proposit/shared`'s `AxiomKindSchema` from 0.12.0 +
the model fn `assignClaimAxiom` in
`proposit-server/src/model/claim.ts`.) The server has **no
non-arbitrary way** to map a free-form `axiom` string (e.g. _"Suffering
is bad"_) to a structured `axiomKind` (one of six enum values).

### 2. Even if the server could insert axiomatic claims, `claim-canonicalization` does not currently emit the structured fields the server needs

For the server to persist an axiomatic claim under the existing DB
schema (and `assignClaimAxiom` model fn), the wire shape would need to
carry:

- `axiomKind: TAxiomKind` (one of the six enum values), and
- the free-form gist string (which today lives in `axiom`) in a
  separate slot — most naturally `body`, since the existing rendering
  surfaces treat `body` as the claim's prose.

Today `BasicsAxiomaticClaimExtension` exposes only `axiom: string` and
gives the LLM no slot for `axiomKind`. The system prompts for
`claim-canonicalization` and `claim-type-classification` make no
mention of `axiomKind` either.

### 3. The persistence-side FK violation has no clean server-only workaround

The server's `persistParserOutput`
(`src/model/integrations/common.ts:201-233`) deliberately **skips**
axiomatic claims from the `claims` table insert (the punt was
load-bearing pre-v2 — axiomatic claims existed in the wire shape but
the server's model layer wasn't ready for them).

But `engine.addVariable` is called for **every** variable whose
`claimMiniId` resolves to a registered claim, including axiomatic
ones (the parser's `claimMiniIdToId` map registers all claims
regardless of type — see `argument-parser.js:236-247`). So
`engine.snapshot().variables` carries variables whose `claimId`
points at axiomatic claims that the server never inserted. The
downstream `persistChangeset` insert into `propositionalVariables`
then trips the FK to `claims` and the import fails.

The candidate server-only workarounds all have load-bearing
downsides:

- **(a) Drop axiomatic-bound variables before `persistChangeset`.**
  But any premise formula that references an axiomatic-bound
  variable's symbol (e.g. _R implies P_) becomes unsatisfiable — the
  formula's expression tree references a variable that was dropped.
  Cascading drops of premises + their expressions get hairy.
- **(b) Insert axiomatic claims with a synthesized `axiomKind`.** The
  only honest synthesis is `'background-assumption'` (the most
  generic value). Losing the LLM's free-form rationale (it falls into
  `body` or is discarded). Also leaves the wire-shape mismatch alive
  in code — every consumer of `parsed.claims[i].axiom` would need
  the same dance.
- **(c) Strip axiomatic claims from the response before
  `parser.build()`.** Forces the server to know about the canonical
  v2 output shape; couples the consumer to internal pipeline detail.

None of these is fixable without changes that look like the cleaner
fix should live in core / shared.

## Proposed change (in core)

Two options. The team picks one; the server adapts to whichever
lands.

### Option 1 (preferred): make the v2 wire shape carry `axiomKind` + structured-axiom semantics

Three coordinated changes:

1. **Widen `BasicsAxiomaticClaimExtension`** to:

    ```ts
    export const BasicsAxiomaticClaimExtension = Type.Object({
        title: Type.String({ maxLength: 50 }), // gist (was `axiom`)
        body: Type.Optional(Type.String({ maxLength: 500 })), // optional fuller body
        axiomKind: TAxiomKind, // one of six enum values
        type: CoreClaimAxiomaticTypeSchema,
    })
    ```

    The free-form gist text moves from the slot called `axiom` to the
    standard `title` slot (consistent with normal claims). The new
    `axiomKind` field is the structured discriminator that the DB +
    `assignClaimAxiom` expect. Re-exports of `TAxiomKind` from
    `@proposit/shared` (or a core-local mirror) are fine.

2. **Update `claim-canonicalization`'s system prompt** to instruct
   the LLM to emit `axiomKind` alongside the gist text, with
   examples for each of the six enum values. The current prompt's
   "axiom (gist of the self-evident proposition)" guidance moves
   into the `title` slot.

3. **Update `claim-type-classification`'s system prompt** likewise,
   so the type-refinement stage can flip a canonicalizer's draft
   type from `'normal'` to `'axiomatic'` AND assign a sensible
   `axiomKind`.

After these, the server can `INSERT INTO claims (type='axiomatic',
axiomKind=...)` directly from `parsedClaim.axiomKind`. No mapping,
no synthesis, no FK violations.

### Option 2: have v2 emit no axiomatic classifications until Option 1 lands

A clean stopgap: gate the axiomatic branch of
`claim-type-classification` behind a config flag (default off), or
remove the `'axiomatic'` literal from
`BasicsAxiomaticClaimExtension` for now. The v1 invariant ("no
axiomatic claims in the wire shape") then holds for v2 too, and
v2's existing claim coverage falls back to `'normal'` /
`'citation'` only.

Trade-off: loses the v2 stage's ability to model self-evident
premises. But it unblocks v0.17.1 with no server-side workaround
debt.

## Test cases

In core (post-fix):

1. The v2 canonicalization stage, given a synthetic input with one
   obvious axiomatic phrase ("by definition X is Y"), emits a
   canonical claim with `type='axiomatic'` AND
   `axiomKind='definition'` (Option 1), or never emits
   `type='axiomatic'` (Option 2).
2. `finalize-response-v2`'s output for that input round-trips
   through `BasicsArgumentParser.validate` → `.build()` → an
   `ArgumentEngine` snapshot whose variable claimIds resolve
   cleanly.

In server (post-core-fix + dep bump):

1. The existing reproducer test in
   `src/model/integrations/__tests__/common.test.ts` (search:
   `regression — task c448fb1e`) goes green without server-side
   changes (Option 2) or with an `axiomKind` pass-through in
   `persistParserOutput` (Option 1).
2. A new integration test exercises a v2 import that produces an
   axiomatic claim end-to-end; the resulting argument has a
   `claims` row with `type='axiomatic' AND axiomKind IS NOT
NULL`; the bound variable's FK resolves.

## Impact on the server

- **No server-side bug fix is being shipped today.** v0.17.1 lands
  with the duration-display fix (already merged) but with v2-multi-stage
  imports of axiomatic-touching inputs known-broken. The user's
  reproducer (Singer's "Solution to World Poverty") will continue to
  crash until core ships the fix.
- Once core ships v1.3.2 with the Option 1 or Option 2 shape, the
  server bumps its dep and (under Option 1) adds an `axiomKind`
  pass-through alongside the existing normal/citation branches in
  `persistParserOutput`. The reproducer test goes green at that
  point; v0.17.2 ships with the fix.
- The deliberate `// axiomatic claims are not yet supported on the
server` comment at `common.ts:211-213` becomes obsolete and is
  removed when v0.17.2 lands. The DB columns + check constraints
  for axiomatic claims have been in place since shared 0.12.0; only
  the wire-shape gap blocks adoption.

## Decision needed from the human

Per `proposit-server/CLAUDE.md`'s change-request protocol: **wait for
core v1.3.2, or land a server-side workaround in v0.17.1?**

- **Wait (recommended).** Cleanest fix path. Imports of
  axiomatic-touching inputs stay broken in v0.17.1; the user lives
  with that until v0.17.2. The workaround surface is zero — the fix
  is upstream.
- **Workaround.** Land Option (b) (synthesize `axiomKind:
'background-assumption'` for every axiomatic claim, push the
  free-form `axiom` string into `body`) in v0.17.1 as a tactical
  unblock. The reproducer test goes green now; the wire-shape gap
  is papered over server-side; the core fix later removes the
  workaround. ~30-50 lines of code in `persistParserOutput` plus
  the test.
