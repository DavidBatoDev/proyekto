# CI/CD

> **Last updated:** 2026-07-09 · **Status:** current

Each deployable unit ships from its **own GitHub Actions workflow**, triggered by
pushes to that unit's folder on `main`. Backend and agent go to Cloud Run, the
realtime Worker to Cloudflare, and the mobile pipelines produce OTA bundles and
signed Android artifacts. The web app is the exception — it deploys via Vercel's Git
integration, not Actions.

## The workflows

| Workflow | Trigger | Deploys / produces |
| --- | --- | --- |
| `backend-deploy.yml` | push `main` on `backend/**` (+ manual) | Backend Docker image → **Cloud Run** (`api.proyekto.tech`) |
| `agent-deploy.yml` | push `main` on `agent/**` (+ manual) | Agent Docker image → **Cloud Run** |
| `realtime-deploy.yml` | push `main` on `realtime/**` (+ manual) | `proyekto-realtime` → **Cloudflare Workers** |
| `mobile-ota-deploy.yml` | push `main` on `web/**` (gated) | Web bundle → **R2** + backend OTA registry |
| `android-release.yml` | tag `v*.*.*` (+ manual) | Signed **APK + AAB** → GitHub Releases |

(There is **no** web-deploy workflow — Vercel builds from Git directly.)

## Auth model

Cloud Run workflows authenticate to GCP with **Workload Identity Federation** — no
service-account keys. The workflow exchanges the GitHub OIDC token
(`permissions: id-token: write`) for GCP credentials via
`google-github-actions/auth@v2`, using the `GCP_WORKLOAD_IDENTITY_PROVIDER` and
`GCP_DEPLOYER_SA` repo variables. Cloudflare deploys use `CLOUDFLARE_API_TOKEN` +
`CLOUDFLARE_ACCOUNT_ID` secrets. See [gcp-cloud-run.md](./gcp-cloud-run.md).

## Backend & agent (Cloud Run)

Both build a Docker image, push to Artifact Registry, and `gcloud run deploy`:

- **Backend** — `node:22-alpine` image, runtime `--memory=1Gi --cpu=1
  --max-instances=20 --concurrency=20 --allow-unauthenticated --no-default-url`
  (served via the custom domain). Config split: plain values via `--set-env-vars`,
  secrets via `--set-secrets` from **Secret Manager**. Several integrations
  (Cloudflare purge, realtime, FCM, OTA, meetings cron) are added only when their gate
  repo-variable is set.
- **Agent** — `python:3.12-slim` built from the repo root (needs `schemas/`),
  `--max-instances=3 --concurrency=10`.

Each ends with a health check (`GET /` for backend, `GET /health` for agent).

## Realtime (Cloudflare)

`realtime-deploy.yml` runs `npm ci` + `npm run typecheck`, then deploys via
`wrangler-action`. Secrets (`SUPABASE_JWT_SECRET`, `REALTIME_PUBLISH_TOKEN`,
`SUPABASE_URL`) are set out-of-band with `wrangler secret put`, not in the workflow.

## Mobile

- `mobile-ota-deploy.yml` — **gated dark** on `OTA_PUBLISH_ENABLED`; builds the web
  bundle, zips `dist`, presigns to R2, and registers the bundle via
  `/api/mobile-updates/bundles` for Android + iOS. Secret `OTA_PUBLISH_TOKEN`.
- `android-release.yml` — on a `v*.*.*` tag, builds a signed APK + AAB (release
  keystore from secrets) and publishes a GitHub Release.

See [Mobile](../09-mobile/README.md).

## Where each unit runs

For the full hosting picture (domains, regions, runtime flags), see
[Architecture → deploy topology](../02-architecture/deploy-topology.md).

## Code locations

- [`.github/workflows/`](../../.github/workflows/) — all workflows
- [`backend/Dockerfile`](../../backend/Dockerfile), [`agent/Dockerfile`](../../agent/Dockerfile), [`realtime/wrangler.toml`](../../realtime/wrangler.toml)
