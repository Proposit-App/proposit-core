# Building arguments

## PropositCore and its libraries

`new PropositCore(options?)` creates every library and connects them:

| Field            | Class                  | Holds                                                                     |
| ---------------- | ---------------------- | ------------------------------------------------------------------------- |
| `core.claims`    | `ClaimLibrary`         | Versioned claims, shared by every argument                                |
| `core.citations` | `ClaimCitationLibrary` | "Claim X is supported by citation claim Y" connections                    |
| `core.axioms`    | `ClaimAxiomLibrary`    | "Normal claim X is supported by axiomatic claim Y" connections            |
| `core.origins`   | `OriginLibrary`        | Source texts, their links to argument versions, and anchored spans        |
| `core.forks`     | `ForkLibrary`          | Records of which entity was copied from which when an argument was forked |
| `core.arguments` | `ArgumentLibrary`      | One `ArgumentEngine` per argument id                                      |

Options include `checksumConfig`, `positionConfig`, `behavior` (`"assistive"` or `"permissive"`), `generateId` (the id generator used for anything you do not give an id), and ready-made library instances to use instead of new ones. `PropositCore` and `ArgumentEngine` can be subclassed to add rules of your own, for example overriding `canFork()` to allow forking only published versions. An `ArgumentEngine` can also be built directly with `new ArgumentEngine(argument, claimLookup, options?)`, but then you wire the libraries yourself.

## A complete example

This builds "R → W; R; therefore W". It also shows how an application adds its own fields, such as claim text.

```typescript
import { PropositCore } from "@proposit/proposit-core"
import type {
    PremiseEngine,
    TCoreArgument,
    TCoreClaim,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
} from "@proposit/proposit-core"

// Core entities carry no display text. Add your own fields through the
// type parameters, in this order: argument, premise, expression,
// variable, claim (further parameters cover connections, fork records
// and source texts).
type TMyArgument = TCoreArgument & { title: string }
type TMyClaim = TCoreClaim & { text: string }
const core = new PropositCore<
    TMyArgument,
    TCorePremise,
    TCorePropositionalExpression,
    TCorePropositionalVariable,
    TMyClaim
>()

const rain = core.claims.create({ type: "normal", text: "It rains" })
const wet = core.claims.create({ type: "normal", text: "The street is wet" })

const engine = core.arguments.create({
    id: "arg-1",
    version: 0,
    title: "Rain makes the street wet",
})

engine.addVariable({
    id: "v-rain",
    argumentId: "arg-1",
    argumentVersion: 0,
    symbol: "R",
    claimId: rain.id,
    claimVersion: rain.version,
})
engine.addVariable({
    id: "v-wet",
    argumentId: "arg-1",
    argumentVersion: 0,
    symbol: "W",
    claimId: wet.id,
    claimVersion: wet.version,
})

// A small helper: every expression repeats the argument and premise ids.
function addVariableNode(
    premise: PremiseEngine,
    id: string,
    variableId: string,
    parentId: string | null
) {
    premise.appendExpression(parentId, {
        id,
        argumentId: "arg-1",
        argumentVersion: 0,
        premiseId: premise.getId(),
        type: "variable",
        variableId,
        parentId,
    })
}

// An operator starts with no children, and "assistive" behavior would
// delete it at once. Build in "permissive" behavior, tidy at the end.
engine.setBehavior("permissive")

// The first premise created becomes the conclusion: W
const { result: conclusion } = engine.createPremise()
addVariableNode(conclusion, "e-w1", "v-wet", null)

// Supporting premise: R → W
const { result: rule } = engine.createPremise()
rule.appendExpression(null, {
    id: "e-implies",
    argumentId: "arg-1",
    argumentVersion: 0,
    premiseId: rule.getId(),
    type: "operator",
    operator: "implies",
    parentId: null,
})
addVariableNode(rule, "e-r1", "v-rain", "e-implies") // antecedent
addVariableNode(rule, "e-w2", "v-wet", "e-implies") // consequent

// Constraint premise: R
const { result: fact } = engine.createPremise()
addVariableNode(fact, "e-r2", "v-rain", null)

engine.setBehavior("assistive")
engine.normalize()

console.log(rule.toDisplayString()) // (R → W)
console.log(engine.getConclusionPremise()?.getId() === conclusion.getId()) // true
console.log(engine.checkValidity().isValid) // true
```

