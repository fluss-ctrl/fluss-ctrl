// neostandard (TypeScript) with its bundled ESLint Stylistic rules. No Prettier: style is lint.
import neostandard, { resolveIgnoresFromGitignore } from 'neostandard'

export default [
  // Global ignores: everything in .gitignore (build output, coverage, caches).
  { ignores: resolveIgnoresFromGitignore() },
  ...neostandard({ ts: true }),
]
