# Plan — reachability closure and per-component walk

Six code tasks then one documentation block. Everything lands in
`src/lib/core/evaluation/satisfiability.ts` and one new test file; no new source
file is warranted for ~40 lines that only this function calls.

Ordering rationale: the tests exist before the risky change (T1), the closure is
built and proven on its own before anything depends on it (T2), and the single
behavior-changing commit (T3) is isolated between them. The suite is green at
every boundary — T2 adds an unreferenced helper, which is dead code for exactly
one commit and is the price of landing the risk alone.

## T1 — The differential oracle and the pins

**Changes:** new `test/evaluation/satisfiability-decomposition.test.ts`.

The oracle is a verbatim copy of the current flat walk, kept in the test file, so
criterion 1 compares the new implementation against the old rather than against
expectations someone wrote down. Fixtures cover `true`, `false`, and `null`.

**Be honest about which pins can fail first.** Only three of them can:

| Criterion | Before T3 | Why |
| --- | --- | --- |
| 3 (evaluation count, two components) | **fails** | the flat walk pays `2^(2k)` |
| 4 (conclusion-only variable adds no rows) | **fails** | it currently gets a column |
| 5 (over ceiling, decomposable, determinate) | **fails** | returns `null` today |
| 1, 2, 6, 7 | pass | the flat walk is already correct on these |

Criteria 1, 2, 6 and 7 are guards against the *change*, not reproductions of a
defect, and the plan says so rather than letting a green run at T1 read as
coverage. That distinction is what the citation item got wrong when a fixture
passed before the fix and looked like a pin.

Criterion 3's fixture is **one premise per component** — with several premises
per component an evaluation count is not a row count, because a row evaluates
every premise in its component and the resolver can add more.

**Verified by:** running the file at T1 — expect exactly 3 failing, all on
`expect`, none on fixture construction.

## T2 — The reachability closure, standing alone

**Changes:** `satisfiability.ts` — a module-private `collectReachableVariables`
returning, per premise, the transitive set of free variables it can reach:
named variables from `getExpressions()`, plus for each internally premise-bound
one (`isPremiseBound(v) && v.boundArgumentId === ctx.argumentId`) the reachable
set of the premise at `boundPremiseId`. In-progress premises are marked so a
cycle terminates rather than recursing — the resolver overflows the stack on
one, so there is no upstream behavior to copy here.

Not wired into `isPremiseSetSatisfiable` yet.

**Verified by:** direct unit tests in the same file — a premise naming its own
variables; a premise reaching another's through a bound variable; a two-hop
chain; an A→B→A cycle terminating. `pnpm run test` green.

## T3 — Components, the fold, and the per-component ceiling

The one behavior-changing commit.

**Changes:** `isPremiseSetSatisfiable` unions the reachable sets into components
(disjoint-set over the free ids), assigns each premise to the component of any
variable it reaches, walks each component's premise subset over its own columns,
and folds: any `false` → `false`; else any `null` → `null`; else `true`. The
ceiling is checked per component instead of against the total.

Two details that are the whole risk:

- **Forced-true variables are written into every row of every component**,
  including a component with no columns, exactly as `satisfiability.ts:71-73`
  does today. Dropping them makes a premise that reads one resolve `null`.
- **A premise reaching no free variable** forms its own component with an empty
  column set and is walked in a single row.

The early `return true` on the first satisfying row survives, per component.

**Verified by:** the three T1 pins flip to green; criteria 1, 2, 6, 7 stay green;
`pnpm run test` green.

## T4 — Prove the two pins discriminate

**Changes:** none committed. Two deliberate breakages, each reverted:

1. Drop step 2 of the closure (the `boundPremiseId` recursion) — expect
   criterion 2's test to fail **and nothing else**.
2. Drop the forced-true injection from component rows — expect criterion 7's
   test to fail **and nothing else**.

A pin that would not have caught the wrong implementation is not a pin. The
citation item ran this check and it is why its boundary test is trustworthy.

