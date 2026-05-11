# Axiomatic claim type — design spec

**Date:** 2026-05-11
**Target version:** v0.12.0
**Status:** Approved for planning

## Summary

Introduce a third claim type — `axiomatic` — alongside the existing `normal` and `citation` types. Axiomatic claims represent self-evident propositions invoked as the bottom-level "proof" of a derived claim's truth, parallel to how citation claims represent external cited evidence.

The change spans:

1. The claim type discriminator (`src/lib/schemata/claim.ts`).
2. A new `ClaimAxiomLibrary` parallel to `ClaimCitationLibrary`, both implementing a generalized `TClaimConnectionLibraryManagement<TConn>` interface.
3. A breaking rename of citation-library terminology and snapshot shape ("edge" → "connection", `citingClaimId`/`sourceClaimId` → `claimId`/`supportingClaimId`).
4. A unified `populateFromSupports` helper on `ManagedDerivationPremiseEngine` (replaces `populateFromCitations`).
5. Evaluation semantics that auto-evaluate axiomatic claim-bound variables as `true` (non-overridable) and default citation claim-bound variables to `true` (overridable).
6. A `.proposit-v0.12` CLI snapshot migration.
7. CLI extensions demonstrating the consumer-extension pattern: a typed `reasonCode` field on axiomatic CLI claims, with three preset reasons (`true-by-definition`, `historically-established`, `logically-required`), and a new `axioms` command group.

## Motivation

Derivation premises currently decompose into two kinds of bottom-level support:

- **Chain of logic** — the antecedent references other claims in the argument via claim-bound variables to other premises.
- **Citations** — the antecedent references citation claims (`type: "citation"`) supplied by `ClaimCitationLibrary` and rendered into the antecedent via `populateFromCitations`.

This forces every derivation to either chain further or terminate in cited external content. There is no first-class way to say "this claim is true because it is self-evident" — propositions like "true by definition," "historically established," or "logically required." Today such propositions get awkwardly modeled as citations to a fake source, or as ungrounded normal claims that the caller manually assigns truth values to.

A third claim type, `axiomatic`, makes this case first-class. Its evaluation semantics encode the meaning of the type (axioms are true by virtue of being axioms), while its structural integration with derivation premises mirrors citations so the same UX patterns apply.

## Design choices locked in during brainstorming

- **Type name:** `axiomatic`.
- **Reason data shape:** core adds only the discriminator (`type: "axiomatic"`). The reason value (e.g., `"true-by-definition"`) is consumer-extension territory, carried via the existing `additionalProperties: true` on `CoreClaimSchema`. The CLI provides a reference implementation of this extension pattern.
- **Library architecture:** a separate `ClaimAxiomLibrary` parallel to `ClaimCitationLibrary`. Both implement a generic `TClaimConnectionLibraryManagement<TConn>` interface.
- **Terminology:** "connection" replaces "edge" (no graph-theory jargon in public API). Edge endpoint fields rename `citingClaimId` → `claimId` and `sourceClaimId` → `supportingClaimId`.
- **Reverse lookup dropped:** `getCitationsForSourceClaim` had zero production callers. The generic interface exposes only the forward direction (`getConnectionsForClaim`).
- **Single populate helper:** `populateFromSupports(citationLib, axiomLib, argEngine)` replaces `populateFromCitations`. The combined case is the most realistic call; the two-helper alternative would have required relaxing the naked-Q precondition.
- **Evaluation:** axiomatic claim-bound variables always evaluate to `true` and cannot be overridden. Citation claim-bound variables default to `true` but the caller may override. Normal claim-bound variables behave as today. The axiom-rejection mechanism is the existing `toggleNegation` on the variable expression in the antecedent (`not(true) = false`).
- **Snapshot migration:** v0.12 CLI marker; library throws `LEGACY_MISSING_AXIOM_SLOT` on a pre-v0.12 snapshot in non-CLI contexts, forcing explicit migration.

## Capability changes

