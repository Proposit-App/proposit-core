# Persistence: snapshots, checksums and changesets

The library keeps everything in memory and never stores anything itself. It gives an application three ways to save and reload:

- **Snapshots** — the whole state as plain data. Write it out and load it back.
- **Flat rows** — `ArgumentEngine.fromData` loads the arrays a database query returns.
- **Changesets** — each mutation says exactly which rows it added, changed and removed, so a store can apply only the difference.

## Snapshots

```typescript
import { ArgumentEngine, PropositCore } from "@proposit/proposit-core"
import type { TPropositCoreSnapshot } from "@proposit/proposit-core"

const saved = engine.snapshot()
const restored = ArgumentEngine.fromSnapshot(saved, core.claims)
console.log(restored.toDisplayString())

const everything = core.snapshot()
const json = JSON.stringify(everything)
const reloaded = PropositCore.fromSnapshot(
    JSON.parse(json) as TPropositCoreSnapshot
)
console.log(reloaded.arguments.get("arg-1")?.listPremiseIds())
```

- `ArgumentEngine.fromSnapshot(snapshot, claimLookup, checksumVerification?, generateId?)` rebuilds one argument. Pass `"strict"` to verify the stored checksums, or `"ignore"` to skip that.
- `engine.rollback(snapshot)` restores in place, so existing references to the engine stay valid.
- `PropositCore.snapshot()` holds every library: `claims`, `citations`, `axioms`, `origins`, `forks` and `arguments`. Snapshots survive a JSON round trip.
- Each library also has its own `snapshot()` and `fromSnapshot()`.
- Loading accepts any Structural state. Check the other tiers afterwards with `validate(tier)` (see [grammar.md](grammar.md)).
- Very old data raises codes such as `LEGACY_CLAIM_MISSING_TYPE`, `LEGACY_PREMISE_MISSING_TYPE`, `LEGACY_CLAIM_CITATION_SHAPE` and `LEGACY_MISSING_AXIOM_SLOT`. These mean the data predates a format change and must be migrated first. A snapshot with no `origins` slot loads with an empty origin library.

`ArgumentEngine.fromData(argument, claimLookup, variables, premises, expressions, roles, config?, checksumVerification?)` loads from flat arrays. It groups expressions by `premiseId` and adds parents before children.

## Changesets

Every mutation returns `{ result, changes }`. `changes` is a `TCoreChangeset`:

```text
{
    expressions?: { added: TExpr[]; modified: TExpr[]; removed: TExpr[] }
    variables?:   { added: TVar[];  modified: TVar[];  removed: TVar[] }
    premises?:    { added: TPremise[]; modified: TPremise[]; removed: TPremise[] }
    roles?: { conclusionPremiseId?: string }   // present only when roles changed
    argument?: TArg                            // present only when the argument changed
}
```

A changeset includes cascades. For example, removing a variable also lists every expression that used it. In assistive behavior it also includes whatever the automatic tidying changed.

To save several mutations in one transaction:

```typescript
import { composeChangesets, orderChangeset } from "@proposit/proposit-core"
import type { TCoreChangeset } from "@proposit/proposit-core"

const pending: TCoreChangeset[] = []

const created = engine.createPremise()
pending.push(created.changes)
const premise = created.result
const added = premise.appendExpression(null, {
    id: "e-1",
    argumentId: "arg-1",
    argumentVersion: 0,
    premiseId: premise.getId(),
    type: "variable",
    variableId: "arg-1-vp",
    parentId: null,
})
pending.push(added.changes)

// One changeset for the whole edit, in an order a store with foreign
// keys can apply one statement at a time.
const combined = pending.reduce(composeChangesets)
for (const op of orderChangeset(combined)) {
    console.log(op.type, op.entity) // insert premise, insert variable, insert expression, update roles
}
```