Without the type parameters, `core.claims.create({ type: "normal" })` and `core.arguments.create({ id, version })` accept only the core fields, and TypeScript rejects extra keys such as `text` or `title`.

## Claims

- `claims.create({ type, ...yourFields })` creates version 0. The `id` is optional and generated when omitted. `type` can never change; trying throws `CLAIM_TYPE_IMMUTABLE`.
- `claims.update(id, fields)` edits the latest version. It throws if that version is frozen.
- `claims.freeze(id)` locks the current version and starts the next one. It returns `{ frozen, current }`.
- `claims.get(id, version)`, `getCurrent(id)`, `getVersions(id)` and `getAll()` read claims.

Variables pin a claim at one version (`claimId` + `claimVersion`), and so do connections.

## Citations and axioms

Both connection libraries have the same methods: `add`, `remove`, `get`, `getAll`, `filter`, `getConnectionsForClaim(claimId)`, `snapshot` and `validate`. A connection is created or removed, never edited.

- `citations.add({ id, claimId, claimVersion, supportingClaimId, supportingClaimVersion })`. The supporting claim must have type `citation`. A connection that would make the citation graph circular is rejected with `CITATION_CYCLE_DETECTED`.
- `axioms.add(...)` takes the same shape. The supported claim must be `normal` and the supporting claim must be `axiomatic`.

## Variables

- `addVariable({ id, argumentId, argumentVersion, symbol, claimId, claimVersion })` adds a claim-bound variable. Ids and symbols must be unique within the argument, and the claim version must exist.
- `bindVariableToPremise({ ..., boundPremiseId, boundArgumentId, boundArgumentVersion })` adds a premise-bound variable whose value is the bound premise's value. A binding that would make premises depend on each other in a circle throws.
- `bindVariableToExternalPremise(...)` points at a premise in another argument. `bindVariableToArgument(variable, conclusionPremiseId)` does the same for another argument's conclusion. The engine never evaluates the other argument, so the reader supplies these values like claim values.
- `ensureClaimBoundVariable(claimId)` returns a variable for the claim, creating one if none exists.
- `updateVariable(id, changes)` can change the symbol or the binding, but it cannot switch a variable between claim-bound and premise-bound. `removeVariable(id)` also deletes every expression that uses the variable.
- Lookups: `getVariables()`, `getVariable(id)`, `getVariableBySymbol(symbol)`, `getVariableIdsForClaim(claimId)` (all of them) and `getClaimIdForVariable(id)`.

`createPremise` also adds a premise-bound variable for the new premise, with a symbol such as `P0`, so other premises can refer to it. Pass `{ symbol }` to choose the symbol.

```typescript
// A variable that stands for another premise's truth value.
engine.bindVariableToPremise({
    id: "v-rule",
    argumentId: "arg-1",
    argumentVersion: 0,
    symbol: "Rule",
    boundPremiseId: rule.getId(),
    boundArgumentId: "arg-1",
    boundArgumentVersion: 0,
})
```

## Premises

- `createPremise(options?)` and `createPremiseWithId(id, options?)` take `{ type?: "freeform" | "derivation", derivedClaimId?, extras?, symbol? }`. They return `{ result: PremiseEngine, changes }`.
- `removePremise(id)` also removes the variables bound to that premise and the expressions using them. If the removed premise was the conclusion, no conclusion is set afterwards.
- `getPremise(id)`, `listPremises()`, `listPremiseIds()`.
- On a `PremiseEngine`:
    - `getPremiseType()` returns `"freeform"` or `"derivation"`;
    - `isInference()` is true when the root is `implies` or `iff`;
    - `isConstraint()` is the opposite;
    - `toDisplayString()` renders the tree, for example `(R → W)`;
    - `setExtras` and `updateExtras` store your own fields on the premise.

### Roles

- `setConclusionPremise(id)` and `clearConclusionPremise()` set the conclusion. `getConclusionPremise()` returns it.
- Supporting premises are never assigned by hand. `listSupportingPremises()` returns every non-conclusion premise whose root is `implies` or `iff`.
- That list includes derivation premises, because they are shaped `A → Q` too. To find only what the author wrote, filter on `getPremiseType() !== "derivation"`.

## Expressions

