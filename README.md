# Fluss Ctrl

A hardware-agnostic access-control API for gates, booms and doors: status, trigger, share, revoke
and logs, on Cloudflare Workers and Postgres. Fluss Ctrl owns tenancy, grants, command
verification, the event log and webhooks; device connectivity lives behind `Provider` adapters.

- **What it does and how:** [`SPEC.md`](SPEC.md) (source of truth for behaviour)
- **Why and when:** [`PLAN.md`](PLAN.md)
- **Rules for humans and agents working here:** [`CLAUDE.md`](CLAUDE.md), [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Tests:** [`TESTING.md`](TESTING.md)
- **Decisions:** [`docs/adr/`](docs/adr/) · **Runbooks:** [`docs/runbooks/`](docs/runbooks/)

## Getting started

Requirements: Node 22 (see `.nvmrc`), pnpm 10 (via `corepack enable`), Docker for integration
tests, and [gitleaks](https://github.com/gitleaks/gitleaks#installing) on your PATH for the
pre-commit hook (`brew install gitleaks`, or a release binary). Or open the repo in the dev container (`.devcontainer/`), which sets all of this up.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec lefthook install      # pre-commit lint + gitleaks, commit-msg commitlint
pnpm test:unit && pnpm lint && pnpm typecheck
pnpm dev                        # API on http://localhost:8787 (try /health)
```

For local overrides copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars`. Never commit it.

## Layout

```
apps/api                  Hono on Cloudflare Workers
apps/docs                 Astro Starlight + Scalar reference (placeholder)
apps/cli                  fctl CLI (placeholder)
packages/core             domain logic: schemas, grants, command state machine, errors, HTTP client
packages/db               Drizzle schema, migrations, org-scoped repositories
packages/providers/*      provider adapters (simulator first)
packages/conformance      provider conformance suite
packages/webhooks         Standard Webhooks sign/verify helpers
docs/                     ADRs, runbooks, postmortem template
```

The full target layout is SPEC §16. Workspaces appear when their phase starts (SPEC §0).

## Commands

The root `package.json` scripts are listed in [`CLAUDE.md`](CLAUDE.md#commands). Scripts whose
layer does not exist yet fail with a "not yet implemented (#n)" message naming the issue that adds it.
