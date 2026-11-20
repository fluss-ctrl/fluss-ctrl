// Conventional Commits that reference the GitHub issue: `fix(api): reject stale grants (#123)`.
// Bot commits that have no issue are exempt: dependency updates (`chore(deps): ...`, Renovate)
// and release commits (`chore(main): release ...`, release-please).
const EXEMPT_SCOPES = new Set(['deps', 'deps-dev', 'main', 'release'])

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'references-issue': ({ header, scope }) => {
          if (scope && EXEMPT_SCOPES.has(scope)) return [true]
          return [/\(#\d+\)\s*$/.test(header ?? ''), 'end the header with the GitHub issue number, e.g. "(#123)"']
        },
      },
    },
  ],
  rules: {
    'references-issue': [2, 'always'],
  },
}
