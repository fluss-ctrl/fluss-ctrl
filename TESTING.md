# Testing

The layers come from SPEC §11. CI blocks a merge on any failure. Rules that apply to every layer
are in `CLAUDE.md` ("Testing"): bug fix means a failing test first; parsers and grant logic get
fast-check property tests; time-dependent code uses the injected clock; no `.skip` or `.only`.

| # | Layer | Tool | Command | Status |
|---|-------|------|---------|--------|
| 1 | Unit | Vitest | `pnpm test:unit` | ✅ runs every workspace's `src/**/*.test.ts` with coverage |
| 1a | Property-based | fast-check in Vitest | `pnpm test:unit` | arrives with the first parser or grant logic |
| 2 | Contract (routes vs committed `openapi.json`) | Vitest, oasdiff, Spectral | `pnpm test:unit`; oasdiff and Spectral in CI | needs OpenAPI generation (#7) and CI (#3) |
| 3 | Provider conformance (simulator) | Vitest (`packages/conformance`) | `pnpm test:unit` | skeleton in #8 |
| 4 | Integration (real Postgres) | Vitest + Testcontainers, `@cloudflare/vitest-pool-workers` | `pnpm test:integration` (Docker) | runs, but no suites until #5 |
| 5 | E2E against the PR preview | Playwright | `pnpm test:e2e` (`$PREVIEW_URL`) | not yet implemented (#9) |
| 6 | Smoke (end of every deploy) | the Playwright suite | run by the deploy workflow | #9, #10 |
| 7 | Synthetic monitoring | OpenStatus, scheduled GitHub Action | none locally | later phase |
| 8 | Load | k6 | before each phase gate | later phase |
| 9 | Chaos | scripted scenarios | none locally | later phase |
| 10 | Security | Semgrep CE, gitleaks, dependency review, ZAP | gitleaks runs in the pre-commit hook; the rest in CI | CI in #3 |
| 11 | Regression | any layer above | — | every bug fix |
| 12 | Migrations | squawk, previous release's suite | CI | #5, #3 |
| 13 | Docs as tests | quickstart snippets | `pnpm test:docs` (`$PREVIEW_URL`) | not yet implemented (#9) |
| 15 | Architecture | dependency-cruiser | `pnpm lint` (runs `pnpm lint:deps`) | ✅ routes → core → db; providers never import db |

Items 14 (restore drill), 16 (portability), 17 (DR drills), 18 (hardware canary) and 19 (vendor
contract drift) are scheduled jobs or later-phase work and have no local command.

## Running a subset

```sh
pnpm test:unit                                     # all unit tests, with coverage
pnpm --filter @flussctrl/api test                  # one workspace
pnpm --filter @flussctrl/api test src/env.test.ts  # one file
pnpm --filter @flussctrl/api test -t "refuses"     # one test by name
```

## Coverage

Coverage is reported for every workspace and treated as a guide, except for `packages/core`,
which has a hard floor (90% lines, branches, functions and statements, set in `vitest.config.ts`).
A missed branch there can open or lock a gate. The floor is never lowered to make a PR pass.

## Writing tests

- Put unit tests next to the code: `src/thing.ts` and `src/thing.test.ts`.
- Each workspace has a `vitest.config.ts` (`defineProject`); the root config runs them all.
- Integration tests use a real Postgres via Testcontainers, never a mocked database.
- Tests never call a vendor cloud, the live Fluss backend or a real device.
