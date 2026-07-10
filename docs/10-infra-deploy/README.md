# Infrastructure & Deployment

> **Last updated:** 2026-07-09 · **Status:** current

Where everything runs and how it ships: GitHub Actions pipelines, Cloud Run for the
backend + agent, Terraform for provisioning, and Cloudflare for the API edge. Each
deployable unit deploys independently from its own workflow.

> If you only read one page, read [ci-cd.md](./ci-cd.md). For the full hosting map,
> see [Architecture → deploy topology](../02-architecture/deploy-topology.md).

## Documentation index

| Doc | What's in it |
| --- | --- |
| [ci-cd.md](./ci-cd.md) | The GitHub Actions workflows — triggers, targets, keyless auth |
| [gcp-cloud-run.md](./gcp-cloud-run.md) | Backend + agent on Cloud Run, GCP coordinates, WIF, secrets |
| [terraform.md](./terraform.md) | Terraform-managed Supabase + Cloudflare provisioning |
| [cloudflare.md](./cloudflare.md) | The cache-first API edge, rollout, validation, rollback |

## Glossary

| Term | Meaning |
| --- | --- |
| **Workload Identity Federation** | Keyless GCP auth — GitHub OIDC token exchanged for GCP credentials, no SA keys. |
| **Artifact Registry** | GCP Docker image registry (`proyekto` repo). |
| **`--no-default-url`** | Cloud Run flag — the service is served only via its custom domain. |
| **Cache-first** | Public GETs edge-cached at Cloudflare; the backend purges on writes. |
| **Gate variable** | A repo variable (e.g. `OTA_PUBLISH_ENABLED`) that turns a ship-dark integration on. |

## Code locations

- **Workflows:** [`.github/workflows/`](../../.github/workflows/)
- **Terraform:** [`infra/`](../../infra/)
- **Container builds:** [`backend/Dockerfile`](../../backend/Dockerfile), [`agent/Dockerfile`](../../agent/Dockerfile)
- **Worker:** [`realtime/wrangler.toml`](../../realtime/wrangler.toml)
