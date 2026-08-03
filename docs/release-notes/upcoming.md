# upcoming release notes

## Fast ingestion now traces claims back to the source text

An argument built by the fast pipeline records where in the source text each of
its claims came from. Previously only the thorough pipeline did, so a fast
import produced an argument with no link back to a single passage of the text it
was read from.

The fast pipeline's extraction pass now returns the span of the input that
states each claim, quoted exactly, and those spans are located in the text and
attached to the claims. It still costs the same two model calls.

Inferences remain unattributed on the fast pipeline. The step that reads the
argument's structure is shown the claims rather than the text they came from, so
it has no passage to cite; it is no longer asked for one. The thorough pipeline
is unchanged and still attributes both.