**Verified by:** the failure counts recorded in `outcome.md`; `git diff` clean
after each revert.

## T5 — Write the dependency contract where an implementor reads it

**Changes:** JSDoc on `TEvaluablePremise.evaluate`
(`src/lib/core/evaluation/argument-evaluation.ts:78`) stating that its result
must depend only on the variables reachable from `getExpressions()` and,
transitively, through internally premise-bound variables.

This is criterion 8, and it is the only thing standing behind the
decomposition's soundness — the type cannot express it, and the test suite
already contains a double (`test/evaluation/satisfiability.test.ts:101`) that
returns no expressions and a hand-written `evaluate`.

**Verified by:** `pnpm run typecheck`; the text reviewed against the spec's
Design section.

## T6 — Measure it

**Changes:** none. Instrument locally, record, revert.

Rows walked before and after for at least one real multi-premise argument from
`examples/arguments/` (criterion 10). The item's entire case is that real
arguments decompose; an unmeasured claim about that is the one thing the suite
cannot check.

If the measurement shows a single component containing everything, say so — that
is a result, and it would mean the design was wrong about the shape of real
arguments.

**Verified by:** the numbers land in `outcome.md`.

## T7 — Documentation Sync

One pass over the finished diff, after T1–T6. Evaluated against every entry in
`AGENTS.md`; four fire.

| File | Trigger | Why it fires |
| --- | --- | --- |
| `docs/api-reference.md` | `Public-API` | Two passages become false. Line 384 ("a truth-table walk with a ceiling of `SATISFIABILITY_VARIABLE_CEILING` (16) free variables, above which the answer is `null`") and lines 1552-1554 (`isPremiseSetSatisfiable`'s own entry, same claim) both describe a total-variable ceiling. It is now per component. The entry also gains the dependency contract from T5. |
| `AGENTS.md` | `Routing` | A new easy-to-violate invariant: a premise's value must depend only on the variables it reaches, or the decomposition is unsound — and nothing enforces it. This is exactly the "fires only for a NEW invariant" case. |
| `docs/release-notes/upcoming.md` | `Public-API` | Consumer-visible: arguments previously answered "not determined" may now be answered, and the exhaustive check reaches further. Plain language, no jargon. |
| `docs/changelogs/upcoming.md` | `Any-Code-Change` | Commit range and the technical account. |

Nine entries evaluated and **not** firing: `README.md` (both entries — no CLI or
validation-rule change), `CLI_EXAMPLES.md`, `scripts/smoke-test.sh`, the four
`interfaces/*.ts` entries (no `ArgumentEngine` or `PremiseEngine` signature
changes — `TEvaluablePremise` lives in `argument-evaluation.ts`, covered by T5),
`proposit-core.ts` / `argument-library.ts` / `fork-library.ts` /
`fork-namespace.ts`, and `examples/arguments/*.yaml` (no schema change).

`argument-engine.interfaces.ts` is the one judgment call: `checkValidity`'s JSDoc
does not currently describe the satisfiability precompute's ceiling, so it stays
accurate. Re-check against the finished diff rather than trusting this line.

## Verification

Beyond `pnpm run check`:

- **T4's discriminating checks.** Manual, deliberate, reverted. Nothing in the
  suite proves a test would have caught the wrong implementation.
- **T6's measurement.** The design rests on real arguments decomposing. Only
  measurement answers that.
- **The hot path.** `evaluateArgument` calls this on every evaluation
  (`argument-evaluation.ts:637`), so a regression here reaches every reader
  interaction rather than an opt-in check. The existing evaluation suites
  passing **unmodified** is the guard (criterion 9); any test that needs editing
  is a defect in the change, and the reason goes in `outcome.md`.
- **Not verifiable here:** no browser pass. This is an engine change with no
  reachable consumer surface of its own — the consumer effect is that
  `proposit-server`'s exhaustive check stops early less often, which needs a
  published core and a repin. Out of scope; noted so acceptance does not read as
  end-to-end.
