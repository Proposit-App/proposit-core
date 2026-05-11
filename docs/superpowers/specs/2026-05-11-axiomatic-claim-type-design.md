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
3a. A symmetry-driven rename of `PropositCore.claimCitations` → `PropositCore.citations`, snapshot slot `claimCitations` → `citations`, file `claim-citations.json` → `citations.json`, and the CLI `citations` command group switches to flag-style args (`--claim-id`, `--supporting-claim-id`) and uses `remove` rather than `unlink`. End state: all `PropositCore` library fields are single-word nouns (`claims`, `citations`, `axioms`, `forks`, `arguments`) and all top-level CLI command groups use consistent flag + verb style.
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
- **Pre-pass placement:** the assignment-rewrite for forced-true axioms lives in `ArgumentEngine.evaluate` and `ArgumentEngine.checkValidity`, ahead of delegation to the standalone evaluator. `TArgumentEvaluationContext` stays a pure structural interface (no claim-library bridge added). Rationale: the engine is already the bridge between external libraries and the evaluator; the existing context interface's methods (`getVariable`, `getPremise`, etc.) are all structural projections of the argument itself.
- **Symmetry rename:** `PropositCore.claimCitations` → `PropositCore.citations`. The five library fields on `PropositCore` become a consistent single-word-noun set. Snapshot slot and on-disk filename renamed in step. Citations CLI command group switches to flag args + `remove` verb to match `claims` and `axioms`.
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

**Checksum config** (`src/lib/consts.ts`) — three coordinated updates:

1. `DEFAULT_CHECKSUM_CONFIG.claimCitationFields` value updates: `"citingClaimId"` → `"claimId"`, `"citingClaimVersion"` → `"claimVersion"`, `"sourceClaimId"` → `"supportingClaimId"`, `"sourceClaimVersion"` → `"supportingClaimVersion"`.
2. New sibling `DEFAULT_CHECKSUM_CONFIG.claimAxiomFields` with the same default field list as the renamed citation set.
3. The three key registries — `normalizeChecksumConfig`, `serializeChecksumConfig`, and `createChecksumConfig` — each contain a literal `keys` array. Add `"claimAxiomFields"` to all three so the new key survives normalize/serialize/createChecksum round-trips.

Without step 3, `claimAxiomFields` gets silently dropped during config round-trips. Without step 1, the migration's checksum-recompute step at section 5 hashes zero matching fields on renamed-on-disk records.

### 3. PropositCore wiring + forking + snapshot

**`src/lib/core/proposit-core.ts`**

