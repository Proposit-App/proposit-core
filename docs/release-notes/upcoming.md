# Upcoming release notes

## Run the LLM pipeline locally with Ollama (developer tooling)

You can now run the entire LLM-backed stack — including the full v2
argument-ingestion pipeline — against a local [Ollama](https://ollama.com)
daemon instead of OpenAI, with zero API cost. This is intended for local
development and testing; production deployments continue to use OpenAI.

A new optional provider lives at
`@proposit/proposit-core/extensions/ollama`. Point the whole pipeline at
a local model in a couple of lines:

```ts
import { OllamaProvider } from "@proposit/proposit-core/extensions/ollama"
import {
    createIngestionV2Pipeline,
    basicsExtension,
    executePipeline,
} from "@proposit/proposit-core"

const llm = new OllamaProvider() // defaults to http://localhost:11434
const pipeline = createIngestionV2Pipeline(basicsExtension, {
    llm: { defaults: { model: "qwen3.6:latest" } }, // retarget every stage
})
const result = await executePipeline(pipeline, { text }, { llm })
```

Notes:

- The `ollama` npm package is an **optional** dependency — only installed
  if you use this provider. If it's missing, the provider throws a clear
  error telling you to install it.
- Structured output uses Ollama's native JSON-schema-constrained
  generation (`format`). Token caps map to `num_predict`; the
  OpenAI-specific reasoning-effort knob is ignored.
- The context window defaults to a generous 32768 tokens (configurable
  via `new OllamaProvider({ numCtx })`). This matters because Ollama
  **silently truncates** prompts longer than its context window — with
  no error — so a small default would quietly mis-parse real
  multi-kilobyte inputs. Raise `numCtx` further if you feed very large
  documents.
- The default everywhere is still OpenAI; the Ollama path is purely
  opt-in by explicit wiring.

## New: per-stage model override on the ingestion pipeline

`createIngestionV2Pipeline` now accepts a `model` knob on its
`llm.defaults` / `llm.overrides` surface, so you can change which model
each stage targets without forking the pipeline. Each stage keeps its
built-in default model when you don't set one, so existing behavior is
unchanged.
