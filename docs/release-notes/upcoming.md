# Release notes — upcoming

- Ingestion pipelines are now resilient to over-long text from the model. When
  an LLM stage returns a string longer than its schema allows (for example a
  claim or premise title past its character cap), the text is trimmed to fit
  and the run continues, instead of failing the import. This matters because
  strict structured-output does not enforce string length limits, so an
  occasional over-long field is expected rather than exceptional.
