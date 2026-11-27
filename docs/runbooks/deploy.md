# Deploy the API

How an API release reaches staging and production, and what to do when a rollout fails
(SPEC §16 "Environments", PLAN §8 "Release"; `.github/workflows/deploy.yml`,
`scripts/deploy-worker.mjs`).

## When to use it

- A release PR from release-please was merged and the **Deploy API** run needs your approval.
- A deploy run failed, rolled back, or stopped on a traffic split.
- A release adds a Durable Object migration.
- First-time setup of an environment (below).

## Impact

A failed staging deploy blocks the release and nothing else. A failed production canary affects
about 10% of API requests for the length of the smoke (about a minute at most) before the rollback.
A rollback that itself fails leaves production on whatever split the last step set: declare an
incident (SPEC §21.6).

## Preconditions

Everything below runs from GitHub Actions. Never run `wrangler deploy`, `wrangler versions deploy`,
`wrangler rollback` or `wrangler secret` from a laptop or an agent session (CLAUDE.md); a hand
run on a laptop is only for the one-time resource creation in "First-time setup", by Thomas.

## How a release deploys

1. Merging the release-please PR tags `api-vX.Y.Z`. release-please then dispatches **Deploy API** at
   that tag (a tag made with the automatic token cannot start a tag-push workflow by itself). A tag
   pushed by hand starts it too.
2. **Staging** job, in the `staging` Environment: render `infra/wrangler/staging.jsonc`, check that
   Hyperdrive query caching is off, run `pnpm db:migrate`, upload the version, send it 100% and
   smoke-test `/health`. A failed smoke puts the previous version back.
3. **Production** job waits for the `production` Environment reviewer. Approve it in the run page.
   Same steps, but the new version first gets 10% and is smoke-tested by version id (header
   `Cloudflare-Workers-Version-Overrides`), then 100% and smoke again. Any failed smoke puts the
   previous version back at 100% and fails the job.
   A smoke counts only when `/health` answers `ok` **and** its `version` is the new version id, so
   an answer from the old version (a location the change has not reached) never passes it. Each
   attempt times out after 10 s; after 18 attempts (about 2.5 minutes) the smoke has failed.
4. Check: the run summary shows "serves 100%", and `curl -s https://api.flussctrl.com/health`
   answers `{"status":"ok","version":"<the new version id>"}`.

## A rollout failed

1. Read the failing step's log. It names the version that failed and the version restored.
2. If it says "Rolled back to …", production is on the previous version. Fix forward with a new
   release; do not re-run the failed tag unchanged.
3. If it says "No previous version to roll back to", this was the first deploy of the Worker.
   Nothing older exists; fix forward.
4. If the rollback step itself failed, a traffic split may be left. Restore the last good version
   (below), then record what you did in the incident.

## Restore a version (failed rollback or a stuck split)

Production changes only through the workflow and its approval, including in recovery.

1. Find the version id to restore: the failed run's log names the version it rolled back to or
   from ("Serving now: …"), or read-only, the Cloudflare dashboard (Workers & Pages → the Worker →
   Deployments) lists the versions and their traffic.
2. Run **Deploy API** by hand: "Use workflow from" = any `api-v*` tag (the Environments allow only
   those), **restore_version** = that id, **restore_environment** = production or staging.
3. Approve the `production` Environment when asked. The job deploys that version at 100% and
   smoke-tests that `/health` answers from it. It skips the release deploy entirely.
4. If its smoke fails, declare an incident (SPEC §21.6).

## "The current deployment is not one version at 100%"

An earlier run stopped part-way through a rollout. Decide which version should serve, restore it
(above), then re-run the failed release.

## A release adds a Durable Object migration

`wrangler versions upload` cannot apply a Durable Object migration (it fails saying so). Gradual
rollout is not possible for that release:

1. Start **Deploy API** by hand on the release tag with **full_deploy** ticked. Both jobs then use
   `wrangler deploy` (100% at once), then smoke.
2. A rollback after a migration may be refused by Cloudflare. Prefer fixing forward.

The first deploy of each Worker takes this path automatically (it creates the classes from
migration `v1`).

## Rolling back on purpose

Start **Deploy API** by hand on the last good `api-v*` tag. Migrations are expand-only (SPEC §5), so
the older code runs on the newer schema; `db:migrate` finds nothing to do.

## First-time setup (per environment, Thomas)

Staging lives in the non-production Cloudflare account, production in the production account.

1. KV namespace for the `CACHE` binding:
   `wrangler kv namespace create fluss-ctrl-<env>-cache`. Save the id as the Environment variable
   `KV_CACHE_ID`.
2. Hyperdrive config, **caching disabled** (SPEC §9), pointing at the Hyperdrive login role from
   `database.md` ("Provision the roles"), not the owner role:
   `wrangler hyperdrive create fluss-ctrl-<env> --connection-string="<from the secret store>" --caching-disabled`.
   Save the id as `HYPERDRIVE_ID`. Never enable caching on it: the deploy stops if it is on.
3. Environment variables: `CLOUDFLARE_ACCOUNT_ID`, `KV_CACHE_ID`, `HYPERDRIVE_ID`, and
   `API_BASE_URL` (production `https://api.flussctrl.com`; staging the Worker's `workers.dev` URL,
   `https://fluss-ctrl-api-staging.<account subdomain>.workers.dev`).
4. Environment secrets: `DATABASE_URL` (owner role, direct connection, for migrations) and
   `CLOUDFLARE_API_TOKEN` scoped to that account with: Workers Scripts Edit, Workers KV Storage
   Read, Hyperdrive Read, Account Settings Read; production also Workers Routes Edit and DNS Edit on
   the `flussctrl.com` zone (for the `api.flussctrl.com` custom domain).

### Hyperdrive

If the deploy stops with "query caching is ON", switch it off on that config (dashboard: Hyperdrive →
the config → Settings → Caching → Disable), then re-run the job. Do not create a second binding to
work around it.

## Afterwards

A production rollback or a failed rollback: tell the bypass-log reviewer, open a postmortem action if
customers saw errors ([`../postmortem-template.md`](../postmortem-template.md)).
