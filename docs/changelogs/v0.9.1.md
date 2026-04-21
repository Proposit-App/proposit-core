# Changelog

- chore(package): add `"default"` condition to every `exports` entry (`.`, `./extensions/ieee`, `./extensions/basics`) pointing at the same `.js` file as `"import"`. Fixes `Cannot find module '@proposit/proposit-core'` under resolvers that don't evaluate the `"import"` condition (e.g. Jest's CJS resolver used transitively through `@proposit/shared`). No source, API, or runtime behavior changed. (465f8b1..HEAD)