This is a library-level structural change with no per-route or per-screen capability documents to update in `proposit-core`. The orchestrator's product-layer capability docs (`../../../proposit-core/docs/capabilities/*` does not exist in this repo; relevant capabilities live in consuming repos) may need updates downstream once the type lands.

## Detailed design

### 1. Schema additions

**`src/lib/schemata/claim.ts`** — expand the `type` discriminator:

```ts
type: Type.Union(
    [Type.Literal("normal"), Type.Literal("citation"), Type.Literal("axiomatic")],
    {
        description:
            "Distinguishes claim roles: 'normal' = primary-reasoning, 'citation' = external cited content, 'axiomatic' = self-evident invoked claim. Immutable post-creation.",
    }
)
```

`CoreClaimSchema` already has `additionalProperties: true`, so app-layer reason data (`reasonCode`, etc.) rides on the claim with no core change.

**`src/lib/schemata/claim-connection.ts`** *(new)* — generic edge base schema with neutral field names:

```ts
export const CoreClaimConnectionSchema = Type.Object(
    {
        id: Type.String({ description: "Unique identifier for this connection." }),
        claimId: Type.String({ description: "The claim being supported." }),
        claimVersion: Type.Number({
            description: "Version of the supported claim this connection pins to.",
        }),
        supportingClaimId: Type.String({
            description:
                "The claim that supports — cited evidence or invoked axiom.",
        }),
        supportingClaimVersion: Type.Number({
            description: "Version of the supporting claim this connection pins to.",
        }),
        checksum: Type.String({ description: "Connection checksum for sync detection." }),
    },
    {
        additionalProperties: true,
        description:
            "A directional support edge between two claims. The supported claim is at claimId; the claim that supplies the support is at supportingClaimId. Specialized into citation and axiom connections by which library the entity lives in.",
    }
)
export type TCoreClaimConnection = Static<typeof CoreClaimConnectionSchema>
```

**`src/lib/schemata/claim-citation.ts`** — `CoreClaimCitationSchema` becomes a re-export/alias of `CoreClaimConnectionSchema` (citation-specific description text). `TCoreClaimCitation` remains a nominally distinct alias of `TCoreClaimConnection`. Field names switch from `citingClaimId`/`sourceClaimId` to `claimId`/`supportingClaimId`.

**`src/lib/schemata/claim-axiom.ts`** *(new)* — parallel to `claim-citation.ts`. Same shape, axiom-specific descriptions.

**`src/lib/schemata/index.ts`** — re-export new types.

### 2. Interfaces and libraries

**`src/lib/core/interfaces/library.interfaces.ts`** — replace citation-specific interfaces with generic ones:

```ts
export interface TClaimConnectionLookup<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
> {
    /** Returns all connections where the given claim is the supported endpoint. */
    getConnectionsForClaim(claimId: string): TConn[]

    /** Returns a connection by ID, or undefined if not found. */
    get(id: string): TConn | undefined
}

export interface TClaimConnectionLibraryManagement<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
> extends TClaimConnectionLookup<TConn> {
    add(connection: Omit<TConn, "checksum">): TConn
    remove(id: string): TConn
    getAll(): TConn[]
    filter(predicate: (c: TConn) => boolean): TConn[]
    snapshot(): TClaimConnectionLibrarySnapshot<TConn>
    validate(): TInvariantValidationResult
}

export type TClaimConnectionLibrarySnapshot<
    TConn extends TCoreClaimConnection = TCoreClaimConnection,
> = { connections: TConn[] }
```

Deleted: `TClaimCitationLookup`, `TClaimCitationLibraryManagement`, `TClaimCitationLibrarySnapshot`, and the reverse-lookup method `getCitationsForSourceClaim`.

**`src/lib/core/claim-citation-library.ts`** — `ClaimCitationLibrary` is reworked to implement `TClaimConnectionLibraryManagement<TCoreClaimCitation>`:

