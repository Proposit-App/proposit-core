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
- `bindVariableToExpression(...)` adds an expression-bound variable. Only a response may hold one; see [Responses and links](#responses-and-links).
- `updateVariable(id, changes)` can change the symbol or the binding, but it cannot switch a variable between claim-bound, premise-bound and expression-bound, and it refuses every binding field of an expression-bound variable. `removeVariable(id)` also deletes every expression that uses the variable.
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
- A response has no conclusion. In a response, `listSupportingPremises()` returns every premise that is not a link.

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

## Responses and links

A **response** is an argument that answers one other argument, the **target**, at one pinned version. It is an ordinary `ArgumentEngine` created with one extra field:

```typescript
const y = core.arguments.create({
    id: "arg-y",
    version: 1,
    respondsTo: { argumentId: "arg-x", argumentVersion: 3 },
})
console.log(y.isResponse()) // true
console.log(y.getRespondsTo()) // { argumentId: "arg-x", argumentVersion: 3 }
```

What is different about a response:

- **It has no conclusion.** Creating or removing a premise never makes one the conclusion, and `setConclusionPremise` throws. A response stored with a conclusion still loads, and rule E-8 reports it.
- **`respondsTo` belongs to the engine.** It is set when the engine is built and changed only by `rebaseResponse` (see [forking-and-diffs.md](forking-and-diffs.md#moving-a-response-to-a-newer-version)). `getExtras()` leaves it out, `setExtras` keeps it, and passing it to `setExtras` throws. A response cannot name itself.
- **`evaluate` and `checkValidity` refuse it** with `ARGUMENT_IS_RESPONSE`. A response is checked with `checkLink` and `checkResponseCoherent` instead (see [evaluation.md](evaluation.md#checking-a-response)).

### Expression-bound variables

`bindVariableToExpression(variable)` adds a variable that stands for one expression of the target. Its `boundAspect` says what it stands for:

- `"statement"`: whether the expression is true;
- `"inference"`: whether the step the expression makes holds. The expression must be an operator; any operator counts, including one inside a derivation premise.

The method throws when the argument is not a response, when `boundArgumentId` and `boundArgumentVersion` are not the ones in `respondsTo`, or when `canBind(argumentId, version)` refuses. If a variable with the same expression and aspect already exists, it returns that one instead of adding a second. Only a response may hold an expression-bound variable, and `updateVariable` refuses to change any of its binding fields.

### Links and the four moves

A premise is a **link** when its whole content is one expression-bound variable `x`, or `NOT(x)`. Nothing else is stored: the move is read from the aspect and from whether `NOT` is there.

| Content  | Aspect      | Move         | Says                             |
| -------- | ----------- | ------------ | -------------------------------- |
| `NOT(x)` | `statement` | `contradict` | The target's expression is false |
| `x`      | `statement` | `affirm`     | The target's expression is true  |
| `NOT(s)` | `inference` | `undercut`   | The target's step does not hold  |
| `s`      | `inference` | `reinforce`  | The target's step holds          |

Every other premise of a response is ordinary content: the reasons it gives. Those may use the link variables (for example `R → NOT(s)`), claim-bound variables and derivation premises. A claim-bound variable may use any claim in the library, including one the target uses: a claim is one proposition wherever it appears, so a response may reason from the target's own P (`P → NOT(r)`) and copy the target's derivation premise for P with the same cited sources. The checks give a shared claim one column. Using P is giving a reason; only a link answers the target.

- `listLinks(response)` returns each link as `{ premiseId, variableId, boundExpressionId, boundAspect, move }`.
- `validateLinks(response, targetSnapshot)` checks the bindings against a snapshot of the target. It throws unless the snapshot is the argument and version in `respondsTo`, and returns `{ ok, violations }` with these codes:
    - `LINK_EXPRESSION_MISSING`: the bound expression is not in the snapshot;
    - `LINK_INFERENCE_ON_NON_OPERATOR`: an inference binding on something that is not an operator;
    - `LINK_VERSION_MISMATCH`: a binding names another version of the target (rule E-10);
    - `LINK_SAME_CLAIM`, with severity `"info"`, which never makes `ok` false: two links bind different occurrences of one claim in the same aspect. The checks treat the two as one thing, and so must any code that counts a response's links by claim.
- `elementsWithinPremise(targetSnapshot, premiseId)` lists every expression id and claim id in one premise of the target.
- `linkTargetsElement(reference, response, targetSnapshot, element)` says whether a link, named from outside the response by a `TLinkReference` (`{ argumentId, argumentVersion, premiseId }`), is about a claim of the target (`{ kind: "claim", claimId }`, at any version of the claim) or an expression (`{ kind: "expression", expressionId }`: that expression, or the root of the premise that holds it, read through formula nodes).

The library never fetches the target. Every function that needs it takes a snapshot the caller supplies, usually `targetEngine.snapshot()`.

Rules D-4 and D-5, which keep citation- and axiom-bound variables inside a derivation premise's antecedent, do not apply to expression-bound variables. So a response may contradict or undercut anything in its target, including what rests on a source or an axiom. Links reach only the immediate target, though, so a response cannot deny a source cited two arguments back.

### Example

X, at version 3, argues "P → Q; P; therefore Q". Y answers it: it contradicts X's conclusion, undercuts X's step, and gives a reason for the undercut.

```typescript
import { PropositCore, listLinks, validateLinks } from "@proposit/proposit-core"
import type { PremiseEngine } from "@proposit/proposit-core"

const core = new PropositCore()
const p = core.claims.create({ type: "normal" })
const q = core.claims.create({ type: "normal" })
const r = core.claims.create({ type: "normal" })

// A small helper: append one expression to a premise.
function add(
    premise: PremiseEngine,
    parentId: string | null,
    id: string,
    node:
        | { type: "variable"; variableId: string }
        | { type: "operator"; operator: "not" | "implies" }
) {
    const { argumentId, argumentVersion } = premise.toPremiseData()
    premise.appendExpression(parentId, {
        id,
        argumentId,
        argumentVersion,
        premiseId: premise.getId(),
        parentId,
        ...node,
    })
}

// The target: X at version 3.
const x = core.arguments.create({ id: "arg-x", version: 3 })
x.setBehavior("permissive")
const xp = x.ensureClaimBoundVariable(p.id).id
const xq = x.ensureClaimBoundVariable(q.id).id
const { result: conclusion } = x.createPremise()
add(conclusion, null, "x-q", { type: "variable", variableId: xq })
const { result: step } = x.createPremise()
add(step, null, "x-step", { type: "operator", operator: "implies" })
add(step, "x-step", "x-p1", { type: "variable", variableId: xp })
add(step, "x-step", "x-q1", { type: "variable", variableId: xq })
const { result: fact } = x.createPremise()
add(fact, null, "x-p2", { type: "variable", variableId: xp })
x.setBehavior("assistive")
x.normalize()

// The response: Y at version 1, answering X at version 3.
const y = core.arguments.create({
    id: "arg-y",
    version: 1,
    respondsTo: { argumentId: "arg-x", argumentVersion: 3 },
})
y.setBehavior("permissive")
const binding = {
    argumentId: "arg-y",
    argumentVersion: 1,
    boundArgumentId: "arg-x",
    boundArgumentVersion: 3,
}
// The truth of X's conclusion, and whether X's step "P → Q" holds.
y.bindVariableToExpression({
    ...binding,
    id: "y-conclusion",
    symbol: "Xq",
    boundExpressionId: "x-q",
    boundAspect: "statement",
})
y.bindVariableToExpression({
    ...binding,
    id: "y-step",
    symbol: "Xstep",
    boundExpressionId: "x-step",
    boundAspect: "inference",
})
const yr = y.ensureClaimBoundVariable(r.id).id

// Contradict: NOT(Xq), "X's conclusion is false".
const { result: contradict } = y.createPremiseWithId("y-contradict")
add(contradict, null, "y-not-q", { type: "operator", operator: "not" })
add(contradict, "y-not-q", "y-q", {
    type: "variable",
    variableId: "y-conclusion",
})

// Undercut: NOT(Xstep), "P does not lead to Q".
const { result: undercut } = y.createPremiseWithId("y-undercut")
add(undercut, null, "y-not-step", { type: "operator", operator: "not" })
add(undercut, "y-not-step", "y-step-1", {
    type: "variable",
    variableId: "y-step",
})

// The reason for the undercut: R, and R → NOT(Xstep).
const { result: reason } = y.createPremiseWithId("y-reason")
add(reason, null, "y-r", { type: "variable", variableId: yr })
const { result: rule } = y.createPremiseWithId("y-rule")
add(rule, null, "y-implies", { type: "operator", operator: "implies" })
add(rule, "y-implies", "y-r1", { type: "variable", variableId: yr })
add(rule, "y-implies", "y-not-step-2", { type: "operator", operator: "not" })
add(rule, "y-not-step-2", "y-step-2", {
    type: "variable",
    variableId: "y-step",
})

y.setBehavior("assistive")
y.normalize()

console.log(y.getConclusionPremise()) // undefined: a response has none
console.log(listLinks(y).map((link) => link.move)) // ["contradict", "undercut"]
console.log(y.validate("presentable").length) // 0
console.log(validateLinks(y, x.snapshot()).ok) // true
```

[evaluation.md](evaluation.md#checking-a-response) continues this example with the checks, and [forking-and-diffs.md](forking-and-diffs.md#moving-a-response-to-a-newer-version) with moving Y to a newer version of X.

### Carrying a reader's answers

A reader who agrees with a response's links has asserted what they say about the argument answered. `y.carryAnswers(targetSnapshot, linkAnswers, targetClaims)` turns that into input for X; `mergeCarriedInput(own, carried)` adds it to the reader's own input. Continuing the example, with `mergeCarriedInput` added to the import:

```typescript
// The reader agrees with both of Y's links.
const carried = y.carryAnswers(
    x.snapshot(),
    { "y-contradict": "agree", "y-undercut": "agree" },
    core.claims
)
if (carried.status === "carried" && !carried.intoResponse) {
    console.log(carried.variables) // { [xq]: false }
    console.log(carried.operatorAssignments) // { "x-step": "rejected" }

    // The reader also holds P true. Carried values sit between the defaults
    // and the reader's own input.
    const merged = mergeCarriedInput({ variables: { [xp]: true } }, carried)
    const result = x.evaluateWithDefaults(
        merged.variables,
        undefined,
        merged.operatorAssignments
    )
    console.log(result.conclusionTrue) // false
    console.log(result.struckPremiseIds) // [step.getId()]: the undercut struck it
}
```

- **Only `agree` answers carry**, and only links, never the response's other premises.
- **A statement link carries fixed claim values** when what it says is exactly that: affirming `Q ∧ R` carries Q and R true, contradicting `P → Q` carries P true and Q false. Contradicting `Q ∧ R` says less than any fixed values would, so it carries nothing and is reported `notExpressible`. The expression is read with every claim free, even one the response itself cites.
- **A reinforce carries `accepted` only at a premise root that is `implies` or `iff`.** At any other root, or below a root, accepting the operator would assert a statement, not a step. An undercut carries `rejected` wherever evaluation honours a rejection.
- **Every `agree` is accounted for**: each carried value lists its links in `sources`, and each link that carried nothing is in `notCarried` with its reason. Agreed links that fix something both ways all carry nothing (`conflict`).
- **Into another response** (Z answers Y), the result is answers on Y's links (`intoResponse: true`, `linkAnswers`). Merge them with the reader's own answers on Y, then carry Y into X.
- **The reader's own value wins** every collision in `mergeCarriedInput`, and each collision is listed. Carried values enter `variables`, so attribution counts them as the reader's assertions.

The full rules are under "Carrying a reader's answers" in the API reference.
