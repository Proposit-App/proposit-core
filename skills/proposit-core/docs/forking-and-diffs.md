# Forking, diffs and premise relationships

## Forking

To fork an argument is to make an independent copy to respond to, criticize or extend.

```typescript
const { engine: fork, remapTable } = core.forkArgument("arg-a", "arg-b")
const [originalPremiseId] = engine.listPremiseIds()
const forkedPremiseId = remapTable.premises.get(originalPremiseId)!
fork.removePremise(forkedPremiseId)

const diff = core.diffArguments("arg-a", "arg-b")
console.log(diff.premises.removed.length) // 1
```

`PropositCore.forkArgument(argumentId, newArgumentId?, options?)`:

- calls `canFork()` on the source engine first; override it in a subclass to restrict forking, for example to published versions;
- gives every premise, expression and variable a new id, and keeps every reference between them intact; a variable bound into another argument keeps its binding unchanged;
- forks a response into a response: the copy keeps the same `respondsTo`, and every expression-bound variable keeps its binding unchanged, so the copy answers the same version of the same argument;
- copies every claim the argument reaches through its variables, following citation and axiom connections, and copies those connections too;
- registers the new engine in `core.arguments` at version 0, with the source's `behavior`;
- writes a fork record for the argument and for every premise, expression, variable and claim into `core.forks`.

It returns `{ engine, remapTable, claimRemap, argumentFork }`:

- `remapTable` maps old ids to new ones. It has `premises`, `expressions` and `variables` maps, plus `argumentId: { from, to }`.
- `claimRemap` maps each old claim id to its copy.

Options accept extra fields for each kind of fork record (`argumentForkExtras`, `premiseForkExtras`, …), a `forkId`, and `generateId`, `checksumConfig`, `positionConfig` and `behavior` overrides.

`forkArgumentEngine(engine, newArgumentId, libraries, options?)` is the low-level version. It copies the engine and nothing else: no claim copies and no fork records.

## Diffs

`core.diffArguments(idA, idB, options?)` compares two arguments held by `core`. When one is a fork of the other, it pairs entities by their fork records rather than by id. The standalone `diffArguments(engineA, engineB, options?)` pairs by id unless you pass matchers.

The result has `argument`, `variables`, `premises` and `roles`:

- Each collection lists `added`, `removed` and `modified` entities.
- Each modified entry carries `before`, `after`, the field-level `changes`, and a `state`:
    - `"modified-own"`: the entity's own fields changed;
    - `"modified-within"`: only something it contains or refers to changed, such as a variable used in a premise.
- Premise entries also carry an `expressions` diff.
- `roles` gives the conclusion before and after.
- `argument` lists field changes to the argument itself. By default the only one is `respondsTo`, compared by value, so moving a response to another version of its target shows up there.
- A variable's default comparison covers its symbol and its binding fields, including an expression-bound variable's `boundExpressionId` and `boundAspect` alongside `boundArgumentId` and `boundArgumentVersion`. A re-pointed link shows up as a modified variable.

These states only work when an entity keeps its id across versions. When you produce a new version of an argument, keep the ids of everything that carries over; give new ids only to what is genuinely new.

`TCoreDiffOptions` accepts comparators (`compareArgument`, `compareVariable`, `comparePremise`, `compareExpression`). The defaults are exported as `defaultCompare…` so yours can wrap them. It also accepts matchers (`premiseMatcher`, `variableMatcher`, `expressionMatcher`) for custom pairing.

## Premise relationships

`analyzePremiseRelationships(engine, focusedPremiseId)` sorts every other premise by how it relates to the focused one:

| Category        | Meaning                                                                     |
| --------------- | --------------------------------------------------------------------------- |
| `supporting`    | Its consequent feeds the focused premise's antecedent                       |
| `contradicting` | It forces values that negate the focused premise's antecedent or consequent |
| `restricting`   | It constrains shared variables without clearly supporting or contradicting  |
| `downstream`    | It takes the focused premise's consequent as input                          |
| `unrelated`     | No shared variable, even indirectly                                         |

Each entry has per-variable detail and a `transitive` flag. `buildPremiseProfile(premise)` returns the raw material: which side (antecedent or consequent) each variable appears on, and whether it appears negated.

## Referring to another argument

- `bindVariableToExternalPremise(...)` makes a variable stand for a premise in a different argument.
- `bindVariableToArgument(variable, conclusionPremiseId)` does the same for another argument's conclusion.

The engine does not evaluate the other argument, so the reader assigns these variables like claims. Override `canBind(argumentId, version)` in a subclass to limit which arguments can be referenced.

