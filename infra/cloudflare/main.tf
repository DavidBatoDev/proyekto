provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

locals {
  api_host_expr  = format("lower(http.host) eq \"%s\"", lower(var.api_hostname))
  apex_host_expr = format("lower(http.host) eq \"%s\"", lower(var.apex_hostname))
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

# Apex -> www redirect.
#
# Until the web cutover this redirect was emitted by VERCEL, not Cloudflare
# (verified: the 308 response carried an `x-vercel-id` header). Once Vercel is
# decommissioned it would simply vanish and the bare apex would break, so it has
# to be reproduced at the edge. Running it as a Cloudflare redirect rule also
# means apex traffic is answered at the edge and never reaches an origin at all.
#
# 308 (not 307) reproduces the exact status Vercel served. It is PERMANENT and
# browser-cached, so a wrong value here sticks with returning visitors - see
# var.apex_redirect_status_code before changing it.
resource "cloudflare_ruleset" "apex_redirect" {
  zone_id     = var.zone_id
  name        = "Proyekto Apex Redirect"
  description = "Redirect the bare apex to the canonical www host, preserving path and query."
  kind        = "zone"
  phase       = "http_request_dynamic_redirect"

  rules = [
    {
      ref         = "apex_to_www"
      description = format("%s/* -> https://%s/* (preserves path + query).", var.apex_hostname, var.web_hostname)
      expression  = format("(%s)", local.apex_host_expr)
      action      = "redirect"
      action_parameters = {
        from_value = {
          status_code = var.apex_redirect_status_code
          target_url = {
            # Path is concatenated; the query string rides along via
            # preserve_query_string rather than being rebuilt here.
            expression = format("concat(\"https://%s\", http.request.uri.path)", var.web_hostname)
          }
          preserve_query_string = true
        }
      }
    }
  ]
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
