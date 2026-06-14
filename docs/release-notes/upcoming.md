# Upcoming release notes

## Basics parse no longer refuses half-baked arguments

The shipped argument-parsing prompt (`buildParsingPrompt` / `CORE_PROMPT`, used by the
CLI `parse` command, the basics parser, and legacy single-shot ingestion) now always
produces a best-effort structured argument. A lone conclusion, a one-sided passage, or
any input containing at least one proposition yields a non-null `argument` instead of a
refusal. The `argument: null` + `failureText` outcome is now reserved for input with no
extractable proposition at all (empty or non-propositional garbage). Completeness is left
to a separate review step rather than blocked at parse time.
