# infra/terraform

DNS for `flussctrl.com` (SPEC §16, §21.3; #10):

- `cloudflare_zone.primary`: the existing zone in the production Cloudflare account, imported.
- `aws_route53_zone.secondary`: the Route 53 secondary in the AWS DNS account, pre-provisioned so a
  nameserver switch is a registrar change, not a build (`docs/runbooks/dns-switch.md`).
- `records.tf`: records written to both zones from one definition.

Neon projects (SPEC §16) are not here yet; they follow in their own issue.

## How it runs

Only from CI (`.github/workflows/terraform.yml`), never from a laptop or a session:

| When | Steps | Environment | AWS role | Cloudflare token |
|---|---|---|---|---|
| PR touching `infra/terraform/**` | `fmt`, `validate`, `plan` (no lock) | `preview` | `AWS_TF_PLAN_ROLE_ARN` | `CLOUDFLARE_DNS_API_TOKEN` (read) |
| Push to `main` touching it, or a manual run on `main` | `plan`, then `apply` of that plan | `production` (reviewer) | `AWS_TF_APPLY_ROLE_ARN` | `CLOUDFLARE_DNS_API_TOKEN` (write) |

Inputs (repository variables, none secret): `TF_STATE_BUCKET`, `TF_STATE_REGION`,
`CLOUDFLARE_DNS_ACCOUNT_ID` (the production Cloudflare account's id) and `CLOUDFLARE_ZONE_ID`.

AWS access is GitHub OIDC. The fluss-ctrl org issues tokens with the ID-pinned subject format,
so every role trust (and any OIDC role Terraform creates later) must match
`repo:fluss-ctrl@361904361/fluss-ctrl@1465269542:environment:<environment>`, with audience
`sts.amazonaws.com`. A trust written as `repo:fluss-ctrl/fluss-ctrl:...` is refused with
`Not authorized to perform sts:AssumeRoleWithWebIdentity`.

## Working on it

`fmt` and `validate` need no credentials:

```
cd infra/terraform
terraform init -backend=false
terraform fmt -check -recursive && terraform validate
```

Do not run `plan` or `apply` with real credentials outside CI (CLAUDE.md, "Never do these").
There is no `.terraform.lock.hcl` yet: the first CI `init` resolves the providers within the
constraints in `versions.tf`; commit the lock file it produces in a follow-up.
