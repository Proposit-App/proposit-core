# Upcoming

## Added

### API reference for every subpath

The generated API reference now covers four subpaths it left out:
`extensions/openai`, `extensions/chat-completions`, `builder` and
`pipelines/scheduling`. Two types their signatures already used are now
exported where you can name them:

- `TChatCompletionsFetch`, the type of the chat-completions provider's
  `fetch` option;
- `TStageOutcomeRecordMap`, the record map the scheduling helpers take.
