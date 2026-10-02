# Plan: carry a reader's agreement with a response argument into the argument it answers

Against the spec's fourth revision. "Criterion N" is the spec's acceptance criterion N. Work happens on `feat/response-arguments`, after the response item it is blocked by (already recorded as `blocked_by`), and ships with it in 6.0.0.

**Rule for every task:** the task's tests are written first and run against the tree before the code changes. A new test that already passes must say in its own name that it pins behaviour meant to stay the same, or be strengthened until it fails. `pnpm run check` passes at the end of every task, and each task is one commit, or two when a behaviour-preserving step is split from a behaviour change.

## Decisions the spec leaves open, settled here

1. **An answer on a premise that is not a link** is now settled in the spec (`notALink`, Interface and criterion 5).
2. **A link of Z whose cube fixes both one of Y's `x` columns and claim columns.** The `x` values become answers on Y's links. The claim values are not reported, because Y is never evaluated and a response target's result holds only link answers (spec, "Only link answers are returned for a response target"). A cube that fixes no `x` is `noLinkReached`.
3. **A cube whose fixed columns include an external premise column** places the value on every variable of the target with that exact referent (argument, version, premise), in the evaluated premises.
4. **Evaluation's own value for a two-valued row.** The cube walk evaluates the expanded expression on rows of `true`/`false` only, with the combined set's own evaluator, so it uses exactly the operator rules the checks use.

## Tasks

### Task 1. Make a target expression's expansion reusable (behaviour-preserving)

- **Modifies** `src/lib/core/response/combined-premise-set.ts`:
  - move the closure that expands a target expression (`expandTarget`, starting at `:156`) and its column helpers (`:105-139`) into an exported factory, `createTargetExpander(target)`. It returns `{ expand(expressionId): TCombinedNode, columns: Map<string, TColumnReference>, claimColumn, premiseColumn, expressionColumn }`. The column helpers are exposed because `buildCombinedSet`'s `expandResponse` still needs them, and must add to the same `columns` map;
  - `buildCombinedSet` uses the factory, so the column keys and expansions it produces are unchanged;
  - export the evaluator `evaluateNode` (`:316`) as `evaluateCombinedNode`.
- **Why the factory covers the target only.** The spec finds the cube over E's expansion alone, with every column free. The response's grounded columns (`forcedTrueColumns`) are recorded only while the response's own premises are expanded (`expandResponse`, `:230`, adding at `:248-254`); expanding a target expression never records one. So a cube walk that uses the factory, and never `buildCombinedSet`, leaves a column the response grounds free by construction. That is the spec's deliberate departure from `checkLink` for a response that grounds a target claim, and Task 3 pins it.
- **Proves it:** the existing `test/core/response-check.test.ts`, `response-links.test.ts` and `response-rebase.test.ts` pass unchanged. No new test is added, since nothing changes. The factory is internal and not exported from `src/lib/index.ts`.

### Task 2. Exact decomposition of a statement

- **Creates** `src/lib/core/response/carry.ts` with `decomposeStatement(expander, expressionId, value)`. It returns one of:
  - `{ kind: "cube", fixed: Map<columnKey, boolean> }`;
  - `{ kind: "notExpressible" }`, `{ kind: "impossible" }`, `{ kind: "vacuous" }` or `{ kind: "tooLarge" }`.
- **How it works:** it collects E's columns by walking the expanded node, never from the factory's shared `columns` map, which grows with every expansion and would inflate both the ceiling check and the walk with other links' columns. It refuses above `SATISFIABILITY_VARIABLE_CEILING`, and walks every true/false row with `evaluateCombinedNode`. It keeps the rows giving `value`; the fixed columns are those all kept rows agree on. It is a cube exactly when the kept rows number 2^(columns − fixed).
- **Creates** `test/core/response-carry.test.ts` with unit cases for each outcome, using `createTargetExpander` on fixture snapshots:
  - affirm `Q ∧ R`, contradict `Q ∨ R`, contradict `P → Q`, contradict `Q ∧ R`;
  - a formula-wrapped expression;
  - a variable bound to another premise of the target, which expands into that premise;
  - `Q ∧ NOT(Q)` affirmed, which gives `impossible`, and `Q ∨ NOT(Q)` affirmed, which gives `vacuous`;
  - 17 claims under one `and`, which gives `tooLarge`.
