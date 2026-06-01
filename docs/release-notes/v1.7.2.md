# Upcoming release notes

## A few more types are now importable

Three types that were already part of the public API (used in the signatures of
`ClaimLibrary.create`, `ArgumentEngine.populateFromAxioms`, and the OpenAI provider
options) can now be imported by name from `@proposit/proposit-core`:
`TClaimCreateInput`, `TPopulateResult`, and `TOpenAiFetch`. The generated API docs
are now warning-free.
