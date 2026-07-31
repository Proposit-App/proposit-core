# upcoming changelog

<changes starting-hash="68f2481" ending-hash="30c4411">

## Added

- **`locateSourceAnchor` + `TIngestionSourceAnchor`, exported from `@proposit/proposit-core/pipelines/base`.**
  `locateSourceAnchor(input, quote, hintUtf16)` finds a quote in a text and
  returns `{quote, startUtf16, endUtf16, prefix, suffix}`, or `undefined` when
  the quote cannot be found. The ladder is exact match, then a
  whitespace-insensitive retry (any whitespace run matches any other, covering a
  model that flattens a line break to a space); nothing approximate. `hintUtf16`
  only selects among repeated occurrences, so a wrong hint degrades to "picked
  another occurrence of the same text", never to a wrong span. `prefix`/`suffix`
  carry `SOURCE_ANCHOR_CONTEXT_CHARS` (32) characters of surrounding input,
  clamped at both ends. On a whitespace-insensitive hit the returned `quote` is
  the **input's** text for the matched range rather than the caller's copy,
  which is what keeps `input.slice(startUtf16, endUtf16) === quote` true for
  every anchor the function returns.
- **`finalizeResponseV2` attaches `sourceAnchors` to claims and premises.** A
  claim gets one anchor per canonicalizer mention that resolved to it, in
  `mentionIds` order, deduped by range; a premise compiled from a relation gets
  one anchor for that relation's `evidence.quote`. The key is **omitted
  entirely** when nothing resolves — never `sourceAnchors: []`.
- **The mention hint is `segment.span.start + mention.span.start`.** The
  composition is required: `claim-mention-extraction` asks the model for spans
  "relative to the SEGMENT'S TEXT (not the original input)", so a raw mention
  span drifts further from the truth the deeper into the document a claim sits.
  It is only a hint either way — offsets are produced by locating the quote, so
  an emitted span always slices back to its own quote.
- **`TFinalizeResponseV2Input` takes optional `segmentation` and `mentions`.**
  The two stage outputs are passed in rather than read from `ctx`, because a
  pipeline that lacks those stages can neither declare them in
  `finalize.dependsOn` (`UNKNOWN_DEP`) nor have finalize read them (`ctx.get`
  outside `dependsOn` is a configuration error). `createScholarPipeline`
  declares both as optional finalize deps and passes them;
  `createScribePipeline` passes neither.

## Changed

- **`createScholarPipeline`'s `finalize.dependsOn` gains two optional entries** —
  `segmentation` and `claim-mention-extraction`. Both already ran; neither can
  fail the finalize gate, since an optional dep never propagates a skip.
- **`mentionIds` and `suggestedSymbol` are still stripped from the finalized
  claim**, and the comment saying so now explains why: carrying the raw ids
  forward would hand a consumer an id space the response never contains, while
  the resolved anchors are the actionable form of the same trace.

## Notes

- **No prompt changed and no LLM call was added.** The per-fixture
  `*-recorded-llm.json` recordings are byte-identical across this change, which
  the replay harness's prompt-hash guard would have rejected otherwise, and the
  golden e2e suites now assert the LLM call count directly (8 for the thorough
  pipeline, 2 for the fast one).
- **The fast pipeline emits no claim anchors.** It has no segmentation or
  mention stage and its `extract` prompt asks for synthetic mention ids. Its
  relation evidence would anchor premises, but its `structure` prompt states
  that an empty quote is acceptable and the recorded fixtures take that option,
  so in practice it currently produces none.
- **One recorded relation quote in the corpus is elided rather than verbatim**
  (`with-url-citation` joins two clauses with `...`), so that premise resolves
  to no anchor. Dropping it is the designed behavior — an unlocatable quote is
  never turned into an anchor at an unverified offset.

</changes>
