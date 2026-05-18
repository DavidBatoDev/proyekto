# Cloudflare Free Edge Setup (API)

This Terraform package configures `api.proyekto.tech` behind Cloudflare and applies cache rules aligned with our cache-first API policy.

## What this manages

- Proxied API DNS record (`api.proyekto.tech`)
- A single Cache Rules ruleset (`http_request_cache_settings`) with 5 rules:
  1. Bypass non-`GET/HEAD`
  2. Bypass when `Authorization` or `Cookie` exists
  3. Bypass sensitive paths:
     - `/api/auth*`
     - `/api/guests*`
     - `/api/roadmap-shares/token*`
  4. Cache-eligible allowlist: `/api/consultants*`
  5. Cache-eligible allowlist: `/api/roadmaps/templates/public`

TTL remains origin-driven (`Cache-Control`/`s-maxage` from backend).

By default, this stack only manages cache rules. Set `manage_api_dns_record = true` only if you want Terraform to create/manage the API DNS record itself.

## Prerequisites

- Cloudflare zone already created for `proyekto.tech`
- Full setup migration completed (authoritative nameservers switched at registrar)
- Terraform >= 1.5

## Required token scopes

Create a Cloudflare API token with zone-scoped permissions:

- `Zone:Read`
- `DNS:Edit`
- `Cache Rules:Edit`

## Usage

1. Copy and edit example variables:

```bash
cp terraform.tfvars.example terraform.tfvars
```

2. Set token in your current shell (recommended: environment variable only, not files):

```bash
export TF_VAR_cloudflare_api_token="..."
```

PowerShell:

```powershell
$env:TF_VAR_cloudflare_api_token="..."
```

3. Apply:

```bash
terraform init
terraform plan
terraform apply
```

4. Clear token env var when done:

```powershell
Remove-Item Env:TF_VAR_cloudflare_api_token
```

## Notes

- Cloudflare Free has a limit of 10 Cache Rules per zone. This stack uses 5.
- Never commit API tokens to the repo or store them in tracked `*.tfvars` files.
- If `api.proyekto.tech` already exists (common after import), leave `manage_api_dns_record = false` to avoid record replacement.
- If you set `manage_api_dns_record = true` and `api.proyekto.tech` already exists in Cloudflare DNS, import it before apply:

```bash
terraform import cloudflare_dns_record.api "<zone_id>/<dns_record_id>"
```

- Rollback (temporary cache bypass): set all cache rule actions to `cache = false` or disable the ruleset in dashboard.
