# Infrastructure & Deployment

> **Last updated:** 2026-07-09 · **Status:** planned (stub)

Where everything runs and how it ships: the GitHub Actions pipelines, Cloud Run for
backend + agent, Terraform provisioning, and Cloudflare configuration.

## Planned contents

| Doc | What's in it |
| --- | --- |
| `ci-cd.md` | The GitHub Actions workflows (backend, agent, realtime, mobile OTA, Android release) |
| `gcp-cloud-run.md` | Backend + agent on Cloud Run, GCP project identifiers, Workload Identity Federation |
| `terraform.md` | Terraform-managed provisioning and the DB migrations workflow |
| `cloudflare.md` | Cache-first setup, zone/token configuration, edge purge |

_Scaffolded during the docs revamp; content lands in a later phase. See the
[docs index](../README.md) for build order._
