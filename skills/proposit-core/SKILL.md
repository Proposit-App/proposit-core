---
name: proposit-core
description: Use when writing code against the @proposit/proposit-core library or running its proposit-core CLI — building propositional-logic arguments from claims, variables, premises and expression trees; evaluating them under a reader's assignment or checking validity; validating them against the four grammar tiers; forking or diffing them; persisting them through snapshots, checksums and changesets; or turning text into arguments with its LLM pipelines.
---

# proposit-core

`@proposit/proposit-core` is a TypeScript library (with a command-line tool) for building, evaluating and checking propositional-logic arguments. An argument is a set of premises, each a tree of logical operators over variables, and each variable stands for a claim. The library holds that structure, keeps it well formed, evaluates it under a reader's truth values, and reports whether the conclusion follows.

It has no notion of users, sessions or storage. It ships no user interface and no application metadata (no author ids, timestamps or display text). An application using the library stores the data and adds its own fields through type parameters.

## The model in one page

- **`PropositCore`** is the recommended entry point. It creates and wires together six libraries: `claims`, `citations`, `axioms`, `origins`, `forks` and `arguments`.
- **Claim** — a proposition, stored once in `core.claims` and shared by reference across arguments. Claims are versioned (freeze a version to lock it). Each has an unchangeable `type`:
    - `normal`: an ordinary proposition;
    - `citation`: something a source says;
    - `axiomatic`: something taken as true by definition, convention or logic.
- **Connections** — `core.citations` records "claim X is supported by citation claim Y". `core.axioms` records "normal claim X is supported by axiomatic claim Y".
- **Argument** — one `ArgumentEngine`, created with `core.arguments.create({ id, version })`.
- **Variable** — a symbol such as `P` that expressions refer to. There are two kinds:
    - **claim-bound**: stands for a claim;
    - **premise-bound**: stands for another premise's truth value. Every new premise gets one automatically, with a symbol like `P0`.
- **Premise** — one `PremiseEngine` holding one expression tree. Its `type` is `freeform` (any tree) or `derivation` (a fixed shape stating how a claim is supported).
- **Expression** — a node in a premise's tree. It is a `variable` leaf, an `operator`, or a `formula` (a node that acts like a pair of parentheses around one child). There are six operators:
    - `not`: exactly one child;
    - `and`, `or`, `xor`: two or more children;
    - `implies`, `iff`: exactly two children, and allowed only at the root of a premise.
- **Roles** — one premise is the **conclusion**. The first premise created becomes the conclusion until you call `setConclusionPremise`. Every other premise whose root is `implies` or `iff` is **supporting**. The rest are **constraints**, which limit which assignments count.

## Things that surprise people

- **Build trees in `"permissive"` behavior.** In the default `"assistive"` behavior the engine tidies the tree after every change. That tidying deletes an operator that has no children yet, so the next child you add fails with "Parent expression … does not exist". Call `engine.setBehavior("permissive")`, build the tree, then call `engine.setBehavior("assistive")` and `engine.normalize()`.
- **Mutations throw only for broken structure.** Anything else is reported by `engine.validate(tier)` and never thrown.
- **Every mutating method returns `{ result, changes }`.** `changes` is the changeset (see [persistence](docs/persistence.md)).
- **Evaluation can report four values, not three.** A reader assigns `true`, `false` or `null` (unknown), but a result can also be `"contested"` (forced both true and false).
- **An operator decision is not a truth value.** `"rejected"` takes the whole premise out of consideration. It does not make anything false.
- **Axiomatic claims are always true.** Assigning a value to an axiom-bound variable throws `AXIOM_VARIABLE_ASSIGNMENT_FORBIDDEN`. Citation-bound variables can be assigned.
- **One claim can have several variables.** Use `getVariableIdsForClaim`, not a `find` that picks the first one.
- **Absent is not the same as `null`.** A checksum covers a field whenever the key is present. Never store `null`, `false` or `undefined` for an optional field that is unset, such as `enthymeme`; remove the key instead.

## Where to look

| Topic                                                                                                                   | File                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Creating claims, arguments, variables, premises and expressions; editing trees; roles; derivation premises              | [docs/building-arguments.md](docs/building-arguments.md) |
| `evaluate`, the four truth values, operator decisions, the facts a result reports, default assignments, `checkValidity` | [docs/evaluation.md](docs/evaluation.md)                 |
| The four grammar tiers, rule codes, `validate(tier)`, assistive versus permissive behavior, `normalize` and repairs     | [docs/grammar.md](docs/grammar.md)                       |
| Snapshots, `fromData`, checksums, changesets and their storage order, reacting to changes, source texts                 | [docs/persistence.md](docs/persistence.md)               |
| Forking an argument, diffing two arguments, premise relationships                                                       | [docs/forking-and-diffs.md](docs/forking-and-diffs.md)   |
| The pipeline framework, LLM providers, turning text into an argument                                                    | [docs/pipelines.md](docs/pipelines.md)                   |
| The `proposit-core` command-line tool                                                                                   | [docs/cli.md](docs/cli.md)                               |

For more detail:

- The package `README.md` and the generated API documentation at <https://proposit-app.github.io/proposit-core/> cover every method.
- The source repository's `docs/Proposit_Grammar.md` lists every grammar rule.
- The type declarations shipped in `dist/` are the final word on signatures.

## Imports

Everything in the core is exported from the package root:

```typescript
import {
    PropositCore,
    ArgumentEngine,
    CONTESTED,
} from "@proposit/proposit-core"
```

Optional parts live at subpaths:

- `@proposit/proposit-core/extensions/openai` and `/extensions/chat-completions`: LLM providers.
- `/pipelines/ingestion` and `/pipelines/base`: text-to-argument pipelines.
- `/extensions/basics`: basic argument, claim and premise schemas plus a matching parser.
- `/extensions/citations/ieee` and `/extensions/citations/unparsed`: citation schemas.
- `/conversation`: multi-turn LLM conversations; `/builder`: ready-made conversation turns that review, simulate and distill an argument.
- `/pipelines/scheduling`: helpers for running a pipeline one stage at a time across separate processes.
