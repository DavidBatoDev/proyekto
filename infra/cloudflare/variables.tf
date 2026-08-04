variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone:Read, DNS:Edit, and Cache Rules:Edit permissions."
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "Cloudflare zone identifier for proyekto.tech."
  type        = string
}

variable "api_hostname" {
  description = "Public API hostname served through Cloudflare."
  type        = string
  default     = "api.proyekto.tech"
}

variable "apex_hostname" {
  description = "Bare apex hostname. Redirect-only - nothing is ever served from it."
  type        = string
  default     = "proyekto.tech"
}

variable "web_hostname" {
  description = "Canonical hostname serving the web SPA. The apex redirects here."
  type        = string
  default     = "www.proyekto.tech"
}

variable "apex_redirect_status_code" {
  description = "Status code for the apex->www redirect. 308 matches the behaviour Vercel served before the Cloudflare cutover; it is permanent and browser-cached, so change it deliberately."
  type        = number
  default     = 308
}

variable "manage_api_dns_record" {
  description = "Whether Terraform should manage the API DNS record. Keep false when records already exist in Cloudflare."
  type        = bool
  default     = false
}

variable "api_record_type" {
  description = "DNS record type for API hostname."
  type        = string
  default     = "CNAME"
}

variable "api_record_content" {
  description = "Origin target for API DNS record."
  type        = string
  default     = "ghs.googlehosted.com"
}

variable "api_record_ttl" {
  description = "TTL for API DNS record. Use 1 for Auto in Cloudflare."
  type        = number
  default     = 1
}

variable "api_record_proxied" {
  description = "Whether Cloudflare proxy (orange cloud) is enabled for the API record."
  type        = bool
  default     = true
}
