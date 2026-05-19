# Cloudflare Free + Cloud Run Cache-First Runbook

This runbook covers rollout, validation, and rollback for the Cloudflare Free cache-first architecture.

## Architecture

- Origin runtime: Cloud Run (NestJS backend)
- Edge/CDN: Cloudflare Free on `api.proyekto.tech`
- Cache scope: public, cache-safe GET routes only
- Sensitive/auth/session routes: explicit bypass/no-store

## 1. One-time setup

1. Add `proyekto.tech` zone in Cloudflare and complete **Full setup** (registrar nameservers -> Cloudflare nameservers).
2. Configure/apply Terraform in `infra/cloudflare`:
   - Proxied `api.proyekto.tech` DNS record
   - Cache ruleset with the 5 rules defined in this rollout
3. Confirm Cloud Run custom domain mapping already exists for `api.proyekto.tech`.

### Secure token handling (required)

- Set `TF_VAR_cloudflare_api_token` in shell only.
- Do **not** commit token values into repository files.
- Clear env var after apply.

PowerShell example:

```powershell
$env:TF_VAR_cloudflare_api_token="..."
terraform plan -input=false
terraform apply -input=false
Remove-Item Env:TF_VAR_cloudflare_api_token
```

## 2. Backend deploy behavior

- Backend CI deploy now:
  - uses `--no-default-url` (disables public `run.app` URL)
  - smoke-checks `https://api.proyekto.tech/` (or `PUBLIC_API_URL` GitHub variable if set)
- Rollback to re-enable default URL:

```bash
gcloud run services update "$SERVICE_NAME" --region="$REGION" --default-url
```

### Manual deploy prerequisites (local gcloud)

If deploying from local machine (instead of GitHub Actions), ensure:

1. Cloud Build API is enabled:

```bash
gcloud services enable cloudbuild.googleapis.com --project="$PROJECT_ID"
```

2. Build service account has required permissions (project number-based compute SA):

```bash
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILD_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/logging.logWriter"

gcloud storage buckets add-iam-policy-binding "gs://${PROJECT_ID}_cloudbuild" \
  --member="serviceAccount:${BUILD_SA}" \
  --role="roles/storage.objectViewer"
```

## 3. Cache validation checklist

Run these checks after Cloudflare proxy is active:

```bash
# Public endpoint: first request should be MISS/DYNAMIC, next should become HIT
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"

# Public templates endpoint
curl -sI https://api.proyekto.tech/api/roadmaps/templates/public | grep -Ei "cache-control|etag|cf-cache-status"

# Auth/sensitive endpoints should never cache
curl -sI https://api.proyekto.tech/api/auth/profile | grep -Ei "cache-control|cf-cache-status"
curl -sI https://api.proyekto.tech/api/guests/pending/test-session | grep -Ei "cache-control|cf-cache-status"
```

Expected:

- `/api/consultants*` and `/api/roadmaps/templates/public`
  - `Cache-Control: public, ... s-maxage=...`
  - `ETag` present
  - `CF-Cache-Status` can become `HIT`
- Sensitive routes:
  - `Cache-Control: no-store`
  - `CF-Cache-Status` should be `BYPASS` or `DYNAMIC`

## 4. Revalidation check (ETag / 304)

```bash
ETAG=$(curl -sI https://api.proyekto.tech/api/consultants | awk -F': ' '/^ETag:/ {print $2}' | tr -d '\r')
curl -sI https://api.proyekto.tech/api/consultants -H "If-None-Match: $ETAG" | head -n 1
```

Expected: `HTTP/2 304`.

PowerShell tip (important): `curl.exe` can drop ETag quotes if passed directly in `-H`. Use a header file to preserve `W/"..."` exactly.

```powershell
$url = "https://api.proyekto.tech/api/consultants"
$headers = curl.exe -sS -I $url
$etag = ($headers | Select-String -Pattern '^etag:' | Select-Object -First 1).Line -replace '^etag:\s*', ''
$ifNoneMatchFile = Join-Path $env:TEMP 'if_none_match_header.txt'
Set-Content -Path $ifNoneMatchFile -NoNewline -Value "If-None-Match: $etag"
curl.exe -sS -I $url -H "@$ifNoneMatchFile" | Select-String -Pattern '^HTTP/'
```

## 5. Rollback options

1. **Fastest:** set API DNS record to DNS-only (gray cloud) in Cloudflare.
2. Disable/relax cache ruleset (set all matching rules to bypass).
3. Re-enable Cloud Run default URL (`--default-url`) if domain/proxy issue blocks traffic.

## 6. Monitoring

- Cloudflare:
  - Cache hit ratio
  - `CF-Cache-Status` distribution
- Cloud Run:
  - Request count
  - p95 latency
  - Egress trend

Compare 7-day before vs after rollout to verify cost and latency impact.
