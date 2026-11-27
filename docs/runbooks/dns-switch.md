# DNS: Terraform changes and the nameserver switch

`flussctrl.com` has its primary DNS in the production Cloudflare account and a pre-provisioned
secondary zone in Route 53 in the AWS DNS account (SPEC §21.3; `infra/terraform`). The registrar is
Route 53 Domains in a separate AWS account, outside Cloudflare.

## When to use it

- Changing a DNS record (normal change).
- Cloudflare DNS is down or unreachable for `flussctrl.com` and it is not recovering (switch).
- Cloudflare is back (switch back).

## Impact

DNS down means every `flussctrl.com` name fails to resolve once resolver caches expire. Note what a
switch does **not** fix: Worker hosts (`api.`, later `docs.` and `console.`) run on Cloudflare, so
they stay down until Cloudflare compute recovers or the post-launch break-glass deploy exists. The
switch keeps mail, verification records and the status page answering. Severity per SPEC §21.6.

## Preconditions

- Record changes go through a PR to `infra/terraform` and the **Terraform (DNS)** workflow: the PR
  shows the plan, the apply runs on `main` after the `production` Environment approval. Never run
  `terraform apply` from a laptop or a session.
- The switch needs the registrar account (break-glass account, hardware key, SPEC §21.4).

## Change a record

1. Add it to `mirrored_records` in `infra/terraform/records.tf` (both zones get it) unless it is a
   Worker custom domain, which Wrangler owns. If the record already exists in Cloudflare, add an
   `import` block in the same PR (see the comment in `records.tf`).
2. Open the PR; read the plan in the **terraform plan** job summary.
3. After merge, approve **terraform apply** in the run page. Check the apply summary.

## Switch nameservers to Route 53

1. Confirm it is DNS, not compute: `dig +noall +authority NS flussctrl.com @a.gtld-servers.net`
   lists the Cloudflare nameservers (the parent answers with a referral, so they are in the
   AUTHORITY section), and `dig flussctrl.com SOA @<a Cloudflare nameserver>` times out or fails
   from two networks. Check the Cloudflare status page.
2. Get the Route 53 nameservers: the last **terraform apply** run summary ("Nameservers"), or the
   hosted zone in the AWS DNS account console.
3. Check the secondary is answering and current:
   `dig flussctrl.com SOA @<a Route 53 nameserver>` answers, and each record in `records.tf` answers
   the same there.
4. DNSSEC: check `dig +noall +answer DS flussctrl.com @a.gtld-servers.net`. If it returns DS
   records (Cloudflare's key), validating resolvers would reject Route 53's unsigned answers, so:
   remove them at the registrar (Route 53 Domains → the domain → DNSSEC keys); repeat the `dig`
   until the parent returns no DS; then wait out the old DS TTL (shown in that `dig` before removal,
   usually 86400 s for `.com`) before step 5. If the outage cannot wait that long, accept that
   validating resolvers fail until it passes, and say so in the incident.
5. In the registrar account: Route 53 Domains → `flussctrl.com` → Edit name servers → replace them
   with the four Route 53 nameservers.
6. Check: `dig +noall +authority NS flussctrl.com @a.gtld-servers.net` lists the Route 53 set
   (minutes).

TTL guidance: the `.com` delegation is cached for up to 48 hours (NS TTL 172800), so some resolvers
keep asking Cloudflare for up to two days. Record TTLs in `records.tf` stay at 300 s or less so a
change during the incident spreads quickly.

## Rollback (switch back)

When Cloudflare DNS has been healthy for an hour:

1. Set the registrar's nameservers back to the Cloudflare set (`cloudflare_name_servers` in the apply
   summary). Check with `dig` as in step 6.
2. Keep DNSSEC off for now. Resolvers may still hold the Route 53 delegation for up to 48 hours, and
   a DS for Cloudflare's key would make those Route 53 answers fail validation.
3. After the 48-hour delegation TTL has passed, and only if DNSSEC was in use before: confirm
   Cloudflare is signing (`dig +dnssec flussctrl.com SOA @<a Cloudflare nameserver>` shows RRSIG),
   then add Cloudflare's DS back at the registrar.
4. Keep both zones; the Route 53 secondary stays pre-provisioned for the next time.

## Afterwards

Record the switch and its timing in the incident; a postmortem is due
([`../postmortem-template.md`](../postmortem-template.md)). If any record was changed in only one
zone during the incident, bring `records.tf` back in line by PR.
