# Upcoming

## Added

### Response arguments

An argument can now answer another one. A **response** carries
`respondsTo: { argumentId, argumentVersion }`, naming the argument it answers
pinned to one version, and it has no conclusion of its own. It answers through
**links**: premises whose whole content is `x` or `NOT(x)`, where `x` is a
variable bound to one expression of the argument answered.

A link can say four things about that expression:

|                                      | Against                 | For               |
| ------------------------------------ | ----------------------- | ----------------- |
| Is the statement true?               | **contradict** `NOT(x)` | **affirm** `x`    |
| Does the step of this operator hold? | **undercut** `NOT(s)`   | **reinforce** `s` |

The undercut is the new capability: it denies that a step follows without
denying either side of it, which a negated `implies` cannot express.

Build one with `bindVariableToExpression`, then read it with `listLinks` and
check its bindings against the answered argument's snapshot with
`validateLinks`.

`checkLink` tells you whether a link follows from the response's other
premises (and which ones it needs), stands as a bare assertion, or cannot be
judged because the response contradicts itself. `checkResponseCoherent` asks
whether the response can hold at all. Both read what each link says by
expanding it into the expression it names, so "contradict `Q ∧ R`" next to
"affirm Q" and "affirm R" is caught.

When the answered argument publishes a new version, the response keeps
answering the old one. To move it, copy it into a new version of your own
(keeping entity ids, as for any version) and call `classifyBindings` to see
which bindings changed, then `rebaseResponse` with a decision for each one that
did. Bindings whose meaning provably did not change need no decision.

A response may reason from the same claims its target uses, and may copy the
target's derivation premises with the same cited sources: a claim is one
proposition wherever it appears. Only links answer the target; everything else
in a response is its reasons.

`linkTargetsElement` tells you whether a stored link reference is about a
given claim or expression.

### Carrying a reader's answers

A reader who agrees with a response's links can now see that agreement in the
argument the response answers. `carryAnswers` on the response turns the
reader's `agree` answers into input for the argument answered, and
`mergeCarriedInput` adds it to the reader's own input, keeping the reader's
value wherever the two differ and listing each difference. Pass the merged
values to `evaluateWithDefaults`, which now also takes operator decisions.

Carrying is exact. A link carries what it says and nothing it does not:
affirming `Q ∧ R` carries Q and R true, but contradicting `Q ∧ R` carries
nothing, because no fixed values say "not both". A link that cannot be carried
is reported with the reason, never approximated and never dropped. Carried
values count as the reader's own assertions in attribution, and each one names
the links it came from. For a chain of answers, carry one step at a time:
carrying into another response gives answers on its links.

### Rejected conclusion step

When a reader rejects the conclusion premise's root operator, the evaluation
result now carries `conclusionInferenceRejected: true`. Nothing else in the
result changes.

### Satisfying assignments

`findSatisfyingAssignment` runs the same search as `isPremiseSetSatisfiable`
and returns an assignment under which every premise holds, when there is one.

### Show a model's reply as it is written

Pipeline stages now report the model's output text while it streams. Each
chunk arrives as a `stage:llm-text-delta` event on the `onEvent` handler you
already pass to `executePipeline`, `executeStage` or `executeTurn`:

```ts
let text = ""
let attempt = 0
await executeTurn(stage, input, {
    llm,
    onEvent: (event) => {
        if (event.kind !== "stage:llm-text-delta") return
        if (event.attempt !== attempt) {
            // A retry streams again from the beginning.
            attempt = event.attempt
            text = ""
        }
        text += event.delta
        render(text)
    },
})
```

There is nothing to switch on: the OpenAI provider already streams by default.
Things to know:

- **Start over on a retry.** When a stage retries, the new attempt streams
  its text again from the beginning, with a higher `attempt`.
- **It is the raw text.** For a stage with an output schema the chunks are
  pieces of JSON, not prose; pulling readable text out of a partial JSON
  document is up to you.
- **Tool rounds.** A stage with function tools makes one request per round,
  and any text the model writes before calling a tool streams too, ahead of
  the final answer and under the same `attempt`.
- **Where it does not fire:** the poll-only background mode, `stream: false`,
  the chat-completions provider, and `launchStage`, none of which hold a live
  stream.

Providers get the same signal directly through the new optional
`TLlmRequest.onTextDelta` callback.

### Citation dates are calendar dates

A publication date is a day as printed on the source, not a moment, and it
can be known only to its month or year. IEEE reference dates other than access
dates are now **calendar dates**: ISO strings at one of three precisions,
`"1787"`, `"1787-11"` or `"1787-11-22"`, rendered "1787", "Nov. 1787" or
"Nov. 22, 1787". No `Date` is ever built from them, so the reader's time zone
cannot move the day.

```ts
const article = {
    type: "JournalArticle",
    authors: [{ givenNames: "M. M.", familyName: "Chiampi" }],
    title: "Induction of electric field in human bodies moving near MRI",
    journalTitle: "IEEE Trans. Biomed. Eng.",
    year: "2011-10", // renders "Oct. 2011"
}
```

- **Every type dated by `year`** can now give a month or day, as IEEE's own
  examples do for journals and magazines.
- **An undated source** leaves `year` out and renders "(n.d.)", as IEEE asks.
- **New in the package root:** `CalendarDate`, `calendarDateType`,
  `parseCalendarDate` and `calendarDateFromInstant`; `formatCalendarDate` in
  the IEEE extension. The API reference's "Citation dates" section has the
  details.
- **Access dates are unchanged:** still a `Date`, rendered by its UTC day.

## Fixed