- Drop `sourceClaimToCitations` reverse index. Keep only the forward index; rename to `claimToConnections`.
- Rename methods: `getCitationsForCitingClaim` → `getConnectionsForClaim`. Delete `getCitationsForSourceClaim`.
- Rename error code: `CITATION_SOURCE_NOT_CITATION_TYPE` → `CITATION_SUPPORTING_NOT_CITATION_TYPE`. Also `CITATION_CITING_REF_NOT_FOUND` → `CITATION_CLAIM_REF_NOT_FOUND` and `CITATION_SOURCE_REF_NOT_FOUND` → `CITATION_SUPPORTING_REF_NOT_FOUND`.
- Cycle detection still applies (it always did, since citations can chain). Uses the renamed forward index.
- `entityType` on violations stays `"citation"`.

**`src/lib/core/claim-axiom-library.ts`** *(new)* — mirror class implementing `TClaimConnectionLibraryManagement<TCoreClaimAxiom>`:

- Same forward index `claimToConnections`.
- Constructor: `(claimLookup: TClaimLookup, options?: { checksumConfig? })`. Identical signature to citation library.
- `add(connection)` validates:
  - Both endpoints resolve in `ClaimLibrary` (`AXIOM_CLAIM_REF_NOT_FOUND`, `AXIOM_SUPPORTING_REF_NOT_FOUND`).
  - Supporting-side `claim.type === "axiomatic"` (`AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE`).
  - Dependent-side `claim.type === "normal"` (`AXIOM_CLAIM_NOT_NORMAL_TYPE`). Citation claims cannot be supported by axioms — axioms support primary-reasoning claims only.
- **No cycle detection.** Axiomatic claims cannot appear on the dependent side (enforced by `AXIOM_CLAIM_NOT_NORMAL_TYPE`), so cycles are structurally impossible. `validate()` skips the cycle pass; this is documented as an intentional asymmetry from the citation library.
- `validate()` re-runs the supporting-side-type, dependent-side-type, resolution, and schema checks (catches tampered snapshots).
- `fromSnapshot(snapshot, claimLookup, options)` — symmetric with `ClaimCitationLibrary.fromSnapshot`.
- `entityType` on all violations is `"axiom"`.

**`src/lib/utils/lookup.ts`** — `EMPTY_CLAIM_CITATION_LOOKUP` becomes `EMPTY_CLAIM_CONNECTION_LOOKUP` (single empty stub serves both libraries via the generic interface). Old export deleted (no deprecation alias — bundled into the v0.12 break).

**Checksum config** — `claimCitationFields` value updates (field renames). New sibling `claimAxiomFields` with the same default field list. Both fire fresh checksum computation during v0.12 CLI migration.

### 3. PropositCore wiring + forking + snapshot

**`src/lib/core/proposit-core.ts`**

- New public field `axioms: ClaimAxiomLibrary<TAxiom>` parallel to `claimCitations`.
- Constructor wires both libraries against the same `claimLookup` adapter.
- New generic type parameter `TAxiom extends TCoreClaimAxiom = TCoreClaimAxiom`.
- `forkArgument` transitive walk gains one additional reachability step: after collecting citation-supporting claims via `claimCitations.getConnectionsForClaim(currentId)`, also collect `axioms.getConnectionsForClaim(currentId)` supporting claims into the same frontier. Both sets feed the same `claimRemap`. Cloned citation connections go into the new fork's `claimCitations`; cloned axiom connections go into the new fork's `axioms`. Endpoints in each are remapped through `claimRemap`.
- `diffArguments` unaffected — connections are global, not per-argument.

**`src/lib/core/fork-library.ts`** — no namespace change. Axiomatic claims live in the existing `claims` namespace. No fork records for axiom connections (matches the citation precedent).

**`TPropositCoreSnapshot`** — adds `claimAxioms: TClaimConnectionLibrarySnapshot<TAxiom>` slot. Existing `claimCitations` slot keeps its outer name; its inner wrapper field renames `claimCitations` → `connections`.

**`PropositCore.snapshot()`** and **`PropositCore.fromSnapshot()`** — symmetric reads/writes. `fromSnapshot` throws `LEGACY_MISSING_AXIOM_SLOT` when `claimAxioms` is absent and `LEGACY_CLAIM_CITATION_SHAPE` when the citation wrapper uses the legacy inner field name.