- It also holds criterion 10's "one meaning" test:
  - for every cube, substituting the fixed values gives the link's value on every row of the free columns;
  - for every `notExpressible`, two kept rows differ in a column the cube would have fixed.
- **Proves it:** these tests, which fail before the module exists.

### Task 3. `carryAnswers` for a standard target

- **Modifies** `src/lib/types/response.ts`. It adds `TLinkAnswer`, `TNotCarriedReason`, `TCarriedSource`, `TCarryResult` and `TCarryCollision`, as named in the spec's Interface. `TCarryResult` is a union on `status` (`"invalid"` with `problems: TLinkViolation[]`, or `"carried"`). The `"carried"` member is itself a union on whether the target is a response, so a response target's result has no `variables` or `operatorAssignments`.
- **Modifies** `src/lib/core/response/carry.ts` with `carryAnswers(input)`. Its input is the response's links (`listLinks`), its premises and variables, the target snapshot, the answers and the target claim lookup. It does the following:
  - **refusals:** checks the response, the snapshot and `validateLinks`, giving `status: "invalid"`;
  - **statement links:** decomposes each agreed statement link (Task 2), then places each fixed value:
    - a claim column goes onto every variable of that claim named by an evaluated premise of the target; a derivation premise whose root is a lone variable (naked-Q form) is not one;
    - for an axiomatic variable, looked up through the claim lookup at its own claim version, `true` is skipped and `false` drops the whole link with reason `axiom`;
    - a link whose every value is skipped is also reported as `axiom`;
    - an external premise column goes onto its variable;
  - **inference links:** maps each agreed inference link by the spec's Inference links table, using `positionClassOf` (which reads through formula nodes) and `isPremiseRootExpression` (`fingerprint.ts:128`). `positionClassOf` returns `inDerivation` for a derivation premise's root and its nested operators alike, so the root test is what separates `accepted` from `nestedReinforce` there. `positionClassOf` also returns `nested` for nested operators of both freeform premises and the conclusion, so a nested undercut needs the premise id compared with the target's conclusion premise id: `rejected` in a freeform premise, `ignoredInConclusion` in the conclusion. A reinforce carries `accepted` only on a premise root, and on the conclusion's root only when that operator is `implies` or `iff`; otherwise `conclusionStatement`. A nested one is reported `nestedReinforce`. A nested undercut in a freeform premise that is not the conclusion carries `rejected`;
  - **non-links:** an `agree` on a non-link premise gives `notALink`;
  - **conflicts:** finds every link that fixes a variable, or decides an operator, both ways. All of those links carry nothing, with reason `conflict`;
  - **sources:** builds `sources` with one entry per value, naming every link behind it;
- **Modifies** `src/lib/core/argument-engine.ts` with the public method `carryAnswers(targetSnapshot, linkAnswers, targetClaims)`, which builds the input and delegates. A non-response gives `status: "invalid"`.
- **Modifies** `src/lib/core/interfaces/argument-engine.interfaces.ts` with the method's JSDoc.
- **Tests** in `test/core/response-carry.test.ts`, written first:
  - criterion 1, except the `evaluateWithDefaults` bullet, which needs Task 5;
  - criteria 2, 3 and 4, and the provenance half of criterion 5;
  - the first collision bullet of criterion 6;
  - criterion 7.
  - Every bullet that evaluates X with the carried values merges them by hand until Task 5 lands, and is switched to `mergeCarriedInput` there.
