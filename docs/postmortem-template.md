# Postmortem: {short title}

<!-- Blameless: describe systems and decisions, not people's failings. Copy to
     docs/postmortems/YYYY-MM-DD-short-title.md. Every action becomes a tracked GitHub issue. -->

| | |
|---|---|
| **Date** | {YYYY-MM-DD} |
| **Severity** | {SEV1 / SEV2 / SEV3} (SPEC §21.6) |
| **Duration** | {detected → resolved, with times in UTC} |
| **Authors** | {names} |
| **Status** | {draft / reviewed / actions complete} |

## Summary

{Two or three sentences: what happened, who was affected, how it was resolved.}

## Impact

- Customers and organisations affected: {count, regions}
- Commands affected: {failed, delayed, `unconfirmed`}; were any gates left in an unexpected state?
- Webhooks delayed or lost: {count}
- SLA / error budget consumed: {minutes}

## Timeline (UTC)

| Time | Event |
|------|-------|
| {hh:mm} | {first signal, alert or report} |
| {hh:mm} | {detection, who was paged} |
| {hh:mm} | {key decisions and actions} |
| {hh:mm} | {mitigated} |
| {hh:mm} | {resolved} |

## Root cause

{What failed, and the conditions that let it. Ask "why" until you reach something a change can fix.}

## Detection

{How we found out. Did monitoring catch it before a customer did? How could we have known sooner?}

## Response

{What went well, what was hard, which runbook was used and whether it was right.}

## Actions

| Action | Type (prevent / detect / mitigate / process) | Owner | Issue |
|--------|------------------------------------------------|-------|-------|
| {action} | {type} | {owner} | #{n} |

## Lessons

{What we learned that is not captured as an action.}
