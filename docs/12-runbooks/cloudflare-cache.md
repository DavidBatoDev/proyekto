# Runbook: Cloudflare Cache

> **Last updated:** 2026-07-09 · **Status:** current

The operational runbook for the **cache-first** API edge: rollout, validating that
public routes cache and sensitive routes don't, edge-purge consistency, and
rollback/kill-switches. For the architecture and one-time provisioning, see
[Infra → Cloudflare](../10-infra-deploy/cloudflare.md).

> The design: Cloudflare Free fronts `api.proyekto.tech`; public cache-safe GETs get
> `s-maxage` + `ETag`, sensitive routes get `no-store`; a Redis cache-aside layer plus
> best-effort Cloudflare URL purge on public mutations keeps it consistent.

## Validate caching

After the Cloudflare proxy is active:

```bash
# public: first MISS/DYNAMIC, second HIT
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"
curl -sI https://api.proyekto.tech/api/consultants | grep -Ei "cache-control|etag|cf-cache-status"
curl -sI https://api.proyekto.tech/api/roadmaps/templates/public | grep -Ei "cache-control|etag|cf-cache-status"
# sensitive: never cache
curl -sI https://api.proyekto.tech/api/auth/profile | grep -Ei "cache-control|cf-cache-status"
```

Expected: public routes → `Cache-Control: public … s-maxage=…`, `ETag`, then
`CF-Cache-Status: HIT`; sensitive routes → `Cache-Control: no-store`, `BYPASS`/`DYNAMIC`.

## Validate 304 revalidation

```bash
ETAG=$(curl -sI https://api.proyekto.tech/api/consultants | awk -F': ' '/^ETag:/{print $2}' | tr -d '\r')
curl -sI https://api.proyekto.tech/api/consultants -H "If-None-Match: $ETAG" | head -n1   # -> HTTP/2 304
```

> **PowerShell gotcha:** `curl.exe` can drop the `W/"…"` ETag quotes when the header
> is passed inline. Write `If-None-Match: <etag>` to a header file and pass it as
> `-H "@file"` to preserve it exactly.

## Mutation consistency (edge purge)

After a write to a public resource (consultant update, consultant approval, roadmap
template change): call the read endpoint immediately, verify the new state, and — with
`REDIS_CACHE_DEBUG_HEADERS=true` — watch the `X-App-Cache` MISS→HIT transition. In
Cloud Run logs, look for `cache_invalidate …` and `edge_purge status=success …`.

## Monitoring

- **Cloudflare:** cache hit ratio, `CF-Cache-Status` distribution.
- **Cloud Run logs:** `cache_outcome status=HIT|MISS|BYPASS|ERROR`,
  `edge_purge status=success|failed|misconfigured|disabled`.
- **Alerts:** cache error rate spike (>2% for 5 min), sustained edge-purge failures
  (>5 in 5 min), sudden hit-rate drop.

## Kill switches & rollback

| Action | How |
| --- | --- |
| Disable Redis data cache | `REDIS_DATA_CACHE_ENABLED=false` + redeploy |
| Disable edge purge | `CLOUDFLARE_PURGE_ENABLED=false` + redeploy |
| Fastest edge rollback | Set `api` DNS to DNS-only (gray cloud) |
| Relax caching | Set matching cache rules to bypass |
| Restore origin URL | `gcloud run services update <svc> --region=<r> --default-url` |

## Code locations

- **Backend cache:** [`backend/src/common/cache/`](../../backend/src/common/cache/) (`redis-data-cache`, `cloudflare-cache-purge`, `cache-policy`)
- **Env:** `CLOUDFLARE_*`, `CACHE_*`, `REDIS_CACHE_*` — see [Backend → configuration](../03-backend/configuration.md)
- **Provisioning:** [Infra → Cloudflare](../10-infra-deploy/cloudflare.md)
