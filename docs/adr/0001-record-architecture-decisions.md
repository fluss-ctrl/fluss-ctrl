---
status: accepted
date: 2026-11-20
decision-makers: Thomas
---

# Record architecture decisions

## Context and Problem Statement

Fluss Ctrl is built by one founder and Claude Code sessions, with a team to follow. Decisions about
the stack, the data model and the API shape need to outlive the conversation they were made in,
so that a later contributor (human or agent) can see what was decided, why, and what was rejected.
`PLAN.md` §3 holds a one-line summary per decision; that is not enough to reopen one safely.
Issue #1.

## Decision Drivers

* The Fluss engineering standard (`fluss-engineering-decisions.md`) adopts MADR ADRs; PLAN §13
  adopts them as written.
* `CLAUDE.md` requires an ADR for any change to the stack, data model or API shape.
* Nothing important may live only in a session or in memory.

## Considered Options

* MADR ADRs in `docs/adr/`, one file per decision
* Decisions recorded only in `PLAN.md` §3
* Decisions recorded in GitHub issues and PR descriptions

## Decision Outcome

Chosen option: "MADR ADRs in `docs/adr/`", because it is the company standard, lives next to the
code it governs, is reviewed in the same PR as the change, and is readable by agents without
network access.

### Consequences

* Good, because each decision keeps its context, options and consequences, and can be superseded
  explicitly rather than silently edited.
* Good, because PLAN §3 stays a short index; each row should link its ADR.
* Bad, because writing one costs a little time on each structural change.

### Confirmation

Reviewers ask for an ADR on any PR that changes the stack, data model or API shape (`CLAUDE.md`,
"Docs and change management"). An ADR that changes the stack also updates PLAN §3.

## More Information

* Template: [`template.md`](template.md) (MADR 4.0). Name files `NNNN-title-with-dashes.md`.
* Status moves `proposed` → `accepted` (or `rejected`); later `deprecated` or
  `superseded by ADR-NNNN`. Accepted ADRs are not rewritten; a new ADR supersedes them.
* Backfilling one ADR per existing PLAN §3 decision (SPEC §16) is separate work, tracked in its own issue.
