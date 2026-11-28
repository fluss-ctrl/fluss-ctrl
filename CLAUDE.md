# CLAUDE.md — Fluss Ctrl

<!-- Maintainers: loaded into every session and read by the PR reviewer, so a stale rule becomes a
     wrong finding. Keep under 200 lines; overflow goes to root .claude/rules/ files without paths
     (cloud threads load those, not nested CLAUDE.md files). Update the status lines at each phase
     gate. The "never" list is backed locally by .claude/settings.json and .claude/hooks/guard.mjs,
     which cloud threads skip. When the unofficial providers are cleared, remove their Read deny
     rules. Keep npm scopes in backticks (a bare at-sign path is an import). PLAN/SPEC v0.11. -->

`SPEC.md` is the source of truth for behaviour; `PLAN.md` says why and when. If a task conflicts
with the spec, stop and say so rather than quietly diverging; change the spec first, in the same PR.
If this file and the spec disagree, the spec wins: fix this file.

A hardware-agnostic access-control API (status, trigger, share, revoke, logs) for gates, booms and
doors on Cloudflare Workers + Postgres. It owns tenancy, grants, command verification, the event log
and webhooks. Device connectivity is **not** ours; it lives behind `Provider` adapters.

## Status (update at every phase gate)

- **Current phase: 0, Foundations (4 Nov – 8 Dec 2026).** Build only what SPEC §0 lists for this phase.
  Anything tagged with a later phase (emergency modes, billing, admin UI, MCP, connectors,
  Postgres-backed adapters) is context for design, not work: do not create its tables, endpoints,
  Durable Object logic or tests. If a task needs it, stop and ask.
- **Unofficial providers (SPEC §22): not cleared.** Do not write, run or test provider code for
  Accentronix or Centurion until this line says counsel has cleared it.

## Reading the spec

`SPEC.md` is long. Read §0 first, then only the sections the task touches:

| Working on | Read |
|---|---|
| Any endpoint, error or list | §1, §4, §7.3 |
| Schema or a migration | §5, §11 (items 4 and 12) |
| Grants | §6 |
| Commands, verification, the coordinator | §7 |
| Events or webhooks | §8 |
| A provider | §10, then §12, §22 or §23 for that provider |
| Tests, CI or release | §11 |
| Product behaviour you are unsure of | §18; if it is not there, add it and ask |

## Stack and layout (do not swap without an ADR)

TypeScript everywhere: Hono on Cloudflare Workers, Drizzle + Zod, Postgres (Neon via Hyperdrive),
Queues, Durable Objects with alarms, Better Auth, Standard Webhooks; Vitest (not Jest),
Testcontainers, fast-check, Playwright; pnpm + Turborepo; neostandard + ESLint Stylistic (no
Prettier). Full list and reasons: PLAN §3. The repo follows `fluss-engineering-decisions.md`
(web/API profile) with the exceptions in PLAN §13. Layout: SPEC §16; `apps/mcp` and
`packages/sdk-python` are post-launch, do not create them. No GraphQL, SSR, microservices, Redis,
Kafka, Kubernetes or second language, and no feature from SPEC §20 or a later phase unless a task
says so. If a task seems to need one, the task is probably wrong; say so.

## Commands

```
pnpm dev                 # api (console from Phase 2) on Miniflare, Neon dev branch
pnpm test:unit           # inner loop: unit + contract + conformance(simulator); no Docker
pnpm test                # everything CI runs: the above + integration (needs Docker)
pnpm test:integration    # Vitest + Testcontainers, real Postgres (needs Docker)
pnpm --filter <pkg> test <file>        # one package or file; add -t "name" for one test
pnpm test:e2e            # Playwright against preview URL ($PREVIEW_URL)
pnpm test:docs           # run the quickstart snippets against $PREVIEW_URL
pnpm lint && pnpm typecheck
pnpm openapi             # regenerate openapi.json from routes (commit the result)
pnpm db:generate         # new migration from schema changes (review the SQL)
pnpm db:migrate:dev      # apply migrations to the current branch
```

Before calling a change done, run `pnpm test:unit`, lint and typecheck, plus `pnpm test:integration`
when you touched `packages/db` or a migration. CI adds `oasdiff`, Spectral, `squawk`, dependency
audit and secret scanning; nothing merges red. If a script here is missing, add it; do not
improvise.