A response refers to another argument too, through expression-bound variables; see [building-arguments.md](building-arguments.md#responses-and-links).

## Moving a response to a newer version

Write `X.3` for argument X at version 3. A response is pinned: if Y.1 answers X.3 and X.4 is published, nothing changes in Y.1, which keeps answering X.3. The library does not know which versions exist, so telling Y's author about X.4, and offering to answer it, is the application's job.

If the author accepts:

1. The application copies Y.1 into a new version, Y.2, **keeping the id of every entity that carries over**, as it would for any new version. Rebasing matches expressions across versions by id, so this is required.
2. It calls `classifyBindings(y2, x3, x4)` to show the author what happened to each binding, where `x3` and `x4` are snapshots of the two target versions.
3. It collects the author's decisions and calls `y2.rebaseResponse(x3, x4, decisions)`.

Y.1 is never modified. The same holds one level down: if Z.0 answers Y.1, it keeps answering Y.1 until Z's author chooses to make a Z.1 that answers Y.2.

### classifyBindings

`classifyBindings(response, targetFrom, targetTo, options?)` returns `{ bindings }`. It throws unless both snapshots are versions of one argument and the response answers one of them.

The unit is the expression-bound **variable**, not the link premise, because one variable can serve several premises. Each entry in `bindings` gives `variableId`, `boundExpressionId`, `boundAspect`, `boundArgumentVersion`, the `premises` that dropping the variable would remove (each with `isLink`, and `cascaded` when it is reached only through a removed premise's own bound variable), and a `status`:

| `status`         | Meaning                                                                                                                                                                                       | Needs a decision |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `unchanged`      | The expression id is in `targetTo` with the same structure and the same position class.                                                                                                       | No               |
| `changed`        | The id is there but something differs. `reasons` lists `content` (the structure, or something it references in another argument, differs), `position`, or `outsideReferenceRepinned` (below). | Yes              |
| `removed`        | The id is absent from `targetTo`.                                                                                                                                                             | Yes              |
| `alreadyRebased` | The variable is already bound to `targetTo` and its expression is there. This is how a partly saved rebase gets finished.                                                                     | No               |

- **Structure** is compared with `structuralFingerprint(snapshot, expressionId)`: a hash of the subtree's operators, child order and variables that ignores the argument's own ids and versions. A claim-bound variable counts by claim id **and claim version**, so freezing a new version of a claim under a bound expression makes the binding `changed`.
- **Position class** (`positionClassOf(snapshot, expressionId)`) is one of `freeformRoot`, `conclusionRoot`, `nested` (below a premise root) or `inDerivation`. Formula nodes above an expression are looked through, so an operator just inside a premise's root formula is that premise's root.
- **References into a third argument.** A bound expression can itself reference another argument, for example when Z answers Y and binds one of Y's links into X. If Y.2 moved from X.3 to X.4, pass snapshots of X.3 and X.4 in `options.outsideSnapshots`. The referenced element is then compared across the two, and an unchanged one counts as no change. Without them the binding is `changed` with reason `outsideReferenceRepinned`, because the library cannot fetch X to tell whether the change matters.
- **Claim-bound variables are not classified.** A response may use any claim, the target's included, and a claim means the same proposition in every version, so a target version that starts or stops using one needs no decision.
- **Either direction.** Nothing compares the two version numbers, so `targetTo` may be the older one, for example to show the author of a response pinned to X.4 what differs on X.3. Every label then reads from `targetFrom` to `targetTo`: `removed` means "absent from `targetTo`", which in that direction means the expression was added in the newer version.

### rebaseResponse

`rebaseResponse(targetFrom, targetTo, decisions, options?)` is a mutation on the response's engine and returns `{ result, changes }`, where `result` is the classification it acted on. It works out the classification again itself, consults `canBind` for `targetTo`, sets `respondsTo` to `targetTo`, and re-points every `unchanged` binding. `decisions` is a `TRebaseDecisions`, keyed by variable id:

- `bindings`, for each `changed` or `removed` binding:
    - `{ action: "keep" }` re-points it to the same expression, accepting the new content (not allowed for `removed`);
    - `{ action: "retarget", expressionId }` binds it, in the same aspect, to another expression of `targetTo`;
    - `{ action: "drop" }` removes the variable and every premise listed for it, link or not.

Claim-bound variables are left alone.

A reader's answers on a link are keyed by the link's premise id, which a rebase keeps. After a `keep` or `retarget` the same answer speaks about the new content, and after a `drop` it names no link (an `agree` on it is reported `notALink` when carried). Keep a reader's answers per version of the response, or invalidate those on links whose binding was `changed`, `removed` or retargeted.

It throws, and changes nothing, when a decision is missing or names a binding that needs none, when `keep` is given for a `removed` binding, when `retarget` names an expression absent from `targetTo`, when a `keep` or `retarget` would bind an expression another variable already binds in the same aspect, or when `canBind` refuses. Before returning it checks that every expression-bound variable is bound to `targetTo` and names an expression present there, and that `validateLinks` reports nothing new; if not, it throws and undoes the whole rebase. The `changes` hold the argument with its new `respondsTo` and every variable re-pointed, added or removed; `diffArguments` between the before and after states reports the same.

### Example

Continuing the example in [building-arguments.md](building-arguments.md#example): Y.1 answers X.3. In X.4 the step `P → Q` became `P → S`, keeping its expression id `x-step`; the conclusion `x-q` is unchanged. `y2` is the application's copy of Y.1 as version 2, loaded with `ArgumentEngine.fromSnapshot`.

```typescript
import { classifyBindings } from "@proposit/proposit-core"
import type { TRebaseDecisions } from "@proposit/proposit-core"

const x3 = x3Engine.snapshot()
const x4 = x4Engine.snapshot()

const { bindings } = classifyBindings(y2, x3, x4)
for (const entry of bindings) {
    console.log(entry.variableId, entry.status)
}
// y-conclusion unchanged
// y-step changed   (reasons: ["content"])

// Here every decision is made in code; an application would ask the author.
const decisions: TRebaseDecisions = { bindings: {} }
for (const entry of bindings) {
    if (entry.status === "changed") {
        decisions.bindings![entry.variableId] = { action: "keep" }
    } else if (entry.status === "removed") {
        decisions.bindings![entry.variableId] = { action: "drop" }
    }
}

const { changes } = y2.rebaseResponse(x3, x4, decisions)
console.log(y2.getRespondsTo()) // { argumentId: "arg-x", argumentVersion: 4 }
console.log(changes.variables?.modified.map((v) => v.id)) // ["y-conclusion", "y-step"]
```

The application then saves `changes` as Y.2's new state, and Y.2 answers X.4.
