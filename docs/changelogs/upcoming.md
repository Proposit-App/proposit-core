# Upcoming

## Breaking

- The variable union `TCorePropositionalVariable` has a third member,
  `TExpressionBoundVariable` (`boundExpressionId`, `boundArgumentId`,
  `boundArgumentVersion`, `boundAspect: "statement" | "inference"`), told apart
  by the new guard `isExpressionBound`. Code that assumed a variable that is not
  claim-bound must be premise-bound is no longer exhaustive.
- An argument carrying `respondsTo` is a response and has no conclusion:
  `createPremise` and `createPremiseWithId` make no premise the conclusion,
  `removePremise` promotes none, `setConclusionPremise` throws, and
  `clearConclusionPremise` clears a conclusion a response was stored with
  (reported by E-8) even when premises exist. `evaluate`
  and `checkValidity` on a response return `ok: false` with the new code
  `ARGUMENT_IS_RESPONSE`. `listSupportingPremises` on a response returns every
  premise that is not a link.
- Rule S-3 now asks for exactly one of a claim, a premise or an expression
  reference; its message for a variable with none changed wording.
- `setExtras` throws when given `respondsTo`, and keeps the argument's
  `respondsTo`; `getExtras` leaves it out.
- `respondsTo` (argument fields) and `boundExpressionId` and `boundAspect`
  (variable fields) are hashed under every checksum configuration, including a
  configuration stored in an older snapshot. They are hashed only when
  present, so no existing checksum changes.
- Public engine interfaces gain required methods, so a class implementing one
  itself must add them: `TArgumentEvaluation` gains `checkLink`,
  `checkResponseCoherent` and `carryAnswers`; `TVariableManagement` gains
  `bindVariableToExpression` and `rebaseResponse`; `TArgumentIdentity` gains
  `isResponse` and `getRespondsTo`.
- `TGrammarRuleCode` / `GrammarRuleCodeSchema` gains `S-15`, `E-8`, `E-9` and
  `E-10`, and `TCoreValidationCode` gains `ARGUMENT_IS_RESPONSE`. A `switch`
  with no `default`, a table keyed by every code, or a stored-code enum must
  take them. New invariant codes: `ARG_RESPONDS_TO_ITSELF`,
  `ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE`, `VAR_BINDING_AMBIGUOUS`.
- With `strictUnknownAssignmentKeys: true`, an assignment key that no evaluated
  premise names is refused with the code `ASSIGNMENT_UNKNOWN_VARIABLE`; it was
  `ASSIGNMENT_MISSING_VARIABLE`. Code matching the old code must match the new
  one. The repair behind it is under Fixed.
- `TPipelineEvent` gains a member, `stage:llm-text-delta`. A `switch` over
  `kind` with no `default` stops compiling until it handles the new kind, and
  a handler that throws on an unknown kind now fails the stage on the first
  streamed chunk.
- IEEE references: 15 date fields change from `EncodableDate` (`Date`) to
  `CalendarDate` (`string`): `date` on Standard, Patent, NewspaperArticle,
  ConferencePaper, ConferenceProceedings, Blog, Presentation, Interview,
  PersonalCommunication, Email, CourtCase and GovernmentPublication;
  SocialMedia `postDate`; Video `releaseDate`; Law `dateEnacted`. The six
  `accessedDate` fields are unchanged.
- IEEE references: the `year` field of 15 types becomes an optional
  `CalendarDate` (`string | undefined`). It may hold a month or day, the
  relaxed schemas refuse values like "c. 1787" or "n.d.", and its schema
  `description` changed. An absent `year` renders "(n.d.)".
- The calendar-date source kind throws a `TypeError` naming the field for a
  value that is not a calendar date, so a stored, unconverted `Date`, ISO
  timestamp or non-conforming year makes `formatCitationParts` throw.
- `TSegmentSource.kind` gains `"calendarDate"`, and the public IEEE templates
  use it; each year type's template holds a conditional where it held the
  year segment.

## Added

- Response arguments: `respondsTo: { argumentId, argumentVersion }` on the
  argument entity (`TCoreArgumentReference`), owned by the engine;
  `ArgumentEngine.isResponse()` and `getRespondsTo()`.
- `ArgumentEngine.bindVariableToExpression`, which binds a response's variable
  to one expression of the argument it answers, in its statement or inference
  aspect, and returns the existing variable for a binding with the same
  referent.
- Links: a response premise whose whole content is `x` or `NOT(x)` for an
  expression-bound `x`, read as contradict, affirm, undercut or reinforce.
  `listLinks`, `validateLinks` (codes `LINK_EXPRESSION_MISSING`,
  `LINK_INFERENCE_ON_NON_OPERATOR`, `LINK_VERSION_MISMATCH`, and the informational `LINK_SAME_CLAIM`; it throws
  for a snapshot of another argument or version) and `elementsWithinPremise`.
  The checks below report a wrong snapshot as `invalid` with
  `LINK_TARGET_MISMATCH`.
