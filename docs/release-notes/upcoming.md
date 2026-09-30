# Upcoming

## Changed

### No `openai` peer dependency

The package no longer declares `openai` as an optional peer dependency. The
OpenAI provider has called the Responses API with plain `fetch` for some time
and never imported the SDK, so nothing you install or import changes. If you
installed `openai` only because of that entry, you can remove it.
