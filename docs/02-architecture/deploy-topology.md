# Deploy Topology

> **Last updated:** 2026-08-04 · **Status:** current

Where every unit runs, how it ships, and what it needs at runtime. The short
version: **backend and agent are Docker images on Google Cloud Run**, **web is a
static-assets Cloudflare Worker**, **realtime is a Cloudflare Worker**, and
**Supabase** (Singapore) is the managed database. Each service deploys
independently from its own GitHub Actions workflow, triggered by pushes to its
folder.

> **Note — no Vercel anywhere:** web moved off Vercel to Cloudflare Workers static
> assets on **2026-08-04**, and the Vercel project was **deleted**. The backend was
> never on Vercel either: it ships to **Cloud Run** (Docker image, container entry
> `backend/src/server.ts`). There is no `backend/vercel.json`, and
> `backend/src/lambda.ts` is an orphaned serverless adapter — present but
> built/deployed by nothing.

## Hosting map

```
  +--------------------- Google Cloud Run -----------------------+
  |  backend  (Docker, node:22)  api.proyekto.tech               |  .github/workflows/backend-deploy.yml
  |  agent    (Docker, py3.12)   proyekto-agent-...as.a.run.app  |  .github/workflows/agent-deploy.yml
  +--------------------------------------------------------------+  region asia-southeast1 (Singapore)

  +------------------------- Cloudflare -------------------------+
  |  web       proyekto-web (static assets)   www.proyekto.tech  |  .github/workflows/web-deploy.yml
  |  realtime  proyekto-realtime...workers.dev  (Worker + DO)    |  .github/workflows/realtime-deploy.yml
  |  R2        proyekto-media (cdn.proyekto.tech) + proyekto-private
  |  edge      cache/DNS for api.proyekto.tech (infra/cloudflare)|
  |  redirect  proyekto.tech -> www.proyekto.tech (308 ruleset)  |  infra/cloudflare/main.tf
  +--------------------------------------------------------------+

  +---------------------- Supabase (managed) --------------------+
  |  Postgres 15  ref byvbnkpiselvvulsvxgo  region Singapore     |  migrations via CLI / MCP
  |  Auth (JWT)  - no edge functions                             |
  +--------------------------------------------------------------+
```

## Per-unit deploy

| Unit | Target | Trigger | Domain / URL |
| --- | --- | --- | --- |
| web | Cloudflare Workers (static assets) | push to `main` on `web/**` | `www.proyekto.tech` (apex 308→www) |
| backend | Cloud Run (Docker) | push to `main` on `backend/**` | `api.proyekto.tech` |
| agent | Cloud Run (Docker) | push to `main` on `agent/**` | `…-as.a.run.app` (internal) |
| realtime | Cloudflare Workers | push to `main` on `realtime/**` | `proyekto-realtime.…workers.dev` |
| supabase | Supabase (managed) | `supabase db push` / MCP `apply_migration` | ref `byvbnkpiselvvulsvxgo` |
| mobile (Android) | GitHub Releases | tag `v*.*.*` | signed APK + AAB |
| mobile (OTA) | R2 + backend registry | push to `main` on `web/**` (gated) | `mobile-updates` bundles |

### Backend — Cloud Run

Two-stage `node:22-alpine` Docker build (`backend/Dockerfile`); container starts
`node dist/server` → tracing → `NestFactory` listening on `PORT` (8080 in-container),
global prefix `/api` (excluding `/`, `/mcp`, `/oauth/*`, and `/.well-known/*`).
Deployed by `.github/workflows/backend-deploy.yml` with
`gcloud run deploy`, authenticated via **Workload Identity Federation** (no keys).

- **GCP coordinates** (CI reads these from repo variables — `GCP_PROJECT_ID`,
  `GCP_REGION`, `GCP_AR_REPO`, `GCP_SERVICE_NAME`, etc.): project
  `planar-rarity-494104-n4`, region **`asia-southeast1`**, Artifact Registry repo
  `proyekto`, service `proyekto-backend`.
- **Runtime flags:** `--memory=1Gi --cpu=1 --min-instances=0 --max-instances=20`
  `--concurrency=20 --timeout=300 --cpu-boost --execution-environment=gen2`
  `--allow-unauthenticated --no-default-url` (served via the custom domain).
