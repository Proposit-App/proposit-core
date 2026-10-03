# Grammar tiers and validation

The library sorts every rule about an argument's shape into four tiers. Each tier includes all the rules of the tiers above it:

```
Structural  ⊇  Evaluable  ⊇  Derivable  ⊇  Presentable
(loosest)                                   (strictest)
```

| Tier            | Meaning                                                                                                                                                                                                                                                                      | What enforces it                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Structural**  | The data holds together: references resolve, ids and symbols are unique, no cycles, `implies`/`iff` only at the root, `not`/`formula` take one child, `implies`/`iff` take two, sibling positions are unique, a derivation premise's root is a variable, `implies` or `iff`. | Every mutation. An engine never holds a state that breaks a Structural rule. |
| **Evaluable**   | `evaluate` and `checkValidity` can run: `and`/`or`/`xor` have at least two operands, every variable binding resolves, no axiom-bound variable is assigned, a derivation premise contains its derived claim, a claim has at most one derivation premise, a conclusion is set. | `evaluate` and `checkValidity` return `ok: false` instead of a result.       |
| **Derivable**   | Derivation premises have their canonical shape, and citation and axiom claims appear only in a derivation premise's antecedent.                                                                                                                                              | Nothing automatic. Ask with `validate("derivable")`.                         |
| **Presentable** | The tidy form: a `formula` (parentheses) between nested operators, no double negation, no redundant parentheses, no single-child `and`/`or`/`xor`, no same operator nested through parentheses, enthymeme marks only on claim-bound variables.                               | Nothing automatic. Kept automatically in `"assistive"` behavior.             |

**The one rule to remember: mutations throw only for Structural problems.** The engine lets you pass through incomplete states while editing, and reports everything else when you ask. The loading functions `fromSnapshot` and `fromData` accept any Structural state too.

An application typically checks `validate("evaluable")` before saving and `validate("presentable")` before publishing. The library itself enforces neither.

## validate(tier)

```typescript
const issues = engine.validate("presentable")
for (const issue of issues) {
    console.log(issue.tier, issue.code, issue.message) // presentable P-1 …
}
engine.normalize() // inserts the missing formula (parentheses) node
console.log(engine.validate("presentable").length) // 0
```

`validate(tier)` returns a list of `TViolation` objects covering every tier from Structural down to the one requested. Each is `{ tier, code, message, argumentId?, premiseId?, expressionId?, variableId?, claimId? }`.

`validateInvariants()` is a different check. It covers schema conformance, ownership, references and checksums, and returns `{ ok, violations }`. `PropositCore.validate()` runs it across every library.

## Rule codes

Rule codes are stable: store and match on them freely. `E-2` is not used.

