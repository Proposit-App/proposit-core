---
from: proposit-app
---

# Scribe pipeline emits no source anchors — structure prompt permits an empty evidence quote

Found while implementing
`2026-07-30-carry-ingestion-provenance-through-pipeline-finalize`, which added
`sourceAnchors` to the finalized ingestion response. Filed as a separate item
because fixing it needs a prompt change plus a fixture re-record, which that
slice was explicitly barred from.

Related: [Argument origin data and enthymeme annotations](tcw://W/proposit-app/2026-07-29-argument-origin-data-and-enthymeme-annotations) — the epic that consumes this data.

## Problem

`createScribePipeline` produces **no** source anchors at all, so an argument
imported through the fast pipeline gets no origin provenance — no highlighting
of which claim came from which passage, on either the web or mobile reading
surface. The scholar pipeline produces them correctly.

## Root cause

Two independent causes, one per entity kind:

- **Claims cannot be anchored.** Scribe has no segmentation stage and no
  claim-mention-extraction stage, so there is no mention trace to resolve. This
  is structural, not a bug.
- **Premises should be anchored and are not.** The mechanism works — it is
  unit-tested — but the `structure` prompt states that an empty evidence quote is
  acceptable, and every recorded fixture returns `""`. The prompt withholds the
  data the resolver needs.

## Proposed fix

Scope the decision first: does the fast pipeline need to feed origin data at all?
If the answer is no, close this as `wontfix` and document the asymmetry so a
later reader does not treat it as a defect.

If yes, the premise half is the tractable one — tighten the `structure` prompt to
require a verbatim evidence quote spanning the supporting text, then re-record
the fixtures. The claim half needs a real stage addition and should be judged on
its own cost.

## Consumer impact

`proposit-server` ingestion decides which pipeline runs
(`INGESTION_DEFAULT_PIPELINE`). Whatever is decided here determines whether
fast-path imports show origin highlighting or silently show none, which is a
user-visible difference between two import paths that otherwise look identical.

## Test cases

- A recorded scribe run yields at least one premise carrying a non-empty evidence
  quote, and that quote locates in the input.
- The existing assertion that anchors resolve back to their quote holds for
  scribe as it already does for scholar.
- Stage-call counts are unchanged — this is a prompt change, not a new call.