- `ArgumentEngine.checkLink` and `checkResponseCoherent`, which search a
  premise set built from the response with each statement link expanded into
  the expression it names and claims merged into one column per claim.
  `checkLink` answers `follows` (with a minimal support set and
  `restsOnlyOnLinks`), `asserted` (with `attemptedSupport` and a
  counterexample), `incoherent`, `undetermined` or `invalid`.
- An error naming a `Date` that is not a calendar date shows it as its UTC
  instant, so it shows the stored day in every time zone.
- `classifyBindings`, `structuralFingerprint`, `positionClassOf` and
  `ArgumentEngine.rebaseResponse`, which move a response to another version of
  the argument it answers. Each binding is `unchanged`, `changed` (`content`,
  `position`, `outsideReferenceRepinned`), `removed` or `alreadyRebased`;
  `outsideSnapshots` lets references re-pinned to other versions of a third
  argument be compared rather than reported. `positionClassOf` and
  `linkTargetsElement` look through formula nodes at a premise's root.
  A nested binding whose premise gains or loses the conclusion role is
  `changed` with `position`, since carrying an undercut there changes.
- `respondsTo` is the engine's own copy: the constructor and `rollback` copy it
  in, every read hands out a fresh one, and a `null` one is left out of the
  argument.
- A response's claim-bound variables may use any claim, including claims the
  argument it answers uses; the checks read a shared claim as one proposition,
  and rebasing leaves claim-bound variables alone. Only links answer the
  target.
- `TLinkReference` and `linkTargetsElement`.
- Grammar rules S-15 (a response answering itself, or an expression-bound
  variable outside a response or bound into another argument), E-8 (a response
  with a conclusion), E-9 (two variables binding the same expression in the same
  aspect) and E-10 (a binding on another version of the argument answered).
  Invariant codes `ARG_RESPONDS_TO_ITSELF`,
  `ARG_EXPRESSION_BINDING_OUTSIDE_RESPONSE` and `VAR_BINDING_AMBIGUOUS`.
- `conclusionInferenceRejected: true` on the evaluation result when the reader
  rejects the conclusion premise's root operator, read through formula nodes at
  the root. Nothing is struck and no other result field changes.
- `findSatisfyingAssignment`, which answers the premise-set satisfiability
  search with a satisfying assignment; `isPremiseSetSatisfiable` wraps it.
- `defaultCompareArgument` reports a change of `respondsTo`, and
  `defaultCompareVariable` compares `boundExpressionId` and `boundAspect`.
- `toDisplayString` on a response names the argument and version it answers.
- `ArgumentEngine.carryAnswers(targetSnapshot, linkAnswers, targetClaims, options?)`,
  which reads what a reader's `agree` answers on a response's links carry into
  the argument it answers: variable values and operator decisions, or answers
  on another response's links. A statement link carries the fixed claim values
  its expression's expansion reduces to, read with every column free; a
  reinforce carries `accepted` only at an `implies` or `iff` premise root; an
  undercut carries `rejected` where evaluation honours one. Every value names
  its links in `sources`, and every agreed link that carries nothing is in
  `notCarried` with a `TNotCarriedReason`. `options.ownLinkPremiseIds`
  (`TCarryAnswersOptions`) names the reader's own answers on a response
  partway along a chain: a carried link that disagrees with one is dropped
  (`overriddenByOwn`) and the difference reported in the result's
  `collisions`. `mergeCarriedInput` takes those in, leaving out one whose
  carried value the reader's explicit input repeats and naming the input's
  value as `own` on one it overrules, so each key has at most one collision.
- `mergeCarriedInput(own, carried)`, which adds carried values to the reader's
  explicit input, keeping the reader's value on every collision and listing
  each. Types `TLinkAnswer`, `TCarryResult`, `TCarriedSource`, `TNotCarried`,
  `TNotCarriedReason`, `TCarryCollision` and `TMergedCarriedInput`.
- `stage:llm-text-delta` pipeline event (`{ stageId, attempt, delta, at }`),
  emitted by `llmStage` once per chunk of streamed assistant output text,
  between `stage:llm-request` and `stage:llm-call`. Not emitted after the
  caller's signal aborts. Prefixed inside `subPipelineStage` like the other
  per-stage events.
- `TLlmRequest.onTextDelta`: an optional per-chunk callback. The OpenAI
  provider calls it in both streaming modes, once per
  `response.output_text.delta` frame (a top-level `delta` string), with each
  chunk unaccumulated.
