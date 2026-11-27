output "cloudflare_name_servers" {
  description = "Nameservers set at the registrar in normal operation."
  value       = cloudflare_zone.primary.name_servers
}

output "route53_name_servers" {
  description = "Nameservers to set at the registrar during a Cloudflare DNS outage (docs/runbooks/dns-switch.md)."
  value       = aws_route53_zone.secondary.name_servers
}

output "route53_zone_id" {
  description = "Route 53 hosted zone id of the secondary."
  value       = aws_route53_zone.secondary.zone_id
}
