# Preview environments and Claude review

Covers `.github/workflows/preview.yml` (a preview per PR) and `.github/workflows/claude-review.yml`
(the Claude Code review check), both from issue #9.

## When to use it

- A PR's preview comment shows a failed step, or no preview comment appears.
- A preview secret or variable is rotated, or a new one is needed.
- Leftover preview Workers, KV namespaces or Neon branches (for example after a failed close job).
- The `Claude review` check fails, or Anthropic spend needs checking or changing.

## Impact

Previews hold no customer data and serve no customer. A broken preview blocks the preview smoke on
PRs and, once `Claude review` is a required check, a broken review blocks merges. Severity SEV4
(SPEC §21.6) unless a secret leaked, which is a key rotation incident.

## Preconditions

- Admin on the GitHub repository (Environments and variables), the non-production Cloudflare
  account, the Neon project `fluss-ctrl-nonprod`, and the Anthropic workspace that owns the key.
- Nothing here touches staging or production. Previews are created and deleted only by the
  workflow; by hand, only clean up leftovers (step 4).

## What it uses

`preview` GitHub Environment (any branch may deploy to it):

| Name | Kind | What it is |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | Non-production Cloudflare account token with **Workers Scripts: Edit** and **Workers KV Storage: Edit** on that account only |
| `CLOUDFLARE_ACCOUNT_ID` | variable | The non-production Cloudflare account id (the same account as staging) |
| `NEON_API_KEY` | secret | Neon API key that can create and delete branches in `fluss-ctrl-nonprod` (a project-scoped key if the plan allows) |
| `NEON_PROJECT_ID` | variable | The id of `fluss-ctrl-nonprod` |
| `NEON_DATABASE_NAME` | variable, optional | Only if the project has more than one database; otherwise the branch's only database is used, and its owner role runs the migrations |

Repository level:

| Name | Kind | What it is |
|---|---|---|
| `ANTHROPIC_API_KEY` | secret | Key for the Claude review action, in a workspace with a monthly spend limit |
| `CLAUDE_REVIEW_MAX_USD` | variable, optional | Per-run cap passed as `--max-budget-usd` (default `3`) |
| `CLAUDE_REVIEW_MODEL` | variable, optional | Model for the review (default `claude-sonnet-5-5`) |

The non-production Cloudflare account must have a workers.dev subdomain (Workers & Pages → your
subdomain); without one, the deploy step fails with "No workers.dev URL".

Per PR `<n>`, the workflow creates: Worker `fluss-ctrl-api-pr-<n>`, KV namespace
`fluss-ctrl-api-pr-<n>-cache`, Neon branch `preview/pr-<n>` (expires 14 days after creation). Neon's
free plan allows ten branches per project, so at most about eight PRs can have a preview at once.

## Steps

### 1. Read a failed preview

1. Open the run linked from the PR's "Preview" comment. Each row of the comment is one step. If
   the PR has no Preview comment, open Repository → Actions → Preview and filter by the PR's branch:
   - No run for the PR's latest push: check the workflow is enabled (Actions → Preview shows a
     "disabled" banner) and that you filtered by the PR's head branch. Only opening, pushing to,
     reopening and closing a PR start a run; edits to its title or labels do not.
   - A run whose deploy job was skipped: the PR is from a fork or Dependabot (no previews by
     design), or the run is the close event's run, which only removes the preview.
   - A run whose deploy job skipped every step after "Check the PR is still open": if that check
     passed and its log says "PR #<n> is closed", the PR had closed when the run started and this run
     created nothing (an earlier run's resources may still exist; step 4). If the check itself
     failed, read its log: it is the GitHub API call, so re-run the job.
2. **Check the preview configuration** failed: a secret or variable above is missing from the
   `preview` Environment. Add it (step 3).
3. **Neon branch and migrations** failed: a `401`/`403` is the key; "not ready" is Neon being slow
   (re-run the job); a migration error is the PR's own migration and is fixed in the PR. If the
   branch hit the branch limit, delete leftovers (step 4).
4. **Deploy the preview Worker** failed: read the Wrangler output in the log. Authentication errors
   are the token's permissions.
5. **Smoke /health** failed after a good deploy: the Worker refuses to serve on a bad config
   (SPEC §1). Its logs are in the Cloudflare dashboard under the Worker → Logs.
6. Re-run with **Re-run failed jobs**. Everything the job creates is found by name and reused, so a
   re-run never duplicates anything.

Check it worked: the PR comment shows every row passed and the URL answers `GET /health`.

### 2. Read a failed Claude review

1. Open the `Claude review` run. A review that found problems still passes; a failure means the
   review could not finish.
2. "budget" or "max turns" in the log: the run hit `CLAUDE_REVIEW_MAX_USD` or `--max-turns`. Raise
   the variable only if large PRs routinely need it; otherwise split the PR.
3. `401`, `403` or "credit balance": the key or the workspace limit (step 5).
4. Re-run with **Re-run failed jobs**.

### 3. Rotate or add a secret

1. Create the new token or key with the scope in the table above.
2. Repository → Settings → Environments → `preview` (or Secrets and variables → Actions for the
   repository-level ones) → update the value. Never paste it anywhere else.
3. Revoke the old one at the provider.
4. Check the workflow that uses the secret: for a `preview` secret, re-run the preview job on any
   open PR and check its comment shows every row passed; for `ANTHROPIC_API_KEY`, re-run the
   `Claude review` job on any open, non-draft PR and check it passed and posted its
   "Claude review:" comment.

### 4. Clean up leftovers

Closing a PR deletes its preview. If the close job failed, re-run it from the PR's last Preview run.
If that is impossible (for example the workflow file changed), delete by hand, by the names above:

1. Cloudflare (non-production account) → Workers & Pages → `fluss-ctrl-api-pr-<n>` → Settings →
   Delete. Then Storage & Databases → KV → `fluss-ctrl-api-pr-<n>-cache` → Delete.
2. Neon → `fluss-ctrl-nonprod` → Branches → `preview/pr-<n>` → Delete.

Only delete names that match a **closed** PR, unless you are stopping previews entirely
(Rollback). Never delete the Neon project's default branch.

### 5. Claude review spend

Three limits apply, from the inside out:

1. `--max-budget-usd` per run (`CLAUDE_REVIEW_MAX_USD`, default 3 dollars).
2. `--max-turns 40` and a 20-minute job timeout.
3. The monthly spend limit on the Anthropic workspace that owns `ANTHROPIC_API_KEY`
   (console.anthropic.com → Settings → Limits). This is the hard cap; set it before relying on the
   check. When it is reached, every review fails until next month or until it is raised.

Drafts, fork PRs and Dependabot PRs skip the review, and a push cancels the run for the previous
head, so spend follows the number of ready-for-review pushes.

## Rollback

- A bad workflow change: revert the PR that made it. Existing previews keep running until their PRs
  close.
- To stop previews entirely without a PR: Repository → Actions → Preview → Disable workflow. Closed
  PRs' leftovers are cleaned up by step 4. Previews of PRs that are still open keep running until
  those PRs close, and with the workflow disabled their close job will not run, so delete them by
  hand with the same steps as step 4, by name, once you have decided to stop them (they hold no
  customer data). Re-enabling the workflow and pushing to an open PR recreates its preview.
- Claude review: Repository → Actions → Claude review → Disable workflow. If it is a required
  check, remove it from the ruleset first or every PR blocks.

## Afterwards

Nothing to record for a routine failure. A leaked secret is a key rotation: rotate (step 3), then
open an incident and a postmortem ([`../postmortem-template.md`](../postmortem-template.md)).
