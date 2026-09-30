// Prints the start of the tarball name `pnpm pack` would give this package:
// the package name with the leading `@` dropped and `/` turned into `-`, then
// the version. `@proposit/proposit-core` at 5.4.1 prints
// `proposit-proposit-core-5.4.1`.
//
// Usage: node scripts/pack-branch/tarball-stem.mjs   (from the package root)

import { readFileSync } from "node:fs"

const { name, version } = JSON.parse(readFileSync("package.json", "utf-8"))
process.stdout.write(`${name.replace(/^@/, "").replace(/\//g, "-")}-${version}`)
