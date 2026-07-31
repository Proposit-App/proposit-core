# upcoming changelog

<changes starting-hash="68f2481" ending-hash="HEAD">

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
- **`SOURCE_ANCHOR_NOTE_CODES` — non-fatal notes for anchor resolution.**
  Finalize emits `SOURCE_ANCHOR_UNRESOLVED` when a quote is not found in the
  input and `SOURCE_ANCHOR_AMBIGUOUS` when it occurs more than once and the hint
  broke the tie. Both are `severity: "warning"` on `PipelineResult.failures` via
  `ctx.addFailure`; neither stops assembly. Dropping an unlocatable quote was
  already correct, but dropping it in silence meant a model that started
  paraphrasing would take anchor coverage to zero in production with no
  detector. An empty relation evidence quote is not reported — it is a legal
  "no span to cite", not a failed lookup.
- **`locateSourceAnchor` now returns `TSourceAnchorMatch`** —
  `{ anchor, occurrences }` rather than a bare anchor, so a caller can tell a
  unique match from a tie-break. The emitted `sourceAnchors` payload is
  unchanged.
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

## Fixed

- **Anchor `prefix`/`suffix` no longer strand a lone surrogate.** The context
  window is measured in UTF-16 code units, so a non-BMP character straddling its
  boundary used to leave an unpaired surrogate at the edge of the string. That
  is not cosmetic: Postgres rejects an unpaired surrogate escape on insert into
  `json`/`jsonb`, so a single emoji 31 code units from a claim would fail a
  consumer's whole persist transaction, and a `TextEncoder` round-trip instead
  substitutes U+FFFD, silently breaking the re-locate path the context exists to
  serve. The window now shrinks by one code unit, dropping the character whole.
- **A pipeline input without a `text` field no longer throws out of finalize.**
  `TStageContext.input` is `unknown` and `finalizeResponseV2` is public API for
  consumers assembling their own pipelines; the input was cast rather than
  checked, so a pipeline whose `inputSchema` is (say) `{ document: string }`
  reached `haystack.indexOf` with `undefined` and threw on the happy path, after
  every LLM call had been paid for. Anchors are the only reader of the input, so
  a missing `text` now yields no anchors — the documented behavior — instead.
- **Segment offsets are located rather than trusted.** The hint composition read
  the model's `segment.span.start`, while the segmentation prompt requires
  `segment.text` be copied verbatim — so the true offset was recoverable and the
  untrusted number was being used anyway. Measured on the recorded corpus the
  model's spans run one short per segment and accumulate with document length;
  harmless while every quote is unique, and a confidently wrong location the
  moment one repeats. Segments are now found by searching left to right behind a
  cursor (so a repeated segment does not collapse onto an earlier copy), falling
  back to the reported number only when a segment cannot be found.

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
  never turned into an anchor at an unverified offset. It is now also the only
  resolution note the whole recorded corpus emits, so the new warning channel
  starts life with signal and no noise.

</changes>