Each expression has `id`, `argumentId`, `argumentVersion`, `premiseId`, `parentId` (`null` for the root), `position` (its order among siblings) and `type`:

- `{ type: "variable", variableId }`
- `{ type: "operator", operator: "not" | "and" | "or" | "xor" | "implies" | "iff" }`
- `{ type: "formula" }` — acts as parentheses around exactly one child.

Ways to add an expression, on `PremiseEngine`:

| Method                                                                | Use                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `appendExpression(parentId, expr)`                                    | Add as the last child of `parentId` (`null` for the root). You leave out `position`.      |
| `addExpressionRelative(siblingId, "before" \| "after", expr)`         | Add next to an existing sibling. You leave out `position`.                                |
| `addExpression(expr)`                                                 | Low-level: you supply `position` yourself.                                                |
| `insertExpression(expr, leftNodeId?, rightNodeId?)`                   | Put a new operator where an existing node is, and make the existing node(s) its children. |
| `wrapExpression(operatorExpr, newSibling, leftNodeId?, rightNodeId?)` | Wrap one existing node in a new operator together with a new sibling, in one step.        |

Other edits:

- `removeExpression(id, deleteSubtree)` removes a node. With `true` it also removes everything under it; with `false` it moves the node's single child into its place. In assistive behavior the tidying then replaces an operator left with one child by that child and removes one left with none; in permissive behavior they stay and `validate("evaluable")` reports them.
- `toggleNegation(id)` wraps a node in `not`, or removes the `not`.
- `changeOperator(id, newOperator)` changes an operator in place. With two child ids, it moves those two children of a larger `and`, `or` or `xor` into a new operator of their own.
- `updateExpression(id, changes)` edits fields.
- `ArgumentEngine.patchExpressionAppFields(id, fields)` sets your own fields on an expression.

Positions are numbers, and a new node takes the midpoint between its neighbours. You rarely need to compute them: the `append…` and `…Relative` methods do it for you.

**Structural rules the engine enforces by throwing:**

- `implies` and `iff` only at the root;
- `not` and `formula` have exactly one child;
- `implies` and `iff` have at most two children;
- one root per premise;
- a variable node has no children;
- ids, sibling positions and variable symbols are unique;
- references resolve;
- the argument id and version match the engine.

Everything else is reported by `validate(tier)` (see [grammar.md](grammar.md)).

## Derivation premises

A derivation premise states how one claim, `Q`, is supported. Create it with `createPremise({ type: "derivation", derivedClaimId })`. It starts as a lone variable for `Q`, called "naked-Q", which means "no support given yet". Evaluation skips a naked-Q premise.

Fill it from the connection libraries:

- `populateFromCitations(derivedClaimId, core.citations)` builds `S → Q` for one citation, or `(S1 ∨ … ∨ Sn) → Q` for several.
- `populateFromAxioms(derivedClaimId, core.axioms)` does the same from axiom connections.

Both return `{ kind: "populated" | "no-op", state }`. They take the **claim id**, not the premise id. They do nothing when the premise is already filled. A derivation premise must not mix citations and axioms (rule D-3), and it must not be the conclusion (rule D-6). Because the first premise created becomes the conclusion, create a freeform conclusion first or call `setConclusionPremise` afterwards.

```typescript
import { PropositCore } from "@proposit/proposit-core"

const core = new PropositCore()

const rains = core.claims.create({ type: "normal" })
const report = core.claims.create({ type: "citation" })
// "rains" is supported by the "report" citation.
core.citations.add({
    id: "cite-1",
    claimId: rains.id,
    claimVersion: rains.version,
    supportingClaimId: report.id,
    supportingClaimVersion: report.version,
})

const engine = core.arguments.create({ id: "arg-2", version: 0 })

// A derivation premise starts as a lone variable for the derived claim.
const { result: derivation } = engine.createPremise({
    type: "derivation",
    derivedClaimId: rains.id,
})
// Fill it in from the citation library. Note: the first parameter is the
// derived claim's id, not the premise id.
const populated = engine.populateFromCitations(rains.id, core.citations)

console.log(populated.kind) // "populated"
console.log(derivation.toDisplayString()) // (P2 → P1), symbols auto-generated
console.log(derivation.getPremiseType()) // "derivation"
```

To express "this claim should not be supported by this axiom", negate the axiom's variable in the antecedent with `toggleNegation`. Do not assign it `false`.
