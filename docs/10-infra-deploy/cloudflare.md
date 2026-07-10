# Cloudflare

> **Last updated:** 2026-07-09 · **Status:** current

Cloudflare fronts the API with a **cache-first** edge: `api.proyekto.tech` is a
proxied (orange-cloud) hostname with cache rules, so public GETs can serve from the
edge and cut origin load. The backend cooperates by setting `Cache-Control` +
`ETag` and purging the edge on writes. Cloudflare also hosts the realtime Worker and
the R2 buckets (covered elsewhere).

> The cache-first design is a latency/cost optimization: public endpoints get
> `s-maxage` + `ETag` (edge-cacheable, 304-revalidatable); sensitive endpoints get
> `no-store`. The day-to-day operational runbook is in
> [Runbooks → Cloudflare cache](../12-runbooks/README.md).

## What Cloudflare provides

| Piece | For |
| --- | --- |
| Proxied DNS + cache rules for `api.proyekto.tech` | Edge caching of public API GETs (Terraform-managed) |
| `cdn.proyekto.tech` | Public R2 media — see [Storage & Media](../08-storage-media/README.md) |
| `proyekto-realtime` Worker | Realtime — see [Realtime](../06-realtime/README.md) |
| Cache Purge API token | Backend edge-purge on writes |

## Production rollout (one-time)

The sequence to bring the cache-first edge up (from the rollout checklist):

1. **Zone** — onboard `proyekto.tech` in Cloudflare; point registrar nameservers at
   Cloudflare; confirm the zone is active.
2. **Tokens** — a Terraform token (`Zone:Read`, `DNS:Edit`, `Cache Rules:Edit`) and a
   least-privilege runtime **purge** token (`Zone:Read`, `Cache Purge:Edit`).
3. **Apply Terraform** — `cd infra/cloudflare`, set `zone_id` in `terraform.tfvars`,
   `terraform apply`. Outcome: `api.proyekto.tech` proxied + 5 ordered cache rules.
4. **GitHub variable** — set `PUBLIC_API_URL = https://api.proyekto.tech` (used by
   backend deploy smoke checks).
5. **Deploy backend** — the deploy adds `CLOUDFLARE_PURGE_ENABLED=true`,
   `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_PURGE_TIMEOUT_MS`, and the purge token secret.

## Validating cache behavior

```bash
# public routes: expect Cache-Control: public s-maxage=…, ETag, then CF-Cache-Status: HIT
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"
# sensitive routes: expect no-store, BYPASS/DYNAMIC
curl -sI https://api.proyekto.tech/api/auth/profile | grep -Ei "cache-control|cf-cache-status"
# 304 revalidation
ETAG=$(curl -sI https://api.proyekto.tech/api/consultants | awk -F': ' '/^ETag:/{print $2}' | tr -d '\r')
curl -sI https://api.proyekto.tech/api/consultants -H "If-None-Match: $ETAG" | head -n1   # -> 304
```

## Rollback

- Re-enable the default Cloud Run URL: `gcloud run services update <svc> --region=<r> --default-url`.
- Set `api` DNS to DNS-only (gray cloud) or disable the cache rules.
- Kill edge purge fast: `CLOUDFLARE_PURGE_ENABLED=false` and redeploy.

## See also

- [Runbooks → Cloudflare cache](../12-runbooks/README.md) — the detailed cache-first + purge runbook.
- [terraform.md](./terraform.md) — how the edge is provisioned.
- [Backend → configuration](../03-backend/configuration.md) — the `CLOUDFLARE_*` and `CACHE_*` env vars.
