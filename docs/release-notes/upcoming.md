# Upcoming release notes

## Local Ollama: long thinking-model stages no longer fail after ~5 minutes

Running the v2 ingestion pipeline against a local Ollama daemon (e.g. `qwen3.6:latest` with thinking on) could fail after roughly five minutes with an "Unclassified Ollama error: fetch failed" — taking the whole run down with it. That was the HTTP client's hidden 300-second default cutting off a generation that was still legitimately running.

Two fixes:

- The Ollama provider now sets a **generous 20-minute per-request timeout** (configurable via `requestTimeoutMs`), scoped to that provider only — local thinking models often need several minutes per stage.
- A timeout that does occur is now treated as **transient and retried**, instead of being mistaken for a permanent failure that aborts the run.

This makes local-Ollama development on real, non-trivial inputs reliable. Production is unaffected (it uses OpenAI).
