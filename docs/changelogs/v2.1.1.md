# Changelog — upcoming

- LLM-stage output validation now clamps over-long strings to their schema's
  `maxLength` instead of rejecting the output. OpenAI strict structured-output
  ignores JSON-Schema string `maxLength`, so a model can legitimately return a
  string longer than the schema allows; that recoverable case is now truncated
  to the cap (in place, before the schema check) rather than failing the stage
  and halting the whole run. Applies to every pipeline stage via the shared
  validation path. `src/lib/pipelines/stage-helpers.ts`.
