# Release Notes

## New Features

- **Unparsed URL sources** — A new "catch-all" source type for URLs that haven't been classified into a specific reference category yet (e.g., book, journal article, website). Useful for AI-ingested arguments or quick drafts where only a link is available. These sources can be enriched into proper IEEE references later.

- **Smarter source extraction during parsing** — When parsing natural-language text into an argument, the system now extracts source URLs directly. If the text contains markdown links, the link text is preserved alongside the URL. Plain URLs are captured as-is.
