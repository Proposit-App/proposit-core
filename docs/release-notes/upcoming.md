# Upcoming release notes

## Pipeline framework

- **Run a single pipeline stage, or a pipeline's finalize, from persisted upstream state.** Two new functions, `executeStage` and `executeFinalize`, let you run one stage (or the finalize step) of a pipeline on its own, given the upstream stages' previously computed outputs and outcomes — without re-running the whole pipeline. This is what an unattended, durable import flow needs: it can run each stage in its own step, save the result, and pick up where it left off. The serialized form of each stage's result is a small `{ outcome, output? }` record that round-trips cleanly through JSON, so it can be stored and read back between steps. Both functions reuse the exact same stage and finalize behavior the whole-pipeline runner uses, so a single-stage run produces identical results, events, and token-usage to the equivalent stage inside a full run.
