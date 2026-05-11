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
5. Evaluation semantics that auto-evaluate axiomatic claim-bound variables as `true` (non-overridable). Citation and normal claim-bound variables continue to behave exactly as today — caller must assign explicitly. Apps that want auto-true defaults for citations implement that policy at the consumer layer (e.g., the CLI's `analysis create` command).
6. A `.proposit-v0.12` CLI multi-file snapshot migration (rewrites `claim-citations.json` shape, initializes `claim-axioms.json`).
7. CLI extensions demonstrating the consumer-extension pattern: a typed `reasonCode` field on axiomatic CLI claims, with three preset reasons (`true-by-definition`, `historically-established`, `logically-required`), and a new `axioms` command group.
8. YAML import + LLM-extraction (`src/lib/parsing/`) widened to accept the `axiomatic` type.

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
- **Evaluation:** axiomatic claim-bound variables always evaluate to `true` and cannot be overridden. Citation and normal claim-bound variables behave as today (caller assigns explicitly; unassigned → `null`). The axiom-rejection mechanism is the existing `toggleNegation` on the variable expression in the antecedent (`not(true) = false`).
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
- **`wouldCreateCycle` short-circuit rename.** The existing optimization in `ClaimCitationLibrary.wouldCreateCycle` (current code: bails when `citingClaimType === "normal"`) becomes "bails when the supported-side claim has `type === "normal"`" — the supported side is what would need to also appear on a supporting side to close a cycle, and `normal` claims cannot be on a supporting side. Same logic, renamed reference.
- `validate()` re-runs the supporting-side-type, dependent-side-type, resolution, and schema checks (catches tampered snapshots).
- `fromSnapshot(snapshot, claimLookup, options)` — symmetric with `ClaimCitationLibrary.fromSnapshot`.
- `entityType` on all violations is `"axiom"`.

**`src/lib/utils/lookup.ts`** — `EMPTY_CLAIM_CITATION_LOOKUP` becomes a generic factory `emptyClaimConnectionLookup<TConn extends TCoreClaimConnection>(): TClaimConnectionLookup<TConn>`. A bare constant won't type-check at both `TClaimConnectionLookup<TCoreClaimCitation>` and `TClaimConnectionLookup<TCoreClaimAxiom>` callsites without casts; the factory closes over the generic parameter so each callsite gets a properly narrowed empty. Old export deleted (no deprecation alias — bundled into the v0.12 break).

**Checksum config** — `claimCitationFields` value updates (field renames). New sibling `claimAxiomFields` with the same default field list. Both fire fresh checksum computation during v0.12 CLI migration.

### 3. PropositCore wiring + forking + snapshot

**`src/lib/core/proposit-core.ts`**

- New public field `axioms: ClaimAxiomLibrary<TAxiom>` parallel to `claimCitations`.
- Constructor wires both libraries against the same `claimLookup` adapter.
- New generic type parameter `TAxiom extends TCoreClaimAxiom = TCoreClaimAxiom`.
- `forkArgument` transitive walk gains one additional reachability step: after collecting citation-supporting claims via `claimCitations.getConnectionsForClaim(currentId)`, also collect `axioms.getConnectionsForClaim(currentId)` supporting claims into the same frontier. Both sets feed the same `claimRemap`. Cloned citation connections go into the new fork's `claimCitations`; cloned axiom connections go into the new fork's `axioms`. Endpoints in each are remapped through `claimRemap`. Cloned axiom connections pin to `claimVersion: 0` and `supportingClaimVersion: 0` (parallel to the existing citation-clone behavior at `proposit-core.ts:466-470`).
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

CLI state is stored across multiple files (not a single state file):

- `{stateDir}/claims.json` — claim library snapshot
- `{stateDir}/claim-citations.json` — citation library snapshot (legacy shape: `{ claimCitations: [...with citingClaimId/sourceClaimId fields...] }`)
- `{stateDir}/forks.json` — fork library snapshot
- `{stateDir}/arguments/{argId}/{version}/...` — per-argument tree

Three shape changes need to flow through stored data:

1. **Citation wrapper field rename.** `claim-citations.json` switches from `{ claimCitations: TCitation[] }` to `{ connections: TCitation[] }`.
2. **Citation edge field renames.** Each citation entity's `citingClaimId` → `claimId`, `citingClaimVersion` → `claimVersion`, `sourceClaimId` → `supportingClaimId`, `sourceClaimVersion` → `supportingClaimVersion`. Stored `checksum` becomes stale; recomputed from new field names + updated `claimCitationFields` config.
3. **New axiom snapshot file.** `claim-axioms.json` must exist initialized to `{ connections: [] }`.

`claims.json` and per-argument files are unchanged shape-wise (no field renames or new required fields land on those entities).

**Approach: CLI-gated one-shot backfill** (`src/cli/storage/migrate-v0.12.ts`), matching the v0.11 and v0.10 migration pattern.

- **`.proposit-v0.12` marker file** in the CLI state directory. Presence means "this state has already been migrated to v0.12."
- **CLI startup migration step**, gated by marker absence:
  1. Read `{stateDir}/claim-citations.json` as raw JSON.
  2. Detect legacy shape by structural check: `"claimCitations" in snapshot && !("connections" in snapshot)`. (If the file is fresh-format already — e.g., user manually re-created state — skip the rewrite; just verify shape.)
  3. Rewrite the outer wrapper: `{ claimCitations: [...] }` → `{ connections: [...] }`.
  4. Walk each citation, rename the four edge fields.
  5. Recompute each citation's `checksum` from v0.12 `claimCitationFields` (use the same `entityChecksum` helper the library uses at runtime).
  6. Write the rewritten content back to `claim-citations.json`.
  7. If `{stateDir}/claim-axioms.json` does not exist, create it with `{ connections: [] }`.
  8. Write `.proposit-v0.12` marker.
- **Wiring.** `migrateV012()` is invoked from `src/cli/engine.ts` ahead of `hydratePropositCore`, in the same place v0.11 and v0.10 migrations run today.
- **Storage updates.** `src/cli/storage/libraries.ts` gains `claimAxiomsPath()`, `readClaimAxiomLibrary()`, and `writeClaimAxiomLibrary()` parallel to the existing citation helpers. `hydratePropositCore` reads `claim-axioms.json` and threads it into `PropositCore`'s constructor.

**Strict in-memory model.** Library-side detection must happen on the raw JSON shape before TypeScript coerces it to the new typed snapshot.

- `ClaimCitationLibrary.fromSnapshot(snapshot, claimLookup, options)` runs a structural pre-check on `snapshot` before treating it as `TClaimConnectionLibrarySnapshot<TCoreClaimCitation>`: if `snapshot` contains the legacy `claimCitations` field or any element has the legacy `citingClaimId` field, throw `LEGACY_CLAIM_CITATION_SHAPE` with an actionable message ("run the v0.12 CLI migration"). The check uses unknown-typed inspection, not the typed `Value.Check`, so legacy shapes don't silently coerce.
- `PropositCore.fromSnapshot(snapshot, …)` runs the same kind of pre-check: if `claimAxioms` is absent from `snapshot`, throw `LEGACY_MISSING_AXIOM_SLOT` with an actionable message.
- These guards protect non-CLI consumers (server, mobile, library users with their own persistence layer) from silently loading legacy data.

**Forward compatibility.** Snapshots written by v0.12 may contain claims with `type: "axiomatic"`. Older library versions will fail `Value.Check` against the union — no back-compat path. The version bump signals the break.

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

**YAML import schema** (`src/lib/schemata/import.ts`) — `CoreYamlClaimSchema.type` is currently `Type.Union([Type.Literal("normal"), Type.Literal("citation")])`. Widen to include `Type.Literal("axiomatic")`. The optional consumer-extension `reasonCode` field rides on `additionalProperties` (core stays minimal — the import schema accepts any extra fields, and the CLI parser/loader is responsible for validating `reasonCode` against `CliAxiomReasonCode` if it's present). Document this in the YAML import section of `README.md`.

**Parser/prompt builder** (`src/lib/parsing/prompt-builder.ts` and `src/lib/parsing/schemata.ts`) — currently restrict the LLM-extraction claim type to `normal | citation`. Update the schema and prompt to support `axiomatic` claims. The prompt-builder needs updated examples and the "claim type rules" section needs an axiomatic entry. (If we choose not to teach the parser axioms in this pass, document the restriction explicitly and add a TODO; my recommendation is to include them since they're now a first-class type. Open question — see Risks.)

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

**`claims update` enforcement** — reason code is immutable. The update command does not declare a `--reason` flag, so commander rejects it as an unknown option automatically. No additional command-level guard is needed; documentation in `claims update --help` notes that reason codes are set at creation only.

**`claims list` / `claims show`** — display a reason badge for axiomatic claims (`[axiom: true-by-definition]`), parallel to citations' `[citation]` badge.

**New `axioms` command group** (`src/cli/commands/axioms.ts`) — mirrors the existing `citations` command group:

- `axioms list [--json]` — list all axiom connections via `core.axioms.getAll()`.
- `axioms show <connection_id> [--json]` — show a single connection.
- `axioms add --claim-id <id> --axiom-id <axiomId>` — create a connection. Errors propagate from `ClaimAxiomLibrary.add`. (Flag name differs from `citations add --supporting-claim-id` because in the axiom command group, the supporting side is always an axiom claim — the more specific name reads better at the call site.)
- `axioms remove <connection_id>` — delete a connection.

Registered in the CLI program alongside the citations group.

**`premises populate-supports <premiseId>`** *(new CLI command)* — small wrapper around `ManagedDerivationPremiseEngine.populateFromSupports` that pulls both libraries from the loaded `PropositCore`. Useful for the smoke test and as a demo of the helper.

**Smoke test** (`scripts/smoke-test.sh`) — add coverage:

- Create an axiomatic claim of each reason kind.
- Reject `claims add --type axiomatic` without `--reason`.
- Reject `claims add --type axiomatic --reason bogus`.
- `claims update` rejects `--reason ...` automatically (unknown flag), for any claim type.
- Create an axiom connection; verify it appears in `axioms list`.
- Reject an axiom connection where the supporting claim is not `type: axiomatic`.
- Reject an axiom connection where the supported claim is not `type: normal`.
- End-to-end: create a derivation premise backed by both a citation and an axiom; run `premises populate-supports`; verify the antecedent shape.
- Run the v0.12 migration on a pre-v0.12 state directory; verify the marker is written and subsequent commands succeed.

### 8. Evaluation semantics

**Behaviors by claim type for claim-bound variables:**

| Claim type | Evaluation behavior | Caller override |
|---|---|---|
| `normal` | Caller assigns; unassigned → `null` | Yes — standard |
| `citation` | Caller assigns; unassigned → `null` | Yes — standard |
| `axiomatic` | Forced to `true` | No — caller attempts are rejected pre-flight |

Only axiomatic claims gain new evaluation semantics. Citations and normal claims continue to behave exactly as today — the caller is responsible for assigning truth values. Apps that want to treat unassigned citations as `true` by default implement that policy at their own layer (e.g., the CLI's `analysis create` command can auto-assign `true` for all citation-bound variables at analysis creation time).

**Rejection mechanism for axioms.** The supported pattern for expressing "I want this derivation NOT to be supported by this axiom" is to negate the variable expression in the antecedent via existing `toggleNegation`. `not(true) = false`, so the negated axiom contributes `false` to its parent operator. This works today with no new mechanism — it's the engine's standard negation, applied to the axiom's variable expression in the antecedent only (the consequent variable expression remains protected by `assertNotConsequentExpression`).

**`iff` interaction note.** Per the existing CLAUDE.md note, `iff`-rooted derivations propagate in both directions: an axiom-backed derivation rooted at `iff` forces the consequent `Q` from the axiom's `true`, and (via biconditional) forces the antecedent from a known-true `Q`. This composes correctly under Kleene semantics — the axiom's value is fixed, the biconditional propagation runs as today — but it's worth noting because it means an axiom-backed `iff` derivation can drive truth values into other premises sharing the same claim-bound variable for `Q`.

**Implementation location.** `ArgumentEngine` already holds a reference to `claimLibrary` via its constructor, so the evaluator can resolve claim types without an API change. A pre-pass at the start of `evaluate()` and `checkValidity()` walks the argument's claim-bound variables, looks up each claim's type, and produces an "effective assignments" map:

- For `type === "axiomatic"` variables: force `true`, regardless of any caller value.
- For `type === "citation"` and `type === "normal"` variables: pass through caller's value unchanged.

The rest of the evaluator operates on the effective map and stays type-agnostic.

**Pre-flight validation (`validateEvaluability`)**:

- New violation: `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN` — fires when the caller's assignment map contains an entry for an axiomatic-bound variable, regardless of the assigned value. Blocks `evaluate()` and `checkValidity()` from running. The message names the variable and the claim and points the caller at the "negate the antecedent variable expression" pattern.
- No other pre-flight changes. `validateEvaluability` does not currently emit "missing assignment" warnings for any claim-bound variable, and this design does not add them.

**`checkArgumentValidity` enumeration carve-out.** `checkArgumentValidity` enumerates `2^n` truth assignments over the argument's claim-bound variables to find admissible assignments and counterexamples. Axiomatic-bound variables must be **excluded** from the enumeration set — their value is fixed at `true` and they are not a free choice. Concretely:

- `checkedVariableIds` excludes any variable where the bound claim has `type === "axiomatic"`.
- Each generated `assignment.variables` map implicitly fixes axiomatic-bound variables to `true` via the same pre-pass that `evaluate()` runs.
- Citation-bound variables remain in the enumeration set (they are free choices for validity-check purposes, same as normal variables).
- Counts (`numAdmissibleAssignments`, counterexample search space) are computed against the reduced enumeration set.

**Tests:**

- Axiomatic variable evaluates to `true`; explicit caller assignment is rejected pre-flight (`AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`).
- Citation and normal variables behave unchanged from today's tests (regression check — no behavior shift).
- `not(axiomVar)` in an antecedent contributes `false` (regression test for the rejection pattern).
- Round-trip: a derivation premise backed by an axiom where the antecedent's `OR` includes `not(axiom1)` — the negated axiom doesn't pull the antecedent true on its own.
- `checkArgumentValidity` over an argument that includes axiomatic-bound variables: enumeration excludes them; counts reflect `2^(n - axiomatic_count)`.
- `iff`-rooted derivation backed by an axiom forces the consequent `Q` to `true` (propagation through biconditional).

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
- `docs/release-notes/upcoming.md` — `Public-API`. User-facing summary: new axiomatic claim type, axiom library, support helper rename, axiomatic evaluation semantics, snapshot migration. No citation behavior change to call out (citations continue to require explicit assignment).
- `docs/changelogs/upcoming.md` — `Any-Code-Change`. Developer changelog with commit ranges.

## Risks and open questions

- **Cycle detection asymmetry.** `ClaimCitationLibrary` runs cycle detection; `ClaimAxiomLibrary` does not. Justified by the structural impossibility (axiomatic claims can't be on the dependent side), but documented as an intentional difference in `CLAUDE.md`.
- **Connection-vs-edge naming.** "Connection" is informal but unambiguous. We considered "association" and "relation" — "relation" overloads with DB/math terminology; "association" reads more clinical.
- **Deprecation cycle.** No deprecation window for `populateFromCitations`, `getCitationsForCitingClaim`, `EMPTY_CLAIM_CITATION_LOOKUP`, or `CITATION_SOURCE_NOT_CITATION_TYPE`. Direct rename in v0.12, justified by the existing v0.12 breaking-change cycle.
- **Parser/prompt-builder coverage.** Open question whether the LLM extraction path (`src/lib/parsing/prompt-builder.ts`) should learn about axiomatic claims in this same release, or wait for a follow-up. Recommendation: include in scope so the new type isn't second-class on day one. Implementation lands as part of section 6 work.
- **Default reason for parsed/imported axioms.** If a user supplies an axiomatic claim via YAML import or LLM parse without a `reasonCode`, the CLI layer needs to either reject the input or supply a default. Recommendation: reject with a clear error (the consumer-extension contract is that `reasonCode` is required for axiomatic claims at the CLI level). Library imports without `reasonCode` are accepted by core (since `additionalProperties` is permissive) but the CLI rejects post-import.

## Out of scope

- Server-side persistence shape changes in `proposit-server` (downstream concern, lands after publishing).
- Mobile-side handling in `proposit-mobile` (downstream concern).
- Additional axiom reason codes beyond the initial three. Easy to add later in CLI.
- A more elaborate axiom-rejection mechanism (e.g., per-derivation axiom blacklist). The negation-in-antecedent pattern suffices for v0.12.