- `CalendarDate`, `calendarDateType`, `parseCalendarDate`,
  `calendarDateFromInstant`, `TCalendarDateParts` and `TCalendarDatePrecision`
  in the package root; `formatCalendarDate` in the IEEE extension.
  `calendarDateFromInstant` returns a calendar date it is given unchanged (cut
  to `precision` only when longer), and refuses a date-time string that names
  no zone or names a day or time that does not exist; it refuses an unknown
  zone whatever the value.
- `PropositCore.forkArgument` takes `respondsToSnapshot`. Forking a response
  keeps every claim its target uses instead of cloning it, so the fork's
  checks read a shared claim as one proposition, as the original's do; it
  throws when it cannot find the target at the version answered.

## Changed

- `evaluateWithDefaults` takes an optional third parameter,
  `operatorAssignments`, passed to `evaluate` unchanged. Existing calls behave
  as before.
- The satisfiability walk stops evaluating a row at its first false premise.
  Answers and witnesses are unchanged; a search with no satisfying row is
  several times faster.

## Fixed

- Strict checksum verification threw on an argument or premise with nothing
  beneath it, whose stored `descendantChecksum` is `null`. Pinned by
  `test/core/hierarchical-checksums.test.ts`.
- A stored variable carrying two kinds of reference (for example both a claim
  and a premise) failed to load with `Variable symbol "…" already exists.`
  It now fails naming the problem, `VAR_BINDING_AMBIGUOUS`. Pinned by
  `test/core/response-links.test.ts`.
- `strictUnknownAssignmentKeys: true` rejected every assignment that gave
  values to variables in two different premises, because each premise was
  checked against its own variables. A key is now unknown only when no
  evaluated premise names it, and the refusal uses the code
  `ASSIGNMENT_UNKNOWN_VARIABLE` (it was `ASSIGNMENT_MISSING_VARIABLE`). Pinned
  by `test/evaluation/strict-unknown-keys.test.ts`.
- `validateEvaluability` warned `EXPR_BOUND_PREMISE_EMPTY` for every variable
  bound to a premise in another argument, because it looked the premise up
  among this argument's own; when a local premise shared the id, the warning
  described that unrelated premise. A premise in another argument is no longer
  checked here. Pinned by `test/core/variables.test.ts`.
- The OpenAI provider's default foreground stream dropped the
  `response.created` id instead of passing it to `onResponseCreated`, so
  `stage:llm-response-created` fired only at completion. It now fires
  mid-flight in both streaming modes for a call that makes a single request.
  A function-tool loop still reports its id at completion, since a
  mid-flight id would be the first round's rather than the last round's that
  `stage:llm-call` carries.
- `formatCitationParts` threw `TypeError: d.getUTCMonth is not a function` for
  a reference whose access date held an ISO string, the form it takes after
  `JSON.stringify` and `JSON.parse` without `Value.Decode`. The `date` source
  kind, which only access dates use, now reads such a string the way
  `EncodableDate` decodes one; a value that is not a date throws a
  `TypeError` naming the field. `formatDate` still takes a `Date` only, and
  an invalid `Date` there, which used to print as "undefined NaN, NaN", now
  throws. A `Date` made in another realm (another `vm` context or
  frame) formats like any other. Calendar-date fields do not read ISO strings: see Breaking.
- An exception thrown by an `onTextDelta` or `onResponseCreated` callback,
  such as one from a pipeline `onEvent` handler, was reported by the OpenAI
  provider as a transient streaming failure, so the stage retried with a
  second request and the stream stayed open. It now passes through unchanged,
  is not retried, and the stream is cancelled. Pinned by
  `test/extensions/openai/sse-parsing.test.ts` and `provider.test.ts`.
- `executeTurn` kept the turn's user message in one variable shared by every
  call, so when turns overlapped a retry could send another turn's message,
  or the stage's empty one. Each turn now holds its own. Pinned by
  `test/conversation/conversation.test.ts`.
- `createConversation` set its chain to the failed turn's response id, or to
  `null`, after a failed turn, so the next turn lost the conversation. A failed
  turn now leaves the chain where it was.

## Tests

- The opt-in live OpenAI suite checks that text deltas arrive and, joined in
  order, parse to the output, both from the provider and as
  `stage:llm-text-delta` events through `executeTurn`.
- Every checksum is pinned to values captured from the published 5.4.2 (and,
  for forking an argument with an external binding, 5.4.3) under the default, a
  consumer-extended and a partial configuration, across snapshot and data
  round trips, rollbacks, strict reloads, `setExtras` and forking
  (`test/core/checksum-stability.test.ts`, built by
  `scripts/checksum-fixtures/`).
- SSE fixtures for `response.output_text.delta` now use the documented wire
  shape (top-level `delta`, not nested under `response`).
- The mock provider takes `deltas` and `lateDeltas` on `ok` and
  `schema-invalid` responses.
- IEEE citation tests share their fixtures (`test/extensions/citations/fixtures.ts`),
  pin the output of every year-dated type, and cover calendar-date fields,
  undated sources and the date types.