## Never do these (stop and ask instead)

- Deploy, promote, roll back or change live infrastructure: no `wrangler deploy`, `wrangler versions
  deploy`, `wrangler secret` or `terraform apply`. Those run from CI after a human approval.
- Push to `main`, merge or approve a PR, or use an admin bypass. Open the PR and stop.
- Call a vendor cloud, the live Fluss backend or any real account, or send a command to a real
  device, from a session, a test or a CI job. Work runs on sandbox organisations, the simulator and
  recorded fixtures; the hardware bench is driven by its nightly job, not by you.
- Weaken a check to get green: no `.skip` or `.only`, no lowered coverage floor, no `eslint-disable`
  or `@ts-expect-error` without a reason and an issue, and no changes to `.github/`, `CODEOWNERS`,
  `lefthook.yml` or the `squawk`, `oasdiff` and `dependency-cruiser` configs unless asked.
- Put secrets, vendor credentials, phone numbers or anything from the vendor OpenAPI files into
  logs, errors, fixtures, tests, issues, PR text or commit messages. Never describe a vendor
  weakness anywhere in the repo (SPEC §22.3).
- Delete data, change a migration already applied to staging or production, touch billing, rotate
  keys or run a restore drill.
- Work around a block. If a permission rule or the guard hook (`.claude/hooks/guard.mjs`) stops a
  command, do not look for another way to run it: stop and ask.

## Rules

**Commands and safety**
- A command must never reach a device twice for one request. Idempotency keys and the per-device
  `DeviceCoordinator` Durable Object exist for this. Never call `provider.sendCommand` outside the
  DO. Never retry `sendCommand`; after an ambiguous send, verify, do not resend (SPEC §7.2).
- Coordinator state (in-flight command, hold state, next alarm) lives in Durable Object storage and
  verification is alarm-driven. Nothing held in memory may be needed after a deploy.
- `unconfirmed` (device heard us, gate did not move) is a distinct terminal state and is never
  reported as success. Do not collapse it into `unverified`.
- Every command response reports `verification_level` and a terminal `state`. Do not report
  `confirmed` without observed evidence. A device already in the target state is the one case with
  no provider call: `confirmed` with `evidence: already_in_state` (SPEC §7.1).
- A pulse cannot close every gate. `controls.pulse_mode` decides it: never offer `close` on an
  `open_only` device, and never let a hold pulse an `open_only` or `unknown` device (SPEC §4, §7).
- Never queue a command for later execution when the database or provider is down. Fail fast with
  `503`/`provider_unavailable`; a gate that opens ten minutes late is worse than a clear error.
- Emergencies (Phase 4, not before): a device with `egress: true` is never held closed, by any code
  path. Lockdown cannot start without a current egress review. Emergency commands bypass the minimum
  interval but never per-device serialisation. Outcomes report `unsupported`, `relies_on_autoclose`
  and `not_controlled` truthfully; never summarise a lockdown as "secured" when any device is in one
  of them.

**Data and tenancy**
- Every DB query is org-scoped through `packages/db` repositories. No raw SQL in routes. RLS is the
  second line: set the org context inside each transaction, never per session (SPEC §5).
- The API's Hyperdrive binding has query caching off. Never add a cached binding for auth, grants,
  devices or commands (SPEC §9).
- An event and its pending webhook deliveries are written in one transaction with the state change.
  Never enqueue a webhook straight from a handler (SPEC §8.2).
- Sandbox is a paired organisation: no `env` columns, no sandbox branches in queries (SPEC §1).
- Regions `za` and `us` are routing labels that both map to one `us-east-1` datastore today. Never
  hard-code a region or assume a single database (SPEC §9).
- Event lists page on `recorded_at`; `occurred_at` is device-reported data, never a cursor or a
  partition key (SPEC §4, §5). Lists run 5 s behind the clock (the settle window) so a cursor cannot
  pass an event that is still committing: list events only through `listEvents` with the injected
  clock, mint an event's id at its insert inside the transaction that writes it, and never reuse an
  id minted earlier.
- Grant validity has one implementation: `isGrantValidAt` in `packages/core`. `count_limited` uses
  are reserved at accept and committed or released at the terminal state; never check, then
  decrement later (SPEC §6).