| Code          | Rule                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `S-1`         | References resolve (parent, premise, argument id and version)                                                                                       |
| `S-2`         | Expression and operator types are valid                                                                                                             |
| `S-3`         | Every variable has exactly one kind of reference: a claim, a premise, or an expression                                                              |
| `S-4`         | No cycles                                                                                                                                           |
| `S-5`         | `implies` and `iff` only at a premise's root                                                                                                        |
| `S-6`–`S-7`   | Premise type and claim type stay consistent and unchanged                                                                                           |
| `S-8`         | `implies` and `iff` take exactly two children                                                                                                       |
| `S-9`–`S-11`  | Sibling positions, entity ids and variable symbols are unique                                                                                       |
| `S-12`–`S-13` | `not` and `formula` take exactly one child                                                                                                          |
| `S-14`        | A derivation premise's root is a variable, `implies` or `iff`                                                                                       |
| `S-15`        | A response is well formed: it does not answer itself, and only a response holds expression-bound variables, each bound into the argument it answers |
| `E-1`         | `and`, `or`, `xor` have at least two children                                                                                                       |
| `E-3`         | Every variable binding resolves                                                                                                                     |
| `E-4`         | No assignment for an axiom-bound variable                                                                                                           |
| `E-5`         | A derivation premise contains its derived claim's variable                                                                                          |
| `E-6`         | A claim has at most one derivation premise                                                                                                          |
| `E-7`         | A standard argument with premises has a conclusion (a response is exempt)                                                                           |
| `E-8`         | A response has no conclusion                                                                                                                        |
| `E-9`         | In a response, no two variables bind the same expression in the same aspect                                                                         |
| `E-10`        | In a response, every expression binding names the version in `respondsTo`                                                                           |
| `D-1`         | A derivation premise is naked-Q (just the derived claim's variable) or `antecedent → Q`                                                             |
| `D-2`         | A single support is written `S → Q`                                                                                                                 |
| `D-3`         | An antecedent does not mix citations and axioms                                                                                                     |
| `D-4`–`D-5`   | Axiom- and citation-bound variables appear only in a derivation premise's antecedent                                                                |
| `D-6`         | A derivation premise is not the conclusion                                                                                                          |
| `P-1`         | A `formula` sits between an operator and a non-`not` operator child                                                                                 |
| `P-2`         | No `not(not(x))`                                                                                                                                    |
| `P-3`         | A `formula` wraps an operator                                                                                                                       |
| `P-4`         | No single-child `and`, `or`, `xor`                                                                                                                  |
| `P-5`         | No same operator nested through a `formula` (flatten it instead)                                                                                    |
| `P-6`         | Only claim-bound variable expressions carry the enthymeme mark                                                                                      |

The full inventory, with examples, is in the repository's `docs/Proposit_Grammar.md`.

### Rules for response arguments

A response (see [building-arguments.md](building-arguments.md#responses-and-links)) adds a third kind of variable and drops the conclusion, and five rules cover that:

- **`S-3`** used to mean "a claim or a premise reference, not both and not neither". It now means exactly one of a claim, a premise or an expression reference, so an expression-bound variable passes it. The code is unchanged. A consumer that reacts to `S-3` by assuming only the first two kinds exist must handle the third.
- **`S-15`** is checked on every mutation and on load, so such data never loads: a response whose `respondsTo` names its own argument, an expression-bound variable in a standard argument, or one bound into an argument other than the one answered.
- **`E-8`**, **`E-9`** and **`E-10`** are Evaluable, not Structural, so that the data still loads and can be repaired:
    - `E-8`: a response stored with a conclusion. The engine never designates one, so this comes only from stored data.
    - `E-9`: two expression-bound variables on the same expression and aspect. `bindVariableToExpression` returns the existing variable instead of adding a second, so this too comes only from stored data.
    - `E-10`: a binding on another version of the argument answered, for example from a rebase that was only partly saved. Finishing the rebase with `rebaseResponse` repairs it (see [forking-and-diffs.md](forking-and-diffs.md#moving-a-response-to-a-newer-version)).
- `E-7` does not apply to a response. Rules D-4 and D-5 do not restrict expression-bound variables.

## Assistive and permissive behavior

The engine has one setting, `behavior`. Set it at construction (`{ behavior: "permissive" }`, on `PropositCore` or `ArgumentEngine`) or later with `engine.setBehavior(...)`.

- **`"assistive"`** (the default): after every successful mutation the engine runs automatic tidying rules on the tree:
    - AN-1 adds a `formula` between nested operators;
    - AN-2 removes double negation;
    - AN-3 removes empty operators and replaces a single-child one by its child;
    - AN-4 flattens the same operator nested through a `formula`.

    If the argument was Presentable before the mutation, it is Presentable after. The changeset a mutation returns includes what the tidying changed.

- **`"permissive"`**: nothing is tidied; only Structural rules are enforced.

The tidying works against incremental building. A new operator with no children is removed at once by AN-3. So build a tree in permissive behavior, switch back, and call `engine.normalize()`, as in the example in [building-arguments.md](building-arguments.md). Switching back to assistive does **not** tidy by itself.

`behavior` is not saved in snapshots. A restored engine is assistive, but a fork keeps its source's setting.

## Normalize and repairs

`engine.normalize(tier = "presentable")` applies the tidying rules across the whole argument until nothing changes. It never changes what the argument means: it never deletes a variable, never changes which claim a variable stands for, and never swaps one operator for another. So it cannot fix Evaluable or Derivable problems.

The fixes that do change meaning are separate methods, and they never run on their own. Each returns the violations it resolved:

| Method                                                                         | Fixes                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `removeUnresolvableVariables()`                                                | `E-3`: deletes variables whose binding does not resolve |
| `removeOrphanOperators()`                                                      | `E-1`: removes operators with too few children          |
| `removeDuplicateDerivationPremises("keep-first" \| "keep-largest-antecedent")` | `E-6`: keeps one derivation premise per claim           |
| `dropAxiomsFromMixedAntecedent()`                                              | `D-3`: removes the axiom side of a mixed antecedent     |

## Formula strings

`parseFormula("(P and Q) -> R")` returns a syntax tree (`TFormulaAST`), not an engine tree. Operators:

| Operator | Symbols       |
| -------- | ------------- |
| not      | `¬`, `!`      |
| and      | `∧`, `&&`     |
| or       | `∨`, `\|\|`   |
| xor      | `⊻`, `^`, `⊕` |
| implies  | `→`, `->`     |
| iff      | `↔`, `<->`    |

Each operator's name also works as a word, in any letter case. Binding strength, tightest first: not, and, or, xor, then implies and iff. A name such as `NotRaining` is one variable, not `not Raining`.

The CLI's `arguments import` and the `ArgumentParser` use this parser to build premises from formula strings.
