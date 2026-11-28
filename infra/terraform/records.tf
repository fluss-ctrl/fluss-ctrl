# Records that must answer the same from either provider, defined once and written to both zones.
#
# Belongs here: records that do not depend on Cloudflare (mail, verification TXT, the status page on
# OpenStatus from Phase 2, and the break-glass targets once the post-launch break-glass deploy
# exists, SPEC §21.3).
#
# Does not belong here: Worker custom domains (api.flussctrl.com, later docs. and console.).
# Wrangler creates and owns those records in Cloudflare (infra/wrangler), and they point at
# Cloudflare itself, so a copy in Route 53 would not help during a Cloudflare outage.
#
# A record that already exists in Cloudflare must be imported in the same PR that adds it here, or
# the apply fails on a duplicate: an `import` block for `cloudflare_dns_record.mirrored["<key>"]`
# with the id "<zone id>/<record id>".
#
# Keys are stable names, not hostnames, so renaming a host does not replace the record. `name` is
# relative to the zone ("@" for the apex). For MX, `content` is the mail host and `priority` is set.
locals {
  mirrored_records = {
    # spf = { name = "@", type = "TXT", ttl = 300, content = "v=spf1 -all" }
  }

  # Route 53 holds every value of one name and type in a single record set, so entries that share
  # them (two MX hosts, several TXT values) are grouped into one aws_route53_record.
  route53_record_sets = {
    for k, v in local.mirrored_records : "${v.name}/${v.type}" => v...
  }
}

resource "cloudflare_dns_record" "mirrored" {
  for_each = local.mirrored_records

  zone_id  = cloudflare_zone.primary.id
  name     = each.value.name == "@" ? local.domain : "${each.value.name}.${local.domain}"
  type     = each.value.type
  ttl      = each.value.ttl
  content  = each.value.content
  priority = try(each.value.priority, null)
  # Never proxied: the same answer has to come from Route 53, which cannot proxy.
  proxied = false
  comment = "Managed by infra/terraform; mirrored in Route 53."
}

resource "aws_route53_record" "mirrored" {
  for_each = local.route53_record_sets

  zone_id = aws_route53_zone.secondary.zone_id
  name    = each.value[0].name == "@" ? local.domain : "${each.value[0].name}.${local.domain}"
  type    = each.value[0].type
  ttl     = each.value[0].ttl
  # Route 53 takes the MX priority inside the value. TXT values go in unquoted: the provider adds
  # the quotes.
  records = [
    for r in each.value : r.type == "MX" ? "${r.priority} ${r.content}" : r.content
  ]

  lifecycle {
    precondition {
      condition     = length(distinct([for r in each.value : r.ttl])) == 1
      error_message = "Records sharing a name and type (${each.key}) must share one TTL: Route 53 keeps them in one record set."
    }
  }
}