- Provider users who are not the platform's subjects are masked unless the unit's owner consented
  (SPEC §14). Phone numbers are redacted in every log line: use the redaction helpers, and the
  `*.example` env files for configuration.
- Migrations are expand/contract, forward-only, and pass `squawk`. Never rename or drop a column in
  the same release that stops writing it. No table before its phase (SPEC §0).
- Any URL the system will call that a user supplied (webhooks, provider links) goes through the SSRF
  guard in `packages/core/http`. No exceptions.
- `dependency-cruiser` rules are law: routes → core → db; providers never import db. Cloudflare
  bindings are used only through the `Queue`, `Coordinator`, `Cache` and `RateLimiter` interfaces in
  `packages/core`. Do not build the Postgres-backed implementations; they are post-launch (SPEC
  §21.3).

**API contract**
- Add fields, never change or remove them inside `/v1`. If you think you must, open an ADR and bump
  to `/v2`; `oasdiff` will block you otherwise. Pagination is cursor-based everywhere, no offsets.
- Error codes (`code`) are contract; wording is not. Add new codes to `packages/core/src/errors.ts`
  and to `apps/docs/src/content/docs/errors/`. Rejections follow SPEC §7.3 (an error status means it
  did not happen); do not invent a status code or a second way to fail.

**Providers**
- A provider is built only from a written mapping in the spec (§12, §22, §23). No mapping, no code:
  stop and ask.
- New provider = new package implementing `Provider` (SPEC §10) + descriptor + README + recorded
  fixtures + a green conformance run. No bespoke endpoints for a vendor. Map vendor errors to
  `ProviderError` codes, keep raw vendor payloads in `detail`, and send all outbound HTTP through
  `packages/core/http`.
- Unofficial providers, once cleared: schema-validate every vendor response and raise
  `vendor_contract_drift` on anything unknown; call only what linking, discovery, status, commands
  and holds need (no app analytics, ratings or notification bookkeeping, no spoofed telemetry);
  never link an account without a recorded proof of control. CI runs them on recorded fixtures; the
  hardware canary runs nightly and before a release.

**Testing**
- Bug fix → failing test first. Feature → tests at every applicable layer (SPEC §11). Parsers and
  grant logic get fast-check property tests, not just examples.
- Coverage is a guide, reported on changed lines in the PR; the only hard floor is on
  `packages/core`, and it is not lowered to make a PR pass.
- Time-dependent logic uses the injected clock. Schedule tests cover `Africa/Johannesburg` (no DST),
  `America/New_York` and one southern-hemisphere DST zone such as `Australia/Sydney`.
- Integration tests run against a real Postgres (Testcontainers), not mocks of the DB.

**Docs and change management**
- Any behaviour change updates `SPEC.md` and the relevant guide in `apps/docs`. The reference and
  the changelog are generated (OpenAPI, release-please); don't hand-edit them.
- Decisions that change the stack, data model or API shape get an ADR in `docs/adr` (MADR template
  there); keep PLAN §3 in sync. Operational changes (new queue, cron or secret) update
  `docs/runbooks`.
- Anything durable you learn about this project goes into the repo (spec, ADR, runbook or this
  file), by PR. Nothing important lives only in a session or in memory.

**Working style**
- Every change traces to a GitHub issue: branch `feat|fix|chore/<issue>-slug`, Conventional Commits
  referencing it (`fix(api): reject stale grants (#123)`), `Closes #123` in the PR body. If
  something needs tracking, open an issue from the templates; tech debt gets the `tech-debt` label.
- Plan before editing (plan mode) when a change touches auth, tenancy or RLS, the command path,
  grants or a migration, and say which spec sections it implements.
- Small PRs, one concern each. Fill the PR template (summary, task link, how tested, risk level).
  Every PR gets a preview deploy and a Neon branch; link the preview smoke result in the PR
  description. Auth, billing, the command/emergency path and unofficial providers are CODEOWNERS
  paths: mark the PR high risk and leave the merge to a human.
- Prefer boring: standard library and WebCrypto over new dependencies. Adding a dependency needs a
  one-line justification in the PR.

## Definition of done

Acceptance criteria on the issue met · work belongs to the current phase · tests green at the right
layers · OpenAPI regenerated and committed · docs updated · Conventional Commit with task ID ·
preview smoke green · no new secrets in code · risk level stated · ADR if the decision was
structural.
