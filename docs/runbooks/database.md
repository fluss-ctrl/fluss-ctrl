# Database: roles and partitions

## When to use it

- Provisioning a database (a new Neon branch or project, or the `za` datastore, SPEC §9).
- An alert or query shows rows landing in `events_default` or `webhook_deliveries_default`.
- Before the last monthly partition runs out (0001 creates partitions up to January 2028).

## Impact

Roles wrong: the API cannot connect, or (worse) connects as the table owner. Partitions missing:
rows land in the default partition, which still works but stops pruning, and a monthly partition
for that range can no longer be created until those rows move. Severity per SPEC §21.6.

## Preconditions

Production and staging changes run from CI after a human approval, never from a laptop or an agent
session (CLAUDE.md). Migrations run as the owner role over a direct connection, never through
Hyperdrive (SPEC §5).

## Steps

### Provision the roles

1. The owner role (Neon's project owner, or a role with CREATEROLE) runs the migrations. They
   create `fluss_app` (NOLOGIN, no BYPASSRLS) if it is missing.
2. Create the login role Hyperdrive uses and make it a member of `fluss_app` only:
   `CREATE ROLE <login> LOGIN PASSWORD '<from the secret store>' IN ROLE fluss_app;`
   Check: `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = '<login>';` is `f, f`.
3. Point the Hyperdrive binding (query caching off, SPEC §9) at that login role.

### Keep partitions ahead

1. Create the next months: `SELECT create_month_partitions('events', '<first day>', 3);` and the
   same for `webhook_deliveries`. It skips months that exist.
2. Check: `SELECT count(*) FROM events_default;` is 0. If not, the rows must be moved (detach the
   default partition, create the month, re-insert) before the month can be created: write that
   procedure the first time it happens.

A scheduled job to run step 1 monthly arrives with its own issue; until then this is a calendar
reminder well before January 2028.

## Rollback

Roles: `REVOKE fluss_app FROM <login>;` stops the API. Partitions: an empty partition can be
dropped; never drop one with rows.

## Afterwards

Record provisioning in the release issue.
