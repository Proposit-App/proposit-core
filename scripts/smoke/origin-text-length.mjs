// Prints the length, in code points, of an origin document's stored text.
// Anchor offsets are code points, so this is the length they index into.
//
// Usage: <cli> origins show <id> --json | node scripts/smoke/origin-text-length.mjs

import { readFileSync } from "node:fs"

const data = JSON.parse(readFileSync(0, "utf-8"))
process.stdout.write(String([...data.document.text].length))