### 4. Engine integration

**`src/lib/core/managed-derivation-premise-engine.ts`**

**`populateFromSupports(citationLib, axiomLib, argumentEngine)`** *(replaces `populateFromCitations`)*

- Same naked-Q precondition. Throws `DERIVATION_ANTECEDENT_NON_EMPTY` if the antecedent slot is already filled.
- Collects supporting claim IDs from both `citationLib.getConnectionsForClaim(derivedClaimId)` and `axiomLib.getConnectionsForClaim(derivedClaimId)`. Citations first, axioms second; source order preserved within each.
- `n=0` → no-op (naked-Q stays).
- `n=1` → `IMPLIES(VarExpr(S1), Q)`.
- `n≥2` → `IMPLIES(formula(OR(VarExpr(S1), …, VarExpr(Sn))), Q)`. Formula buffer auto-inserted by `wrapInsertFormula`.
- Materializes claim-bound variables via `argumentEngine.ensureClaimBoundVariable(supportingClaimId)` for each supporter; registers them into the engine's `VariableManager` (same pattern as the current code).
- Uses `super.*` mutation calls to bypass the engine's own validation overrides during construction; ends with `assertWellFormed()`.

**`populateFromCitations` is deleted.** Release notes call out the rename and the new axiom arg.

**Private antecedent-builder** — the construction logic is extracted into a private method `buildAntecedentFromSupportingVariables(supportingVars: TClaimBoundVariable[]): void`. Single caller today, kept private and separate for future reuse.

**`TVariableMaterializer`** — no change.

### 5. Snapshot migration (v0.12)

Two shape changes need to flow through stored data:

1. **Connection wrapper field rename.** `claimCitations` wrapper switches from `{ claimCitations: TCitation[] }` to `{ connections: TCitation[] }`. New sibling `claimAxioms: { connections: TAxiom[] }`.
2. **Edge field renames.** Each citation entity's `citingClaimId` → `claimId`, `citingClaimVersion` → `claimVersion`, `sourceClaimId` → `supportingClaimId`, `sourceClaimVersion` → `supportingClaimVersion`. Stored `checksum` becomes stale; recomputed from new field names + updated config.

**Approach: CLI-gated one-shot backfill**, matching v0.11's pattern.

- **`.proposit-v0.12` marker file** in the CLI state directory. Presence means "this state has already been migrated to v0.12."
- **CLI startup migration step**, gated by marker absence:
  1. Read the raw state file JSON.
  2. For `claimCitations`: detect the legacy inner key (`claimCitations: [...]`) and rewrite to `connections: [...]`. Walk each citation, rename the four edge fields.
  3. Recompute each citation's `checksum` using v0.12 `claimCitationFields`.
  4. Initialize `claimAxioms: { connections: [] }` — this is a required, explicit step.
  5. Write migrated state back. Write `.proposit-v0.12` marker.
- **Strict in-memory model.** `ClaimCitationLibrary.fromSnapshot` throws `LEGACY_CLAIM_CITATION_SHAPE` on legacy-shaped data. `PropositCore.fromSnapshot` throws `LEGACY_MISSING_AXIOM_SLOT` when `claimAxioms` is absent (not silently filled).
- **Forward compatibility.** Snapshots written by v0.12 may contain claims with `type: "axiomatic"`. Older library versions will fail `Value.Check` against the union — no back-compat path. The version bump signals the break.

### 6. Errors, tests, base docs

**New error codes** (`src/lib/types/validation.ts`):