- **`composeChangesets(first, then)`** combines two changesets made one after the other. "Added, then removed" disappears, and "removed, then added" becomes "modified".
- **`mergeChangesets`** is for changesets that are independent of each other. It throws when one id appears in two buckets, which a sequence can legitimately produce, so use `composeChangesets` for a sequence.
- **`orderChangeset(changeset)`** returns `{ type: "insert" | "update" | "delete", entity, data }` operations in an order that works with a store that checks foreign keys (references between tables) immediately and deletes nothing automatically. Two requirements come with it:
    - Apply **only the fields an update carries**. To free removed expressions from their parents first, the order includes "detach" updates that carry only `id`, `parentId: null` and `position: 0`.
    - A detach can briefly give a premise several roots. So check a "one root per premise" rule at the end of the transaction, not after each statement.

## Checksums

Checksums let an application detect what changed without comparing whole objects.

- Expressions, premises and the argument each carry three checksums:
    - `checksum` covers the entity's own fields;
    - `descendantChecksum` covers its children (`null` when it has none);
    - `combinedChecksum` covers both.
- Variables and claims carry one `checksum`. The role state is folded into the argument's `checksum`.
- Checksums are computed on demand. `flushChecksums()` brings them up to date, and `getCollectionChecksum("premises" | "variables")` gives one value per collection.
- Which fields count is set by `checksumConfig`. `createChecksumConfig({ expressionFields: new Set(["myField"]) })` adds fields to the defaults (`DEFAULT_CHECKSUM_CONFIG`). Snapshots store the config as arrays, and `normalizeChecksumConfig` / `serializeChecksumConfig` convert between the array and `Set` forms.

**A field counts whenever its key is present, even with value `null`, `false` or `undefined`.** So an unset optional field must be absent, never `null`. Otherwise every checksum changes. This matters most for `enthymeme` and for any field your own storage layer maps from `undefined` to `null`. The library removes a key whose value is `undefined` in `setExtras`, `updateExtras` and `patchExpressionAppFields`, so passing `undefined` there clears a field cleanly.

## Reacting to changes

`ArgumentEngine` works with React's `useSyncExternalStore` without extra code. `subscribe(listener)` returns an unsubscribe function. `getSnapshot()` returns a read-only view whose unchanged parts keep the same object identity between calls, so a component can select one premise or expression and re-render only when it changes.

```typescript
const unsubscribe = engine.subscribe(() => {
    const view = engine.getSnapshot() // { argument, variables, premises, roles }
    console.log(Object.keys(view.premises).length)
})
// later: unsubscribe()
```

## Source texts and unspoken content

`core.origins` records the text an argument was built from:

- **documents** hold the text;
- **links** tie a document to an argument version, with a `stance`: `"seed"` (the argument started from it) or `"representation"` (the argument claims to render it faithfully);
- **anchors** tie a span of the text to an expression, or to the argument as a whole.

```typescript
const doc = core.origins.addDocument({
    id: "doc-1",
    text: "It rained, so the street is wet.",
})
core.origins.addLink({
    id: "link-1",
    argumentId: "arg-o",
    argumentVersion: 0,
    documentId: doc.id,
    stance: "seed",
})
core.origins.addAnchor({
    id: "anchor-1",
    argumentId: "arg-o",
    argumentVersion: 0,
    documentId: doc.id,
    targetType: "expression",
    targetId: "e-p",
    exact: "It rained",
    startCodePoint: 0,
    endCodePoint: 9,
})
// Mark an expression as left unspoken in the original; clear it with
// `undefined`, which removes the key rather than storing false.
engine.patchExpressionAppFields("e-p", { enthymeme: true })
engine.patchExpressionAppFields("e-p", { enthymeme: undefined })
```

- **Offsets count Unicode code points, not JavaScript string units.** Read spans with `sliceByCodePoints(text, start, end)`, never `text.slice`. The two differ for emoji and other characters outside the basic range.
- An anchor whose span does not match its `exact` text is rejected.
- `addDocument` normalizes the text first with `normalizeOriginText`: line endings are unified, invisible control characters are removed, and the text is converted to Unicode composed form and trimmed. It also computes a SHA-256 `digest`. Documents cannot be edited.
- Store documents, then links, then anchors, and delete in the reverse order. Origin entities are not part of changesets.
- An **enthymeme** mark (`enthymeme: true` on a claim-bound variable expression) says the original text left this claim unstated. The field is `true` or absent, never `false` or `null`.
