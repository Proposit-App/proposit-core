# upcoming release notes

## Added

- **An ingested argument now says which part of the original text each piece
  came from.** Every claim the thorough pipeline extracts carries the sentence
  or clause it was drawn from, quoted word-for-word, together with where that
  text sits in the input and a little of what surrounds it. Each premise built
  from an inference carries the passage that showed the inference. The pipeline
  already worked this out and threw it away; it is kept now, so an application
  can point a reader back at the original wording instead of only showing the
  formalized result.

    The quoted wording is the reliable part. Positions are given as a convenience
    and are always checked against the text before being handed over — if a quote
    cannot be found word-for-word, nothing is reported for it rather than a
    confident guess at the wrong passage.

    When a passage cannot be matched, or when the same wording appears in more
    than one place and one had to be chosen, the run says so alongside its
    result. An application can watch that to notice a drop in quality rather
    than discovering it from a reader. If the text was never handed to the run
    at all, it says that once instead of complaining about every passage.

    No extra work is asked of the language model and nothing costs more to run.
    The fast pipeline does not produce this detail, because it never breaks the
    text into pieces in the first place.
