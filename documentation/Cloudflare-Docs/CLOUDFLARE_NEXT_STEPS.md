# Cloudflare Cache-First: Next Steps

This checklist is the exact sequence to finish rollout in production.

## 1) Cloudflare Account + Zone

- Ensure `proyekto.tech` is onboarded in Cloudflare.
- Complete **Full setup** at registrar (nameservers -> Cloudflare nameservers).
- Confirm the zone status is active in Cloudflare dashboard.

## 2) Create Cloudflare API Token

Create a token scoped to the `proyekto.tech` zone with:

- `Zone:Read`
- `DNS:Edit`
- `Cache Rules:Edit`

## 3) Apply Cloudflare Terraform

From repo root:

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

- Set `zone_id`
- Keep defaults unless you intentionally changed API host/origin target

Set token and apply:

```bash
export TF_VAR_cloudflare_api_token="YOUR_TOKEN"
terraform init
terraform plan
terraform apply
```

Expected outcome:

- `api.proyekto.tech` proxied (orange cloud)
- 5 cache rules created in correct order

## 4) Configure GitHub Actions Variable

In GitHub repo variables, set:

- `PUBLIC_API_URL = https://api.proyekto.tech`

This is used by backend deploy smoke checks.

## 5) Deploy Backend

Trigger `.github/workflows/backend-deploy.yml` (push to `main` or manual run).

Expected outcome:

- Cloud Run deploy succeeds
- Deploy uses `--no-default-url`
- Smoke check passes against `https://api.proyekto.tech/`

## 6) Validate Cache Behavior

Run:

```bash
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"
curl -sI https://api.proyekto.tech/api/roadmaps/templates/public | grep -Ei "cache-control|etag|cf-cache-status"
curl -sI https://api.proyekto.tech/api/auth/profile | grep -Ei "cache-control|cf-cache-status"
curl -sI https://api.proyekto.tech/api/guests/pending/test-session | grep -Ei "cache-control|cf-cache-status"
```

Expected:

- Public endpoints: `Cache-Control: public ... s-maxage=...`, `ETag`, then `CF-Cache-Status` can become `HIT`
- Sensitive endpoints: `Cache-Control: no-store`, cache status remains `BYPASS`/`DYNAMIC`

## 7) Validate 304 Revalidation

```bash
ETAG=$(curl -sI https://api.proyekto.tech/api/consultants | awk -F': ' '/^ETag:/ {print $2}' | tr -d '\r')
curl -sI https://api.proyekto.tech/api/consultants -H "If-None-Match: $ETAG" | head -n 1
```

Expected:

- `HTTP/2 304`

## 8) Monitor 7 Days

Track:

- Cloudflare cache hit ratio
- Cloud Run request count
- Cloud Run p95 latency
- Cloud Run egress trend

Goal:

- Higher edge hit ratio and lower origin load/cost on public routes.

## 9) Rollback (if needed)

- Re-enable default Cloud Run URL:

```bash
gcloud run services update "$SERVICE_NAME" --region="$REGION" --default-url
```

- Temporarily set `api` DNS to DNS-only (gray cloud), or disable cache rules.

---

For detailed procedures, see: `documentation/CLOUDFLARE_CACHE_FIRST_RUNBOOK.md`.
