// Prints the `id` of the first item in a CLI JSON listing whose field equals a
// value, or nothing when no item matches. The smoke test uses it to pick an
// entity out of `… list --json` output.
//
// Usage: <cli> … --json | node scripts/smoke/find-id.mjs <field> <value>
// Reads the listing from standard input: either an array, or an object holding
// the array under `expressions`. Values are compared as strings.

import { readFileSync } from "node:fs"

const [field, value] = process.argv.slice(2)
if (field === undefined || value === undefined) {
    process.stderr.write("usage: find-id.mjs <field> <value>\n")
    process.exit(2)
}

const data = JSON.parse(readFileSync(0, "utf-8"))
const items = Array.isArray(data) ? data : (data.expressions ?? [])
const match = items.find((item) => String(item[field]) === value)
if (match !== undefined) process.stdout.write(match.id)
