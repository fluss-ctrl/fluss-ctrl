locals {
  domain = "flussctrl.com"
}

# The primary zone already exists in the production Cloudflare account (created by hand under #16),
# so it is imported, not created. After the first apply this block is a no-op; leave it in.
import {
  to = cloudflare_zone.primary
  id = var.cloudflare_zone_id
}

resource "cloudflare_zone" "primary" {
  account = {
    id = var.cloudflare_account_id
  }
  name = local.domain
  type = "full"

  lifecycle {
    prevent_destroy = true
  }
}

# Pre-provisioned secondary (SPEC §21.3). Route 53 cannot transfer a zone from Cloudflare, so this
# is a second authoritative copy of the records in records.tf, kept in step by Terraform. It
# answers nothing until the registrar's nameservers are switched to it (docs/runbooks/dns-switch.md).
resource "aws_route53_zone" "secondary" {
  name          = local.domain
  comment       = "Secondary DNS for ${local.domain}; used only after a nameserver switch (docs/runbooks/dns-switch.md)."
  force_destroy = false

  lifecycle {
    prevent_destroy = true
  }
}
