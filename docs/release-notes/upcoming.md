# Release Notes

## Breaking Changes

- Minimum Node.js version raised from 20 to 22.3.0. The CLI uses `fetch` and `fs.cp`, which are stable starting in Node 22.3.0.

## Internal

- Added ESLint rules to enforce browser compatibility in library code (`src/lib/`, `src/extensions/`). Node.js built-in modules and Node-only globals are now banned in library files, ensuring the core engine works in both Node.js and browser environments.
