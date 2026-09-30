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
- gives every premise, expression and variable a new id, and keeps every reference between them intact;
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
