output "api_hostname" {
  value = var.api_hostname
}

output "api_dns_record_id" {
  value = try(cloudflare_dns_record.api[0].id, null)
}

output "api_cache_ruleset_id" {
  value = cloudflare_ruleset.api_cache_rules.id
}