- **Field rename for symmetry:** `claimCitations: ClaimCitationLibrary<TCitation>` → `citations: ClaimCitationLibrary<TCitation>`. New public field `axioms: ClaimAxiomLibrary<TAxiom>`. Final library-field set on `PropositCore`: `claims`, `citations`, `axioms`, `forks`, `arguments` — all single-word nouns.
- Constructor wires `citations` and `axioms` against the same `claimLookup` adapter.
- New generic type parameter `TAxiom extends TCoreClaimAxiom = TCoreClaimAxiom`. **Generic ripple:** this is a 12th generic on `PropositCore`, and ripples into `TPropositCoreSnapshot` (`library.interfaces.ts:300-311`), `PropositCore.fromSnapshot`, and any `Parameters<typeof core.foo>` callsites elsewhere in the codebase. The implementation plan must insert `TAxiom` into every `<TArg, TPremise, TExpr, TVar, TClaim, TCitation, …>` declaration that goes through `PropositCore`. `ArgumentEngine` is **not** widened with an axiom-library reference: its existing `claimCitationLibrary` field is held but never read inside the class (it's vestigial — kept out of scope to remove). Adding a parallel `claimAxiomLibrary` field would just compound the dead-code load.
- **Forking — unified BFS.** Replace the two-pass description with a single BFS that consults both lookups at each frontier pop. Pseudocode for the closure walk:
  ```
  frontier = initial claim IDs from claim-bound variables in source argument
  seen = new Set(frontier)
  while frontier not empty:
      currentId = frontier.pop()
      for connection in this.citations.getConnectionsForClaim(currentId):
          if connection.supportingClaimId not in seen:
              seen.add(connection.supportingClaimId); frontier.push(...)
      for connection in this.axioms.getConnectionsForClaim(currentId):
          if connection.supportingClaimId not in seen:
              seen.add(connection.supportingClaimId); frontier.push(...)
  ```
  This guarantees the transitive closure includes axioms reachable via multi-hop citation paths (and vice versa) — important for cases like "normal claim B is cited by normal claim C, and B is also axiom-backed; forking C must clone B and the backing axiom."
- After closure, the cloning loop:
  - Builds `claimRemap` over all seen claim IDs (both citation- and axiom-typed claims are cloned via `ClaimLibrary.create`, transitively).
  - Clones citation connections whose `claimId` is in `claimRemap` into the new fork's `citations` library, remapping both endpoints. Cloned citation connections pin `claimVersion: 0` / `supportingClaimVersion: 0` (matches existing citation-clone behavior at `proposit-core.ts:466-470`).
  - Clones axiom connections whose `claimId` is in `claimRemap` into the new fork's `axioms` library, also pinning `claimVersion: 0` / `supportingClaimVersion: 0`.
- `diffArguments` unaffected — connections are global, not per-argument.

**`src/lib/core/fork-library.ts`** — no namespace change. Axiomatic claims live in the existing `claims` namespace. No fork records for axiom connections (matches the citation precedent).

**`TPropositCoreSnapshot`** — renames the existing `claimCitations` slot to `citations`, and adds new slot `axioms`. Both hold `TClaimConnectionLibrarySnapshot<TConn>` (i.e., `{ connections: TConn[] }`). The slot rename composes with the per-citation field renames in section 2 to produce the new on-disk shape.

**`PropositCore.snapshot()`** and **`PropositCore.fromSnapshot()`** — symmetric reads/writes for the renamed `citations` slot and the new `axioms` slot. `fromSnapshot` throws `LEGACY_MISSING_AXIOM_SLOT` when `axioms` is absent and `LEGACY_CLAIM_CITATION_SHAPE` when the snapshot still carries the legacy `claimCitations` slot or any citation entity with a `citingClaimId` field. Both checks run on the raw JSON shape before typed coercion (see section 5).

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

**Append-mode deferred.** v0.12 keeps the existing naked-Q precondition (`DERIVATION_ANTECEDENT_NON_EMPTY`). A user who wants to revise the support set (e.g., add an axiom after a citation-only populate) must delete and re-create the derivation premise. An append-mode helper that grows an existing OR antecedent is out of scope for v0.12; if demand emerges, it's a self-contained follow-up.

**Private antecedent-builder** — the construction logic is extracted into a private method `buildAntecedentFromSupportingVariables(supportingVars: TClaimBoundVariable[]): void`. Single caller today, kept private and separate for future reuse.

**`TVariableMaterializer`** — no change.

### 5. Snapshot migration (v0.12)

CLI state is stored across multiple files (not a single state file):

- `{stateDir}/claims.json` — claim library snapshot
- `{stateDir}/claim-citations.json` — pre-v0.12 citation library snapshot (renames to `citations.json` in v0.12)
- `{stateDir}/forks.json` — fork library snapshot
- `{stateDir}/arguments/{argId}/{version}/...` — per-argument tree

Three shape changes need to flow through stored data, plus one file rename:

1. **Citation file rename.** `claim-citations.json` → `citations.json` (parallels the in-memory `claimCitations` → `citations` rename).
2. **Citation wrapper field rename.** Inside the renamed file: `{ claimCitations: TCitation[] }` → `{ connections: TCitation[] }`.
3. **Citation edge field renames.** Each citation entity's `citingClaimId` → `claimId`, `citingClaimVersion` → `claimVersion`, `sourceClaimId` → `supportingClaimId`, `sourceClaimVersion` → `supportingClaimVersion`. Stored `checksum` becomes stale; recomputed from new field names + updated `claimCitationFields` config.
4. **New axiom snapshot file.** `axioms.json` must exist, initialized to `{ connections: [] }`.

`claims.json`, `forks.json`, and per-argument files are unchanged shape-wise (no field renames or new required fields land on those entities).

**Approach: CLI-gated one-shot backfill** (`src/cli/storage/migrate-v0.12.ts`), matching the v0.11 and v0.10 migration pattern.

- **`.proposit-v0.12` marker file** in the CLI state directory. Presence means "this state has already been migrated to v0.12."
- **CLI startup migration step**, gated by marker absence. Each step is **independently idempotent** — it probes its own completion state before acting, so a partial-failure rerun lands on the same end state.
  1. **(idempotent file rename)** If `{stateDir}/citations.json` exists, skip. Else if `{stateDir}/claim-citations.json` exists, read it. Else write `{ connections: [] }` to `{stateDir}/citations.json` and proceed.
  2. **(idempotent shape rewrite)** Detect legacy shape on the read content via structural check: `"claimCitations" in snapshot && !("connections" in snapshot)`. If legacy, rewrite the outer wrapper to `{ connections: [...] }` and walk each citation, renaming the four edge fields. If already new-format, no-op.
  3. **(idempotent checksum recompute)** For every citation entity in the rewritten content, recompute `checksum` from v0.12 `claimCitationFields` using the same `entityChecksum` helper the library uses at runtime. (Recomputing already-correct checksums is a no-op.)
  4. **(idempotent commit)** Write the rewritten content to `{stateDir}/citations.json`. If `{stateDir}/claim-citations.json` still exists, delete it (the rename's commit step). If `citations.json` already exists with the same content, no-op.
  5. **(idempotent axiom file init)** If `{stateDir}/axioms.json` does not exist, create it with `{ connections: [] }`. Otherwise no-op.
  6. **(marker)** Write `.proposit-v0.12` marker with the current timestamp. (Last step — if this fails, all prior steps re-run idempotently on the next invocation.)
- **Wiring.** `migrateV012()` is invoked from `src/cli/engine.ts` ahead of `hydratePropositCore`, in the same place v0.11 and v0.10 migrations run today.
- **Storage updates.** `src/cli/storage/libraries.ts` renames `claimCitationsPath()` → `citationsPath()` (returns `citations.json`), `readClaimCitationLibrary()` → `readCitationLibrary()`, `writeClaimCitationLibrary()` → `writeCitationLibrary()`. Adds parallel `axiomsPath()` (returns `axioms.json`), `readAxiomLibrary()`, `writeAxiomLibrary()`. `hydratePropositCore` reads both `citations.json` and `axioms.json` and threads them into `PropositCore`'s constructor (under the renamed `citations` and `axioms` fields).

**Strict in-memory model.** Library-side detection must happen on the raw JSON shape before TypeScript coerces it to the new typed snapshot.

- `ClaimCitationLibrary.fromSnapshot(snapshot, claimLookup, options)` runs a structural pre-check on `snapshot` before treating it as `TClaimConnectionLibrarySnapshot<TCoreClaimCitation>`: if `snapshot` contains the legacy `claimCitations` field or any element has the legacy `citingClaimId` field, throw `LEGACY_CLAIM_CITATION_SHAPE` with an actionable message ("run the v0.12 CLI migration"). The check uses unknown-typed inspection, not the typed `Value.Check`, so legacy shapes don't silently coerce.
- `PropositCore.fromSnapshot(snapshot, …)` runs the same kind of pre-check: if the `axioms` slot is absent from `snapshot` (or the snapshot still uses the legacy `claimCitations` slot), throw `LEGACY_MISSING_AXIOM_SLOT` or `LEGACY_CLAIM_CITATION_SHAPE` with actionable messages.
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

**Additional callsites surfaced by the rename** — not covered by the headline library/engine changes:

- `src/cli/commands/parse.ts:191-195` and `src/cli/commands/arguments.ts:88-97` both build `ClaimCitationLibrary.fromSnapshot({ claimCitations: [...] }, …)` from a literal wrapper-field name. Under the renamed wrapper (`{ connections: [...] }`) both stop compiling. Update both to use the new wrapper key, and switch the reads from `core.claimCitations` to `core.citations`.
- `src/cli/commands/render.ts:124,130-131` calls `getCitationsForCitingClaim` and reads `sourceClaimId` / `sourceClaimVersion` from each citation. Update to `getConnectionsForClaim` and `supportingClaimId` / `supportingClaimVersion`. Also extend the render's graph walk to also call `core.axioms.getConnectionsForClaim(claimId)` so axiom-backed derivations render their axiom connections — without this, derivations backed by axioms render with no visible support, which would confuse users immediately.
- `src/cli/commands/claims.ts:24,53` — claim-type badge in `claims list` and `claims show` is a one-line ternary that only handles `'citation'`. Convert to a switch on `claim.type` so it handles all three of `'normal'`, `'citation'`, and `'axiomatic'`. Axiomatic claims display `[axiom: <reasonCode>]` per section 7.

**Axiom→non-normal-claim invariant (`AXIOM_CLAIM_NOT_NORMAL_TYPE`) rationale.** Documented user-facing rationale: axiomatic claims invoke a self-evident justification for a primary-reasoning claim (`type === "normal"`). Citation claims represent external content whose truth is established by being cited, not derived — there is no semantic operation "derive this citation claim from an axiom." If a user wants to treat an external source as "true by definition," they model it as a `normal` claim whose body articulates the proposition and whose backing is an `axiomatic` connection (and optionally a `citation` connection pointing at the external source). This keeps the role separation clean: citations represent external content; axioms justify normal claims that may or may not reference external content.

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

**`citations` command group rewritten for consistency** (`src/cli/commands/citations.ts`) — to align with the rest of v0.12, the existing citations CLI switches from positional args + `unlink` to flag args + `remove`:

- `citations list [--json]` — unchanged.
- `citations show <connection_id> [--json]` — unchanged.
- `citations add --claim-id <id> --supporting-claim-id <citationId>` — switched from positional `<citing_claim_id> <source_claim_id>`. Flag names use the renamed schema fields.
- `citations remove <connection_id>` — renamed from `citations unlink <connection_id>`.

Callers of the existing CLI will see breakage; release notes call this out explicitly.

**New `axioms` command group** (`src/cli/commands/axioms.ts`) — mirrors the renamed `citations` command group:

- `axioms list [--json]` — list all axiom connections via `core.axioms.getAll()`.
- `axioms show <connection_id> [--json]` — show a single connection.
- `axioms add --claim-id <id> --axiom-id <axiomId>` — create a connection. Errors propagate from `ClaimAxiomLibrary.add`. (Flag name `--axiom-id` is used in the axiom group for clarity; the citations group uses `--supporting-claim-id` since "axiom" doesn't apply.)
- `axioms remove <connection_id>` — delete a connection.

Registered in the CLI program alongside the renamed citations group.

**YAML import validation** (`src/cli/import.ts`) — `Value.Parse(CoreYamlArgumentSchema, raw)` succeeds for axiomatic claims even without a `reasonCode` (core stays minimal). The CLI importer adds a post-parse step that iterates `input.claims` and rejects any claim where `type === "axiomatic"` and `reasonCode` is absent or not a value in `CliAxiomReasonCode`. Error message lists the valid codes.

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

**Propagator interaction with rejected operators.** The constraint propagator (`propagateOperatorConstraints` at `argument-evaluation.ts:81-380`) operates on variable values, not expression negation. The pre-pass populates axiomatic-bound variables in the assignment map with `true`, so they land in the propagator's `userAssigned` set. When an operator is *rejected* by the caller and propagation would otherwise want to flip an axiomatic variable to `false`, `trySetChild` correctly refuses to overwrite — so the axiom stays `true`, and the rejection's downstream constraint resolution silently halts on that branch. This is the desired behavior (axioms are inviolate), but it means rejecting an operator whose only unknown child is axiom-bound is effectively a no-op at the propagation layer. Document this in `argument-evaluation.ts` JSDoc.

The negation-via-`toggleNegation` pattern (`not(axiomVar)`) is unaffected — that operates on the expression tree at evaluation time, not on variable values, so it produces `false` regardless of the variable's forced `true`.

**Implementation location: `ArgumentEngine.evaluate` and `ArgumentEngine.checkValidity` apply the rewrite before delegating.** `TArgumentEvaluationContext` stays a pure structural interface — no `getClaimType` callback added. Rationale: all existing context methods (`getVariable`, `getPremise`, `getConclusionPremise`, `listPremises`) are structural projections of the argument; introducing an external-library lookup into the context would break that pattern. `ArgumentEngine` is already the bridge between external libraries and the evaluator (it holds the `claimLibrary` reference at `argument-engine.ts:142`), so extending its evaluation orchestration to do the assignment rewrite is on-pattern. The standalone `evaluateArgument` and `checkArgumentValidity` stay claim-type-agnostic.

Pre-pass behavior in `ArgumentEngine.evaluate`:

- Walk the argument's claim-bound variables. For each, look up `this.claimLibrary.get(variable.claimId, variable.claimVersion)`.
- If `claim.type === "axiomatic"` and the caller's assignment map has any entry for this variable, throw `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`.
- Build an effective assignments map: caller's entries unchanged, plus forced `true` for every axiomatic-bound variable that the caller didn't try to assign.
- Pass the effective map to the standalone `evaluateArgument`.

Pre-pass behavior in `ArgumentEngine.checkValidity`:

- Same rejection check for axiomatic assignments.
- Build the `checkedVariableIds` set excluding axiomatic-bound variables (see "carve-out" below).
- For each enumerated assignment, fix axiomatic-bound variables to `true` before calling the standalone evaluator. (The standalone evaluator receives an assignment map that already includes the axiom-forced values.)

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
- **Operator-rejection with axiomatic-only descendant.** Construct an argument where rejecting an operator would, under normal propagation, force an axiomatic-bound variable to `false`. Verify the propagator's `trySetChild` refuses the overwrite and the axiom retains its forced `true` value. Downstream propagation may halt on that branch — verify the conclusion variable lands in whatever state the partial propagation produces (typically `null` for "indeterminate"), not in an inconsistent state.

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
- **Deprecation cycle.** No deprecation window for `populateFromCitations`, `getCitationsForCitingClaim`, `EMPTY_CLAIM_CITATION_LOOKUP`, `CITATION_SOURCE_NOT_CITATION_TYPE`, `PropositCore.claimCitations`, the `citations` CLI's positional args, or `citations unlink`. Direct rename + breakage in v0.12, justified by the existing v0.12 breaking-change cycle and the symmetry-end-state win.
- **CLI breakage on citations.** Citations CLI switches to flag args + `remove` verb. Users with scripts pinned against `citations add <a> <b>` or `citations unlink <id>` will need to update. Release notes call this out prominently.
- **Append-mode for `populateFromSupports` deferred.** v0.12 keeps the naked-Q precondition. A user who wants to revise the support set must delete and re-create the derivation premise. If demand emerges, a follow-up adds an append helper.
- **Operator-rejection with axiomatic descendants is a propagation no-op.** Documented in section 8 — rejecting an operator whose only unknown child is axiom-bound cannot flip the axiom and the rejection's downstream propagation halts on that branch. Intended behavior; flag in JSDoc.

## Out of scope

- Server-side persistence shape changes in `proposit-server` (downstream concern, lands after publishing).
- Mobile-side handling in `proposit-mobile` (downstream concern).
- Additional axiom reason codes beyond the initial three. Easy to add later in CLI.
- A more elaborate axiom-rejection mechanism (e.g., per-derivation axiom blacklist). The negation-in-antecedent pattern suffices for v0.12.