- Citation library renames: `CITATION_SOURCE_NOT_CITATION_TYPE` → `CITATION_SUPPORTING_NOT_CITATION_TYPE`; `CITATION_CITING_REF_NOT_FOUND` → `CITATION_CLAIM_REF_NOT_FOUND`; `CITATION_SOURCE_REF_NOT_FOUND` → `CITATION_SUPPORTING_REF_NOT_FOUND`.
- Axiom library: `AXIOM_SCHEMA_INVALID`, `AXIOM_DUPLICATE_ID`, `AXIOM_CLAIM_REF_NOT_FOUND`, `AXIOM_SUPPORTING_REF_NOT_FOUND`, `AXIOM_SUPPORTING_NOT_AXIOMATIC_TYPE`, `AXIOM_CLAIM_NOT_NORMAL_TYPE`.
- Evaluation: `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
- Legacy migration: `LEGACY_CLAIM_CITATION_SHAPE`, `LEGACY_MISSING_AXIOM_SLOT`.

**Tests** (`test/core.test.ts`) — new `describe` blocks at file bottom, inline fixtures per project convention:

- `ClaimAxiomLibrary` — create/remove/get/getAll/filter/snapshot/fromSnapshot/validate. One block per method, mirroring the existing `ClaimCitationLibrary` block structure.
- `ClaimAxiomLibrary` invariants — supporting-side type, dependent-side type, missing refs, duplicate IDs. Cycle detection N/A (proven by structural impossibility — covered by one explanatory test).
- `populateFromSupports` — naked-Q precondition; n=0/1/n citations only; n=0/1/n axioms only; mixed citations + axioms; ordering (citations before axioms); shared OR node; auto-inserted formula buffer for n ≥ 2.
- Snapshot round-trip — `PropositCore.fromSnapshot` with `claimAxioms` present; throws `LEGACY_MISSING_AXIOM_SLOT` when absent; throws `LEGACY_CLAIM_CITATION_SHAPE` for legacy citation wrapper.
- Forking — fork an argument whose derived claims have both citation and axiom support; verify the new fork's `axioms` library has clones with remapped claim IDs.
- Claim type guard — creating a `type: "axiomatic"` claim; `ClaimLibrary.update` rejects type changes from/to `'axiomatic'`.

**Examples** (`examples/arguments/*.yaml`) — add one fixture with an axiom-backed derivation premise. `test/examples.test.ts` picks it up via the existing glob.

### 7. CLI extension as reference consumer

**Reason codes** — fixed initial set, kebab-cased for argv:
- `true-by-definition`
- `historically-established`
- `logically-required`

Single source-of-truth constant in `src/cli/schemata.ts` (help text, schema validation, and `claims list` display all draw from the same union).

**CLI claim schema** (`src/cli/schemata.ts`) — discriminated union extending `TCoreClaim` with the reason field, scoped to axiomatic claims:

```ts
export const CliAxiomReasonCode = Type.Union([
    Type.Literal("true-by-definition"),
    Type.Literal("historically-established"),
    Type.Literal("logically-required"),
])
export type TCliAxiomReasonCode = Static<typeof CliAxiomReasonCode>

const CliClaimBase = Type.Object({
    id: UUID,
    version: Type.Number(),
    frozen: Type.Boolean(),
    checksum: Type.String(),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
})

export const CliClaimSchema = Type.Union([
    Type.Composite([CliClaimBase, Type.Object({ type: Type.Literal("normal") })]),
    Type.Composite([CliClaimBase, Type.Object({ type: Type.Literal("citation") })]),
    Type.Composite([
        CliClaimBase,
        Type.Object({
            type: Type.Literal("axiomatic"),
            reasonCode: CliAxiomReasonCode,
        }),
    ]),
])
export type TCliClaim = Static<typeof CliClaimSchema>
```

`reasonCode` is required on axiomatic claims and absent on the others. This is the reference example for library consumers — "here's how you discriminate extension fields by claim type with TypeBox."

**`claims add` extension** (`src/cli/commands/claims.ts`):

- New accepted value: `--type axiomatic`.
- New flag: `--reason <code>`. Required when `--type axiomatic`; rejected for `normal`/`citation`. Validated against `CliAxiomReasonCode`.
- `--title` and `--body` continue to work as application metadata.

**`claims update` enforcement** — reason code is immutable. The update command rejects `--reason <code>` for any claim (mirroring the core `type` immutability), preserving the "reason determines the axiom's identity" invariant at the CLI layer.

**`claims list` / `claims show`** — display a reason badge for axiomatic claims (`[axiom: true-by-definition]`), parallel to citations' `[citation]` badge.

**New `axioms` command group** (`src/cli/commands/axioms.ts`) — mirrors the existing `citations` command group:

- `axioms list [--json]` — list all axiom connections via `core.axioms.getAll()`.
- `axioms show <connection_id> [--json]` — show a single connection.
- `axioms add --claim-id <id> --supporting-claim-id <axiomId>` — create a connection. Errors propagate from `ClaimAxiomLibrary.add`.
- `axioms remove <connection_id>` — delete a connection.

Registered in the CLI program alongside the citations group.

**`premises populate-supports <premiseId>`** *(new CLI command)* — small wrapper around `ManagedDerivationPremiseEngine.populateFromSupports` that pulls both libraries from the loaded `PropositCore`. Useful for the smoke test and as a demo of the helper.

**Smoke test** (`scripts/smoke-test.sh`) — add coverage:

- Create an axiomatic claim of each reason kind.
- Reject `claims add --type axiomatic` without `--reason`.
- Reject `claims add --type axiomatic --reason bogus`.
- Reject `claims update --reason ...` for an axiomatic claim.
- Create an axiom connection; verify it appears in `axioms list`.
- Reject an axiom connection where the supporting claim is not `type: axiomatic`.
- Reject an axiom connection where the supported claim is not `type: normal`.
- End-to-end: create a derivation premise backed by both a citation and an axiom; run `premises populate-supports`; verify the antecedent shape.
- Run the v0.12 migration on a pre-v0.12 state directory; verify the marker is written and subsequent commands succeed.

### 8. Evaluation semantics

**Three behaviors by claim type for claim-bound variables:**

| Claim type | Evaluation behavior | Caller override |
|---|---|---|
| `normal` | Caller assigns; unassigned → `null` (today's behavior) | N/A |
| `citation` | Defaults to `true` if caller doesn't assign | Yes — caller may assign `true`/`false`/`null` |
| `axiomatic` | Forced to `true` | No — caller attempts are rejected pre-flight |

**Rejection mechanism for axioms.** The supported pattern for expressing "I want this derivation NOT to be supported by this axiom" is to negate the variable expression in the antecedent via existing `toggleNegation`. `not(true) = false`, so the negated axiom contributes `false` to its parent operator. This works today with no new mechanism — it's the engine's standard negation, applied to the axiom's variable expression in the antecedent only (the consequent variable expression remains protected by `assertNotConsequentExpression`).

**Implementation location.** `ArgumentEngine` already holds a reference to `claimLibrary` via its constructor, so the evaluator can resolve claim types without an API change. A pre-pass at the start of `evaluate()` and `checkValidity()` walks the argument's claim-bound variables, looks up each claim's type, and produces an "effective assignments" map:

- For `type === "axiomatic"` variables: force `true`, regardless of any caller value.
- For `type === "citation"` variables: fill `true` when the caller's map has no entry; honor the caller's value otherwise.
- For `type === "normal"` variables: pass through caller's value (or `null` if absent), same as today.

The rest of the evaluator operates on the effective map and stays type-agnostic.

**Pre-flight validation (`validateEvaluability`)**:

- Axiomatic variables are excluded from "missing assignment" warnings.
- Citation variables are excluded from "missing assignment" warnings.
- Normal variables remain flagged for missing assignment as today.
- New violation: `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` — fires when the caller's assignment map contains an entry for an axiomatic-bound variable, regardless of the assigned value. Blocks `evaluate()` and `checkValidity()` from running. The message names the variable and the claim and points the caller at the "negate the antecedent variable expression" pattern.

**Behavior change for existing citation callers.** Previously, an unassigned citation-bound variable evaluated as `null`; now it evaluates as `true` by default. Callers depending on the `null`-as-unassigned behavior must start explicitly assigning `null`. Likely rare in practice; documented in release notes.

**Tests:**

- Axiomatic variable evaluates to `true`; explicit caller assignment is rejected pre-flight (`AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`).
- Citation variable defaults to `true` when unassigned.
- Citation variable honors explicit assignment (`true`, `false`, `null`).
- Pre-flight does NOT emit missing-assignment for axiomatic or citation variables.
- `not(axiomVar)` in an antecedent contributes `false` (regression test for the rejection pattern).
- Round-trip: a derivation premise backed by an axiom where the antecedent's `OR` includes `not(axiom1)` — the negated axiom doesn't pull the antecedent true on its own.

## Documentation Sync triggers

All entries below fire and are covered by per-section notes above:

- `README.md` — `Public-API`, `Public-CLI-API`, `Validation-Rules`. New "Evaluation semantics by claim type" subsection. New CLI section subsection on the axiom claim/connection commands. "Invalid Constructions" section gets entries for the new axiom invariants and the eval pre-flight error.
- `docs/api-reference.md` — `Public-API`. Full surface for `ClaimAxiomLibrary`, `TClaimConnectionLookup`, `TClaimConnectionLibraryManagement`, `populateFromSupports`. `evaluate()`/`checkValidity()`/`validateEvaluability()` claim-type-aware docs.
- `CLAUDE.md` — `Public-API`. Rewrite the **Claim type discriminator**, **Claim library**, **Citation acyclicity**, **`ClaimCitationLibrary` constructor**, **`populateFromCitations` helper**, **Argument forking**, **ForkLibrary 5 namespaces** bullets. Add **Axiom library** bullet. Add **Evaluation defaults by claim type** bullet (table from section 8 plus negation-as-rejection note).
- `CLI_EXAMPLES.md` — `Public-CLI-API`. New walkthrough using an axiomatic claim ("a claim defended as `true-by-definition`") and an axiom connection. Demonstrates the extension pattern alongside the existing citation flow.
- `scripts/smoke-test.sh` — `Public-CLI-API`. Coverage listed in section 7.
- `src/lib/core/interfaces/library.interfaces.ts` — `Public-Engine-API`. JSDoc for renamed/new interfaces.
- `src/lib/core/proposit-core.ts` — `Public-API`. JSDoc for new `axioms` field and `forkArgument`'s expanded reachability walk.
- `examples/arguments/*.yaml` — `Argument-Schema`. New axiom-backed example.
- `docs/release-notes/upcoming.md` — `Public-API`. User-facing summary: new axiomatic claim type, axiom library, support helper rename, eval semantics change for citations, snapshot migration.
- `docs/changelogs/upcoming.md` — `Any-Code-Change`. Developer changelog with commit ranges.

## Risks and open questions

- **Citation eval behavior change.** Defaulting unassigned citation variables to `true` is a semantic change for existing arguments. Mitigation: clear release-note call-out; behavior is what most callers actually want.
- **Cycle detection asymmetry.** `ClaimCitationLibrary` runs cycle detection; `ClaimAxiomLibrary` does not. Justified by the structural impossibility (axiomatic claims can't be on the dependent side), but documented as an intentional difference in `CLAUDE.md`.
- **Connection-vs-edge naming.** "Connection" is informal but unambiguous. We considered "association" and "relation" — "relation" overloads with DB/math terminology; "association" reads more clinical.
- **Deprecation cycle.** No deprecation window for `populateFromCitations`, `getCitationsForCitingClaim`, `EMPTY_CLAIM_CITATION_LOOKUP`, or `CITATION_SOURCE_NOT_CITATION_TYPE`. Direct rename in v0.12, justified by the existing v0.12 breaking-change cycle.

## Out of scope

- Server-side persistence shape changes in `proposit-server` (downstream concern, lands after publishing).
- Mobile-side handling in `proposit-mobile` (downstream concern).
- Additional axiom reason codes beyond the initial three. Easy to add later in CLI.
- A more elaborate axiom-rejection mechanism (e.g., per-derivation axiom blacklist). The negation-in-antecedent pattern suffices for v0.12.
