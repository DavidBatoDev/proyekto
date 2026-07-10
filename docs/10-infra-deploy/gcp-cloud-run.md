# GCP & Cloud Run

> **Last updated:** 2026-07-09 · **Status:** current

The backend and agent run as Docker containers on **Google Cloud Run** in
`asia-southeast1` (Singapore). Deploys are keyless — GitHub Actions authenticates via
Workload Identity Federation, builds an image into Artifact Registry, and
`gcloud run deploy`s it. Secrets come from **Secret Manager**.

## GCP coordinates

CI reads these from repo variables (`GCP_PROJECT_ID`, `GCP_REGION`, `GCP_AR_REPO`,
`GCP_SERVICE_NAME`, etc.), so they aren't hardcoded in the workflows. The live values:

| Thing | Value |
| --- | --- |
| Project | `planar-rarity-494104-n4` |
| Region | `asia-southeast1` (Singapore) |
| Artifact Registry repo | `proyekto` |
| Backend service | `proyekto-backend` (→ `api.proyekto.tech`) |
| Agent service | the agent Cloud Run service (`…-as.a.run.app`) |
| Service accounts | a deployer SA and a runtime SA (per service) |

> The region moved to Singapore (`asia-southeast1`) from an earlier US region, to sit
> next to the Singapore Supabase database.

## Keyless auth (Workload Identity Federation)

No service-account JSON keys exist. The deploy workflow:

1. Requests a GitHub OIDC token (`permissions: id-token: write`).
2. Exchanges it via `google-github-actions/auth@v2` using
   `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_DEPLOYER_SA`.
3. Builds + pushes the image, then `gcloud run deploy … --service-account=<runtime SA>`.

## Runtime configuration

| | Backend | Agent |
| --- | --- | --- |
| Base image | `node:22-alpine` | `python:3.12-slim` (built from repo root) |
| Port | 8080 | 8080 |
| Memory / CPU | 1Gi / 1 | 1Gi / 1 |
| Max instances / concurrency | 20 / 20 | 3 / 10 |
| URL | `--no-default-url` (custom domain) | default run.app URL |
| Health check | `GET /` → `{"status":"ok"}` | `GET /health` |

Both set `--cpu-boost --execution-environment=gen2 --allow-unauthenticated --timeout=300`.

## Secrets

Sensitive config is injected with `--set-secrets` from **Secret Manager** (never
committed): `SUPABASE_*`, `UPSTASH_REDIS_*`, `OPENAI_API_KEY`, `GMAIL_*`, `R2_*`, plus
the gated ones (`CLOUDFLARE_PURGE_API_TOKEN`, `REALTIME_PUBLISH_TOKEN`,
`MEETINGS_CRON_SECRET`, `OTA_PUBLISH_TOKEN`).

> **Deploy gotcha:** a Cloud Run deploy **full-replaces** the secret set from Secret
> Manager. When you add a new secret, add it unconditionally to the workflow's
> secrets list — the deployer SA can't describe secrets, so a missing entry silently
> drops it from the running service.

## Also on GCP

- **Cloud Scheduler** (`asia-southeast1`) drives the meetings reminder cron by POSTing
  `/api/meetings/cron/reminders` every minute — see
  [Feature Domains → meetings](../11-domains/meetings/reminders.md).
- **Cloud Trace** collects backend tracing (`OTEL_SERVICE_NAME=proyekto-backend`).
- **FCM** push uses keyless ADC (`FIREBASE_USE_ADC`) on the Firebase project
  `tech-proyekto-app` — see [Mobile → push](../09-mobile/README.md).

## See also

- [ci-cd.md](./ci-cd.md) · [terraform.md](./terraform.md) · [cloudflare.md](./cloudflare.md)
- [Architecture → deploy topology](../02-architecture/deploy-topology.md)
