# Clean up the repository's structure and readability without changing behaviour

The maintainer asked on 2026-09-30 for an overall architecture and code hygiene
review: "I'm not looking to change application behavior or logic, but rather
clean up the repository, make it more readable, structure the code more
logically, break up big files into smaller ones, etc."

The review proposed six cleanup batches and five questions. The maintainer
approved all six batches, in whatever order works best, and decided:

1. Drop the `openai` peer dependency, since nothing uses it.
2. Update the published skill, and add documentation entries so it does not go
   stale again.
3. Investigate whether `repair` saving without the "already published" check is
   a bug.
4. `analysis show` and `analysis reset` should check that the file exists.
5. Delete the old migration guides.

`spec.md` holds the batches and acceptance criteria.
