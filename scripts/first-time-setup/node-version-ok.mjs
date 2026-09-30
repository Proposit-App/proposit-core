// Exits 0 when the running Node.js is 22.3 or newer, and 1 otherwise, matching
// the `engines.node` range in package.json.
//
// Usage: node scripts/first-time-setup/node-version-ok.mjs

const [major, minor] = process.versions.node.split(".").map(Number)
process.exit(major > 22 || (major === 22 && minor >= 3) ? 0 : 1)
