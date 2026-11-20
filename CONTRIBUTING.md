# Contributing

Read [`CLAUDE.md`](CLAUDE.md) first: it is the rulebook for everyone, human or agent. `SPEC.md`
decides behaviour; if your change disagrees with it, change the spec in the same PR.

## Flow (GitHub Flow)

1. **Start from an issue.** Every change traces to a GitHub issue in the current phase's milestone.
   If there is none, open one from the templates first.
2. **Branch from `main`:** `feat|fix|chore/<issue>-<slug>`, for example `feat/123-grants` or
   `fix/140-stale-grant`.
3. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/) and end the header
   with the issue number: `fix(api): reject stale grants (#123)`. commitlint enforces this in the
   `commit-msg` hook. Bot commits (`chore(deps): …`, release-please's `chore(main): release …`)
   are exempt.
4. **Push early and open a draft PR.** Fill the PR template: summary, `Closes #123`, how you
   tested (commands and their summary lines), risk level. Small PRs, one concern each.
5. **Green, then review.** Mark the PR ready only when every check passes. `main` needs a PR, one
   approval and code-owner review; nobody pushes to `main` or force-pushes.

## Before you push

```sh
pnpm test:unit && pnpm lint && pnpm typecheck
pnpm test:integration     # also, when you touched packages/db or a migration (needs Docker)
```

Lefthook runs ESLint on staged files, gitleaks and commitlint locally. Install it once per clone
with `pnpm exec lefthook install` (the dev container does this). Never bypass it with `--no-verify`.

## Style

- TypeScript `strict` everywhere. neostandard with ESLint Stylistic is the style; there is no
  Prettier. `pnpm exec eslint --fix .` fixes most issues.
- Zod at every boundary. Prefer the standard library and WebCrypto over a new dependency; a new
  dependency needs a one-line reason in the PR. Dependencies are pinned to exact versions and
  Renovate updates them weekly.
- Never add `.skip`/`.only`, an `eslint-disable` or `@ts-expect-error` without a reason and an issue.

## Decisions and docs

- Structural decisions (stack, data model, API shape) get an ADR in [`docs/adr/`](docs/adr/).
- Behaviour changes update `SPEC.md` and the guide in `apps/docs`. The API reference and the
  changelog are generated; don't hand-edit them.
- Operational changes (new queue, cron or secret) update [`docs/runbooks/`](docs/runbooks/).
