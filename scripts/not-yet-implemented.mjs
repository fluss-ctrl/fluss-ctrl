#!/usr/bin/env node
// Placeholder for a root script listed in CLAUDE.md "Commands" whose layer does not exist yet.
// It fails on purpose: a placeholder that exits 0 would look like a green check.
// Usage: node scripts/not-yet-implemented.mjs <script> <what it will do> <issue number>

const [script = 'this script', what = 'this layer', issue = '?'] = process.argv.slice(2)

console.error(`pnpm ${script}: not yet implemented (#${issue}). It will run ${what}; see issue #${issue}.`)
process.exit(1)