- **Config source:** plain values via `--set-env-vars`; sensitive values via
  `--set-secrets` from **Secret Manager** (`SUPABASE_*`, `UPSTASH_REDIS_*`,
  `OPENAI_API_KEY`, `GMAIL_*`, `R2_*`, etc.). Several integrations are added to the
  deploy only when a gate repo-variable is set — Cloudflare purge, the realtime
  Worker, FCM push, OTA publishing, the meetings reminder cron, the MCP server
  (`MCP_ENABLED`), and the MCP OAuth authorization server (`MCP_OAUTH_ENABLED`,
  which also pulls in the `MCP_OAUTH_JWT_SECRET` secret). See
  [Backend → MCP](../03-backend/mcp.md#config--deploy).

### Agent — Cloud Run

`python:3.12-slim` image (`agent/Dockerfile`), built from the **repo root** context
so it can copy `schemas/` alongside `agent/app`. Starts
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Deployed by `agent-deploy.yml`
(same WIF auth), smaller footprint: `--max-instances=3 --concurrency=10`.

- **Backend link:** `NEST_API_BASE_URL=https://api.proyekto.tech/api` — the agent
  calls back into the backend for roadmap context and commits.
- **Secrets:** `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- The live agent URL carries an `-as` suffix (`…-as.a.run.app`), confirming the
  `asia-southeast1` (Singapore) region.

### Realtime — Cloudflare Worker

Deployed by `realtime-deploy.yml` via `wrangler-action` (typecheck gates the deploy).
Config in `realtime/wrangler.toml`:

- Worker `proyekto-realtime`, `compatibility_date = 2025-06-01`, entry `src/index.ts`.
- **Durable Object** binding `ROOMS` → class `RealtimeRoom` (SQLite-backed, one
  instance per room key).
- **R2 bindings:** `MEDIA` → `proyekto-media`, `PRIVATE` → `proyekto-private`.
- **Vars:** `BACKEND_AUTHORIZE_URL=https://api.proyekto.tech/api/realtime/authorize`,
  `R2_PUBLIC_BASE_URL=https://cdn.proyekto.tech`, allowed origins.
- **Secrets** (via `wrangler secret put`, not in the toml): `SUPABASE_JWT_SECRET`,
  `SUPABASE_URL` (JWKS), `REALTIME_PUBLISH_TOKEN`.
- No custom domain declared — served on `proyekto-realtime.…workers.dev`.

### Web — Cloudflare Workers (static assets)

Pure static SPA served by Cloudflare's asset layer. `web/wrangler.toml` declares
**no `main` script** — just `[assets] directory = "./dist"` with
`not_found_handling = "single-page-application"`, which replaces the deleted
`web/vercel.json` SPA rewrite so TanStack Router's client routes survive a hard
refresh. Worker `proyekto-web`, `compatibility_date = 2026-08-04`,
`workers_dev = true`.

- **Deploy:** `.github/workflows/web-deploy.yml` on push to `main` under `web/**`
  (+ manual), `environment: production`, concurrency group `web-deploy-<ref>`.
  Steps: `npm ci` → `npm run build` (`vite build && tsc`, typecheck gates it) →
  `wrangler-action@v3` (pinned `wranglerVersion: 3.114.17`, same pin as
  `realtime-deploy.yml`) → curl smoke test against the workers.dev preview.
- **Custom domain:** `www.proyekto.tech` is bound in the **Cloudflare dashboard**
  (Workers → `proyekto-web` → Domains), *not* via `routes` in `wrangler.toml`, so
  the config file does not name the domain. Verified by deliberate test: a
  `wrangler deploy` with no `routes` does **not** strip the dashboard binding, so
  repeat deploys are safe.
- **Preview URL:** `https://proyekto-web.lucky-mud-7121.workers.dev` (same account
  subdomain as the realtime Worker).
- **Config:** `VITE_*` values are baked into the bundle at **build** time by Vite
  from the committed `web/.env.production` — Cloudflare needs **zero** runtime env
  config, since the Worker only serves files. The build simply moved from Vercel
  to GitHub Actions, reading the same committed file: API origin
  `https://api.proyekto.tech`, Supabase `byvbnkpiselvvulsvxgo`, agent run.app URL,
  realtime Worker URL.

The same `web/` build feeds the mobile pipelines below.

### Supabase + Terraform

- **Database:** Supabase Postgres 15, **live ref `byvbnkpiselvvulsvxgo`, region
  Singapore**. Schema is driven by `supabase/migrations/` (source of truth), applied
  with the Supabase CLI or, for the Singapore prod project, the Supabase MCP
  `apply_migration` (the audited production path; local `db push` is prohibited).
- **Terraform** (`infra/`) provisions Supabase storage buckets (`project-files`,
  `avatars`) + policies, the Cloudflare edge for `api.proyekto.tech`, and the
  apex→www redirect ruleset (`cloudflare_ruleset.apex_redirect`). It does **not**
  manage DB schema or auth providers — and it does **not** manage the
  `www.proyekto.tech` Worker domain binding, which is dashboard-managed.

> **⚠️ Stale infra references:** `infra/README.md` still lists dev ref
> `ftuiloyegcipkupbtias` (Mumbai) and prod ref `dlfsqsjzqiuoaekzvhrd` (Sydney).
> Both are superseded by the live Singapore ref `byvbnkpiselvvulsvxgo`. The old
> Sydney ref also lingers in `infra/deploy-to-prod.ps1`. Note the DB moved to
> Singapore, but **stored files are still on the Mumbai project pending the R2 cutover**.

### Mobile builds

Both are driven off the same `web/` build (`npm run build` + `cap sync`):

- **`android-release.yml`** — on a `v*.*.*` tag (or manual), builds a signed APK +
  AAB and publishes a GitHub Release. Uses release-keystore secrets.
- **`mobile-ota-deploy.yml`** — on `web/**` pushes, **gated dark** on
  `OTA_PUBLISH_ENABLED`; zips `dist`, uploads to R2, and registers the bundle via
  `/api/mobile-updates/bundles` for Android + iOS. See [Mobile](../09-mobile/README.md).

## Domains

| Host | Serves | Where |
| --- | --- | --- |
| `www.proyekto.tech` | Web SPA | Cloudflare Worker `proyekto-web` (dashboard-bound domain) |
| `proyekto.tech` (apex) | 308 redirect → `www`, path + query preserved | Cloudflare dynamic-redirect ruleset (`infra/cloudflare`) |
| `api.proyekto.tech` | Backend API | Cloud Run + Cloudflare edge |
| `cdn.proyekto.tech` | Public media | R2 (`proyekto-media`) |
| `proyekto-realtime.…workers.dev` | Realtime WebSocket | Cloudflare Workers |
| `…-as.a.run.app` | Agent (called by web + backend) | Cloud Run |

## See also

- [cross-service-flows.md](./cross-service-flows.md) — how requests move across these.
- [Infrastructure & Deployment](../10-infra-deploy/README.md) — CI/CD, Cloud Run, Terraform, Cloudflare in depth.
- [Storage & Media](../08-storage-media/README.md) — the R2 model and the Supabase→R2 migration.