- Reloading an argument or premise with nothing beneath it under strict
  checksum verification no longer throws.
- A stored variable with two kinds of reference now fails to load with an
  error that says so, instead of one about a duplicate symbol.
- `strictUnknownAssignmentKeys` now accepts an assignment with values for
  variables in several premises; it rejected nearly every real assignment
  before. Its refusal now has the code `ASSIGNMENT_UNKNOWN_VARIABLE`.
- A variable bound to a premise in another argument no longer draws a warning
  that its premise is empty.
- **The response id arrives mid-flight on the default stream.**
  `onResponseCreated`, and so the `stage:llm-response-created` event, now
  fires as soon as the default foreground stream reports the id, instead of
  only when the call completes, for a call that makes a single request.
  Background-stream mode already did this. A call with function tools makes a
  request per round and still reports its id at completion, so the id event
  and `stage:llm-call` always carry the same id. Only a background response
  keeps generating after you disconnect, so recovering an interrupted call is
  still a background-stream guarantee.
- **Stored citations format without decoding first.** A citation read back
  from storage holds its dates as the ISO strings JSON wrote, such as
  `"2026-07-30T00:00:00.000Z"`. `formatCitationParts` used to crash on those
  with `d.getUTCMonth is not a function` unless you had run the reference
  through `Value.Decode` first. It now formats them exactly as it formats the
  decoded `Date`, and `formatDate` accepts either form. A date field holding
  something that is not a date at all now fails with a `TypeError` that names
  the field. That includes an invalid `Date`, which used to print as
  "undefined NaN, NaN".

## Migrating

- **The variable union has a third member.** If you switch on
  `isClaimBound` / `isPremiseBound` and treat "neither" as impossible, handle
  `isExpressionBound`. Only a response can hold one.
- **Not every argument has a conclusion.** A response never has one, and
  `evaluate` and `checkValidity` refuse it with `ARGUMENT_IS_RESPONSE`. Code
  that assumes every argument with premises has a conclusion should check
  `isResponse()` first.
- **S-3** reports a variable that does not have exactly one of a claim, a
  premise or an expression reference. If you match its message text, the
  "none" wording changed; match the code instead.
- **`setExtras` refuses `respondsTo`** and keeps the existing one. Set it when
  you construct the engine.
- **New checksum fields.** `respondsTo`, `boundExpressionId` and `boundAspect`
  are hashed under every checksum configuration, including one stored in an
  older snapshot. They are absent from every existing entity, so no stored
  checksum changes.
- **Keep ids stable across versions.** Rebasing a response matches the
  answered argument's expressions by id between its versions. If you copy an
  argument into a new version, keep the ids of everything that persists.
- **Implementing `TArgumentEvaluation` yourself?** It gains `carryAnswers`;
  add it, or extend `ArgumentEngine` instead.
- **A renamed refusal code.** With `strictUnknownAssignmentKeys: true`, an
  assignment naming a variable that no evaluated premise uses is now refused
  with `ASSIGNMENT_UNKNOWN_VARIABLE` instead of `ASSIGNMENT_MISSING_VARIABLE`.
  If you match that code, match the new one.
- **A cross-argument reference.** An expression-bound variable names an
  expression in another argument, as an externally premise-bound variable
  already names a premise there. If your store enforces foreign keys, account
  for it.
- **A new pipeline event kind.** If you `switch` over `TPipelineEvent`'s
  `kind` with no `default`, add a case for `stage:llm-text-delta` (or a
  `default`).
- **Citation dates are strings now.** Fifteen IEEE date fields hold a calendar
  date string instead of a `Date`. Convert each stored value with
  `calendarDateFromInstant(value)`, which takes a `Date` or its ISO string and
  gives its UTC day. That is the day meant for data stored as 5.4.2 advised,
  at midnight UTC. Data stored before 5.4.2 at local midnight east of UTC
  falls on the previous UTC day, and converts correctly only with the zone it
  was written in: `calendarDateFromInstant(value, "day", "Europe/Berlin")`.
  Access dates stay `Date`s.
- **The `year` field is optional and may hold a month or day.** Code reading
  it must handle `undefined`, and must not assume four digits. Stored years
  convert by this rule, applied to the trimmed value:
    1. a valid calendar date ("1787", "1787-11") is kept, so applying the rule
       twice changes nothing;
    2. an undated marker ("n.d.", "n.d", "nd", "n. d.", "no date", "undated",
       "s.d.", "s.a.", in any case, regardless of spaces, with or without
       parentheses) becomes an absent `year`;
    3. anything else ("c. 1787", "1787?", "[1787]", "Jul./Aug. 2007") has no
       calendar form: correct it by hand, or keep the reference as an
       `unparsed` citation, which holds the original text.
- **Unconverted citations throw when rendered.** Core does not check citations
  when it loads them, so a stored `Date`, ISO timestamp or non-conforming year
  in a calendar-date field makes `formatCitationParts` throw a `TypeError`
  naming the field. That includes `year: null`: an undated source has no
  `year` key at all, so a storage layer that turns an absent value into `null`
  must turn it back. Convert before rendering. The relaxed schemas refuse such
  values too, so `Value.Check` with them finds what is left.
- **Checksums of converted citations change** if your checksum configuration
  hashes `citation` (claims) or `reference` (origin documents). The defaults
  hash neither. Core never checks claim or origin-document checksums on load,
  so recompute them when you convert.
- **The IEEE templates changed shape.** `TSegmentSource.kind` gains
  `"calendarDate"`, and each year-dated type's template holds a conditional
  where it held the year segment. Code that walks the templates must handle
  both.
