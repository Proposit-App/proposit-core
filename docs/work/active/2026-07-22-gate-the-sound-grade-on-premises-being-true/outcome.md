# Outcome — Gate the sound grade on premises being true

## Failing test first

```
FAIL test/default-assignment.test.ts > gradeEvaluation — soundness requires true premises
  {"allSupportingPremisesTrue": null, "conclusionTrue": true,
-  "grade": "indeterminate",
+  "grade": "sound"}
× unknown premises with a true conclusion are indeterminate, not sound
× unknown premises with a vacuously true conclusion are indeterminate
    Expected: "indeterminate"   Received: "vacuously-true"
× treats an absent allSupportingPremisesTrue as unknown
Tests  4 failed | 24 passed (28)
```

The zero-supporting-premises case passed pre-fix (already `sound`) — expected,
it pins decided behavior rather than reproducing a bug.

## The change

One gate in `src/lib/core/evaluation/grading.ts`, after the counterexample
check:

```ts
if (result.allSupportingPremisesTrue !== true) {
    return { grade: "indeterminate", label: "Indeterminate", color: "gray" }
}
```

`!== true` covers `null` and `undefined` identically — no truthiness test. The
precedence JSDoc above `gradeEvaluation` was renumbered to match; leaving it
stale would have been worse than the bug.

`kleene.ts`, `argument-evaluation.ts`, and `checkArgumentValidity` are
untouched. Validity is a property of the argument's form and was never wrong.

## Tests

512 cases (4 trivalent values × 4 result fields × vacuous/non-vacuous) asserted
against an `expectedGrade()` written from the spec's precedence rather than
read off the implementation — otherwise the table would only assert that the
code does what the code does. Plus the four named cases.

## Verification

`pnpm run check` green: 63 test files passed / 5 skipped, 2048 tests passed /
14 skipped.

**Zero golden flips.** No existing suite changed grade, so there was nothing to
inspect or update — worth stating, because a flood of golden churn here would
have meant the gate was too broad. The one pre-existing `gradeEvaluation`
assertion (a fully citation-grounded valid argument grading `sound`) still
passes: its `allSupportingPremisesTrue` is `true` via the empty fold.

`docs/api-reference.md` needed no update — it never documented
`gradeEvaluation` or its precedence (grep for `gradeEvaluation` /
`vacuously-true` / `EvaluationGrade` across `docs/*.md` + `README.md` is empty).

## Release

Version **3.2.0** (minor — consumer-visible behavior change, not a patch).
`upcoming.md` rotated to `v3.2.0.md` in both release-notes and changelogs.

Used `pnpm version minor --no-git-tag-version` and committed manually: the
default would have created the `v3.2.0` tag, and tagging is the publish
trigger, which is deliberately not ours to pull.

Tarball packed for downstream verification and moved out of the package root
(a stray `*.tgz` there makes `pnpm publish` fail with EUSAGE). Consumed
successfully by `@proposit/shared` 0.48.0, whose cross-check test asserts
`verdictOf` and `gradeEvaluation` agree across all 128 coherent permutations.

**Not published, not tagged.** Publishing is the user's step.
