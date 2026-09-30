# Upcoming

## Changed

### Rewritten agent skill

The package ships an agent skill in `skills/proposit-core/` that tells a
coding agent how to use the library. It had fallen far behind: it described
three-valued evaluation and never mentioned claims. It is now rewritten for
the current API. It covers claims and their citation and axiom connections,
`PropositCore`, four-valued evaluation and the facts a result reports, the
four grammar tiers, saving and reloading arguments, forking and diffs, the
LLM pipelines and the command-line tool. Every code example in it was checked
against this release. The page about this repository's own tests is gone,
since it was of no use to someone who installed the package.

### No `openai` peer dependency

The package no longer declares `openai` as an optional peer dependency. The
OpenAI provider has called the Responses API with plain `fetch` for some time
and never imported the SDK, so nothing you install or import changes. If you
installed `openai` only because of that entry, you can remove it.

## Fixed

### `repair` no longer changes a published version

A published version is read-only, and every CLI command that changes a version
refuses to touch one, except `repair`, which wrote its fixes anyway. It now
refuses with the usual "is published and cannot be modified" error. You can
still run `repair --dry-run` on a published version to see what it would
change.

### Clearer error from `analysis show` and `analysis reset`

When the analysis file does not exist, these two commands now say
`Analysis file "…" does not exist.`, the same as the other analysis commands.
`reset` reports the missing file before complaining about its `--value`.