- **Proves it:** those tests. Three wrong implementations are tried and reverted, and each failure is recorded in the outcome:
  - placing a claim value on the first variable of a claim only (`getVariableIdForClaim`). The two-variable case must fail;
  - finding the cube with the response's grounded columns held true, as `buildCombinedSet` does. Criterion 1's grounded-column case (Y cites S, contradicts X's `S ∧ Q`) must fail, because it then carries "Q false";
  - carrying `accepted` for a nested reinforce. Criterion 2's `nestedReinforce` bullets must fail, including the one that checks the nested operator's children keep their values.
- **Also in Task 3:** criterion 10's one-meaning check, run over every carrying link of criterion 1 through `carryAnswers`, including the grounded-column case, so a response that grounds a target claim is exercised.

### Task 4. Carrying into a response

- **Modifies** `src/lib/core/response/carry.ts`. When the target is a response, each fixed expression column (statement or inference aspect) answers every link of the target on the variable with that referent, by the rule in the spec's "Carrying into a response". Inference links of Z on a link's `NOT` give `linkStep`. Inference links of Z on any operator of a non-link premise of Y, and cubes that fix no such column, give `noLinkReached`. An `x` fixed both ways is a `conflict` for every link involved.
- **Tests** in `test/core/response-carry.test.ts`: criterion 8, except its last bullet (Task 5), and decision 2. Both `noLinkReached` bullets, statement and inference, are covered.
- **Proves it:** those tests. A wrong implementation is tried: answering a contradict link `NOT(x)` as agreed when `x` is fixed true. The `"disagree"` bullets must fail.

### Task 5. Merging, and operator decisions through defaults

- **Modifies** `src/lib/core/response/carry.ts` with `mergeCarriedInput(own, carried)`:
  - the reader's values win every collision, and each collision is reported with its sources;
  - an explicit `null` yields to a carried value, without a collision;
  - it covers `variables`, `operatorAssignments` and, for a response target, `linkAnswers`;
  - it never emits `CONTESTED`.
- **Modifies** `src/lib/types/response.ts` with `TMergedCarriedInput` and the `own` input type.
- **Modifies** `src/lib/core/argument-engine.ts`: `evaluateWithDefaults(overrides?, options?, operatorAssignments?)` passes the third argument through (today it always passes `{}`). Its JSDoc changes in `argument-engine.interfaces.ts`.
- **Tests:**
  - criterion 6's merge and contested bullets;
  - criterion 1's `evaluateWithDefaults` bullet;
  - criterion 8's Z → Y → X bullet;
  - criterion 11 (`test/core/response-carry.test.ts`).
  - Task 3's hand merges are switched to `mergeCarriedInput`.
- **Proves it:** those tests, and the existing evaluation suites unchanged.

### Task 6. Attribution of carried values

- **Modifies** `test/evaluation/attribution.test.ts` with criterion 9, both bullets. No source change is expected, because carried values arrive in `variables` and a non-conditional conclusion-root reinforce is not carried.
- **Proves it:** the test passes. The two wrong implementations named in criterion 9 are built on scratch changes and each must fail its bullet; the outcome records the failure. Because this test is expected to pass on the tree as it is, the scratch failure is its proof.

### Task 7. Exports and the public surface

- **Modifies** `src/lib/index.ts`: in the "Response arguments" block, export `mergeCarriedInput` and the new types. `carryAnswers` is an engine method.
- **Modifies** `docs/api-surface.txt` through `pnpm run api-surface:update`. It must gain only those names, `TLinkAnswer`'s members, and the new `evaluateWithDefaults` parameter, and lose nothing (criterion 12).
- **Proves it:** `pnpm run build` passes its API-surface check, and the diff of `docs/api-surface.txt` is read line by line.

### Task 8. Documentation Sync

Evaluated against every documentation entry, over the finished diff:

| Entry | Fires? | What |
|---|---|---|
| `README.md` (Public-CLI-API) | yes | the Response arguments section gains a short "Carrying a reader's answers" paragraph and a pointer |
| `README.md#invalid-constructions` (Validation-Rules) | no | no rule, thrown error or code changes; `carryAnswers` refusals are results, not throws |
| `docs/api-reference.md` (Public-API) | yes | a "Carrying a reader's answers" section: decomposition over the target expression alone and how that differs from `checkLink` when a response grounds a target claim, placement, the inference table (why a reinforce carries only at a premise root, and only at a conditional conclusion root), response targets, collisions, the defaults order, every `notCarried` reason; `evaluateWithDefaults` gains its parameter |
| `AGENTS.md` (Routing) | yes, one entry | a new easy-to-violate invariant: carried values must enter `variables` / `operatorAssignments` and nowhere else, or attribution credits a value the reader supplied (the `forcedTrueVariableIds` trap) |
| `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`, `skills/proposit-core/docs/cli.md` (Public-CLI-API) | no | the CLI does not store responses |
| `src/lib/core/interfaces/argument-engine.interfaces.ts` | done in Tasks 3 and 5 | re-read for the final wording |
| `premise-engine.interfaces.ts`, `shared.interfaces.ts`, `library.interfaces.ts` | no | unchanged signatures |
| `proposit-core.ts`, `argument-library.ts`, `fork-library.ts`, `fork-namespace.ts` | no | unchanged |
| `examples/arguments/*.yaml` (Argument-Schema) | no | no schema change |
| `skills/proposit-core/SKILL.md` | yes | one line in the response overview naming carrying |
| `skills/proposit-core/docs/*.md` | yes | `building-arguments.md`: carrying, with a compiling example; `evaluation.md`: the defaults order and the new `evaluateWithDefaults` parameter |
| `docs/release-notes/upcoming.md` | yes | "Carrying a reader's answers" under Added |
| `docs/changelogs/upcoming.md` | yes | Added: `carryAnswers`, `mergeCarriedInput`, types; Changed: `evaluateWithDefaults` parameter |

Then run `tcw work docs` for this item, and commit the documentation separately from code.

## Verification

What the suite cannot check:

- **Timing.** Time `carryAnswers` on a response with 10 agreed statement links, each over a 16-column expression, and record it in the outcome. A person judges it against the speed decision already made for the checks (acceptable at the ceiling).
- **Public-repository rule.** Read the full diff for any name of, or path into, a private repository, and for planning language in source, tests and commit messages.
- **Documentation reading.** A reader new to responses can follow the API reference's carrying section to carry Z → Y → X without reading the source. A person checks this.
- **Spec trace.** Every criterion 1-13 maps to a task above:
  - 1: Tasks 3 and 5;
  - 2, 3, 4: Task 3;
  - 5: Tasks 3 and 2 (reasons);
  - 6: Tasks 3 and 5;
  - 7: Task 3;
  - 8: Tasks 4 and 5;
  - 9: Task 6;
  - 10: Task 2;
  - 11: Task 5;
  - 12: Task 7;
  - 13: Task 8.
- **Trace of the third spec revision:** criterion 1's grounded-column case, Task 3 (and its second wrong implementation); criterion 2's root and nested reinforce bullets, Task 3 (third wrong implementation); criterion 8's inference `noLinkReached` bullet, Task 4; criterion 10's definition of free columns, Tasks 2 and 3, whose one-meaning test substitutes over every column of E the cube leaves unfixed.
- **Trace of the fourth spec revision:** criterion 2's `conclusionStatement` bullet, Task 3; criterion 9's second bullet, Task 6; criterion 10 with a grounding response, Task 3; criterion 5's `notALink`, Task 3.
- **The combined 6.0.0 review.** The at-most-one operator must add its case to `evaluateCombinedNode`; the decomposition then handles it with no other change. The combined review checks that, and carried values under that operator's propagation rule.

## Notes

- Before implementation starts, `tcw work start` needs the response item out of the way, because it is recorded as a blocker. The response item stays active until its verify stage; that is the gate to clear first.
- The cube walk and the checks share one expander and one evaluator (Task 1), so they agree on what an expression is by construction. They read it differently on purpose: the cube walk with every column free, the checks with the response's grounded columns held true (spec, "Statement links").
