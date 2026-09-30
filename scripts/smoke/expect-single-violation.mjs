// Checks the JSON printed by `analysis validate-argument --tier <tier> --json`:
// the argument is reported invalid at that tier, with exactly one violation,
// carrying the given rule code and an expression locator. Exits 1 otherwise.
//
// Usage: <cli> … analysis validate-argument --tier <tier> --json \
//     | node scripts/smoke/expect-single-violation.mjs <tier> <code>

import { readFileSync } from "node:fs"

const [tier, code] = process.argv.slice(2)
if (tier === undefined || code === undefined) {
    process.stderr.write("usage: expect-single-violation.mjs <tier> <code>\n")
    process.exit(2)
}

const data = JSON.parse(readFileSync(0, "utf-8"))
const violations = data.violations ?? []
const [violation] = violations
const matches =
    data.ok === false &&
    data.tier === tier &&
    violations.length === 1 &&
    violation.code === code &&
    typeof violation.expressionId === "string"

if (!matches) {
    process.stderr.write(
        `FAIL: expected one ${code} violation at the ${tier} tier, got ${JSON.stringify(data)}\n`
    )
    process.exit(1)
}
process.stdout.write(
    `${tier} ${code} on expression ${violation.expressionId}\n`
)
