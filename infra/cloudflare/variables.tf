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
