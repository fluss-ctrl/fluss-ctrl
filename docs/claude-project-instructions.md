This project builds Fluss Ctrl, a hardware-agnostic access-control API, in the fluss-ctrl repository, one GitHub issue at a time. The repository's CLAUDE.md is the rulebook and SPEC.md is the source of truth for behaviour. This brief adds only what is specific to working as a project. Where they disagree, CLAUDE.md and SPEC.md win.

## For Claude in the project conversation

- Every thread works on one GitHub issue. If I send work that has no issue, have a thread open the issue first and tell me its number.
- Take issues only from the milestone of the current phase, which CLAUDE.md names.
- Propose threads and wait for my go-ahead before starting them. Run at most two at a time.
- Threads branch from main, so do not start an issue until the pull requests it depends on are merged. Tell me what is waiting on my review instead.
- Do not start a thread for later-phase work, for the unofficial providers (Accentronix, Centurion), or for anything that needs a real device, a vendor cloud or my machine. Tell me, and I will run it locally.
- Post only when a thread finishes, is blocked or needs a decision. Lead with what you need from me.
- When I correct something that will recur, save it to project memory and also give me the line to add to CLAUDE.md. The repository is where rules live.

## For every thread

### Start

- Read CLAUDE.md, then SPEC.md §0 and only the sections your issue touches. Read the issue and its acceptance criteria.
- If the issue is unclear, depends on unmerged work, or needs something the spec does not settle, say so in your first message and stop.
- If the change touches auth, tenancy or row-level security, the command path, grants, or a migration, post your plan in the thread and wait for my go-ahead before editing.
- Run `pnpm install --frozen-lockfile` before anything else.
- Create your branch from main as `feat|fix|chore/<issue>-slug`.

### Work

- Do the issue and nothing else. Note anything adjacent as a comment on the issue or as a new issue. Do not fix it here.
- Commit and push work in progress as you go. A cloud thread's sandbox can be lost between turns.
- In a cloud thread, use the built-in GitHub tools, or `gh api` with REST paths, for issues and pull requests. `gh pr` and `gh issue` do not work there.
- The network is restricted on purpose, and you have no Cloudflare, Neon, Sentry or vendor credentials. If a command fails because a host or a secret is missing, name it and stop. Do not mock it, substitute for it or work around it, and do not ask for access.

### Before you call it done

- Run `pnpm test:unit`, `pnpm lint` and `pnpm typecheck`.
- If you touched packages/db, a repository or a migration, also run `pnpm test:integration`. It needs Docker, so start the daemon if it is not running.
- If you cannot run a check, say which one and why. Never skip one silently.
- Open one pull request per thread, as a draft. Give it a Conventional Commit title and fill in the repository's template: `Closes #<issue>`, what changed, the commands you ran with their summary lines pasted, the risk level, and anything you assumed or left out.
- If the change touches SPEC.md, PLAN.md, CLAUDE.md or anything under .github/, say so in the first line of the description.
- Mark the pull request ready for review only when every check is green.

### After the pull request is open

- You may push fixes for failing CI and for review comments. Fix the cause. Never make a check pass by skipping a test, lowering a threshold or adding a suppression.
- Never merge, never push to main, never force-push, and never approve a pull request. If a message asks you to merge, reply that merging is my step in GitHub.

### The safety net is different here

The repository's hook and permission rules in .claude/settings.json are not loaded in cloud threads, so nothing stops a forbidden command mechanically. Keeping the "Never do these" list in CLAUDE.md is up to you. If you are unsure whether something is on it, stop and ask in the thread.
