# Upcoming release notes

## Control Ollama "thinking" mode

If you run a local reasoning model (like `qwen3.6`) for argument ingestion, the
Ollama provider now lets you turn the model's "thinking" trace on or off with a
new `think` option:

```ts
new OllamaProvider({ think: false })
```

A heads-up from our testing: there is no single setting that works for every
ingestion stage on `qwen3.6`. With thinking **on**, some stages hide their answer
in the thinking trace and come back empty; with thinking **off**, others drop the
JSON wrapper and return a bare list. For a hassle-free full-pipeline run, the
simplest choice is a non-thinking model such as `gemma2:9b`. And when a thinking
model does come back empty, you now get a clear, actionable error (telling you to
set `think: false`) instead of a confusing silent retry that eventually fails.
