provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  api_host_expr = format("lower(http.host) eq \"%s\"", lower(var.api_hostname))
}

resource "cloudflare_dns_record" "api" {
  count   = var.manage_api_dns_record ? 1 : 0
  zone_id = var.zone_id
  name    = var.api_hostname
  type    = var.api_record_type
  content = var.api_record_content
  ttl     = var.api_record_ttl
  proxied = var.api_record_proxied
}

resource "cloudflare_ruleset" "api_cache_rules" {
  zone_id     = var.zone_id
  name        = "Proyekto API Cache Rules"
  description = "Cache-first rules for public API routes with strict bypass for private/auth traffic."
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules = [
    # 1) Never cache mutating traffic.
    {
      ref         = "bypass_non_get_head"
      description = "Bypass cache for non-GET/HEAD requests on API hostname."
      expression  = format("(%s and http.request.method ne \"GET\" and http.request.method ne \"HEAD\")", local.api_host_expr)
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    },
    # 2) Never cache authenticated/sessionized requests.
    {
      ref         = "bypass_authorization_or_cookie"
      description = "Bypass cache whenever Authorization/Cookie headers are present."
      expression  = format("(%s and (has_key(http.request.headers, \"authorization\") or has_key(http.request.headers, \"cookie\")))", local.api_host_expr)
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    },
    # 3) Never cache sensitive API paths.
    {
      ref         = "bypass_sensitive_paths"
      description = "Bypass cache for auth, guest, and share-token routes."
      expression  = format("(%s and (starts_with(http.request.uri.path, \"/api/auth\") or starts_with(http.request.uri.path, \"/api/guests\") or starts_with(http.request.uri.path, \"/api/roadmap-shares/token\")))", local.api_host_expr)
      action      = "set_cache_settings"
      action_parameters = {
        cache = false
      }
    },
    # 4) Cache consultants listing/profile reads; origin headers control TTL.
    {
      ref         = "cache_consultants_public_get"
      description = "Eligible for cache: /api/consultants*"
      expression  = format("(%s and (http.request.method eq \"GET\" or http.request.method eq \"HEAD\") and not has_key(http.request.headers, \"authorization\") and not has_key(http.request.headers, \"cookie\") and starts_with(http.request.uri.path, \"/api/consultants\"))", local.api_host_expr)
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode = "respect_origin"
        }
        browser_ttl = {
          mode = "respect_origin"
        }
        respect_strong_etags = true
      }
    },
    # 5) Cache public roadmap template reads; origin headers control TTL.
    {
      ref         = "cache_public_roadmap_templates_get"
      description = "Eligible for cache: /api/roadmaps/templates/public"
      expression  = format("(%s and (http.request.method eq \"GET\" or http.request.method eq \"HEAD\") and not has_key(http.request.headers, \"authorization\") and not has_key(http.request.headers, \"cookie\") and http.request.uri.path eq \"/api/roadmaps/templates/public\")", local.api_host_expr)
      action      = "set_cache_settings"
      action_parameters = {
        cache = true
        edge_ttl = {
          mode = "respect_origin"
        }
        browser_ttl = {
          mode = "respect_origin"
        }
        respect_strong_etags = true
      }
    }
  ]
}
