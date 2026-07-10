# Terraform

> **Last updated:** 2026-07-09 · **Status:** current

Terraform in [`infra/`](../../infra/) provisions the **Supabase** project settings and
the **Cloudflare** edge for the API. It deliberately does **not** manage the database
schema (that's Supabase CLI migrations) or auth providers (Supabase dashboard).

> **⚠️ `infra/README.md` is partly stale.** It names dev ref `ftuiloyegcipkupbtias`
> (Mumbai) and prod ref `dlfsqsjzqiuoaekzvhrd` (Sydney) — both superseded by the live
> **Singapore** project `byvbnkpiselvvulsvxgo`. It also lists Terraform-managed
> storage buckets (`project-files`, `avatars`), but storage moved to **Cloudflare
> R2** ([Storage & Media](../08-storage-media/README.md)); treat the bucket sections
> as legacy.

## Layout

```
infra/
  modules/        reusable Supabase Terraform modules
  environments/   dev/ and prod/ configs
  cloudflare/     DNS + cache rules for api.proyekto.tech
  shared/         shared provider config
  scripts/        deploy helpers (e.g. deploy-to-prod.ps1)
```

## What Terraform manages

- **Supabase:** project settings and (legacy) storage bucket provisioning.
- **Cloudflare:** the edge for `api.proyekto.tech` — proxied DNS + cache rules (see
  [cloudflare.md](./cloudflare.md)).

**Not** managed by Terraform: the database schema (Supabase CLI / MCP migrations) and
auth providers (dashboard).

## Applying

```powershell
# Supabase
$env:TF_VAR_supabase_access_token = "…"
$env:TF_VAR_supabase_db_password  = "…"
cd infra/environments/<dev|prod>
terraform init && terraform plan && terraform apply

# Cloudflare edge
cd infra/cloudflare
export TF_VAR_cloudflare_api_token="…"
terraform init && terraform plan && terraform apply
```

Never commit tokens/passwords — pass them as `TF_VAR_*` environment variables.

## Database schema is separate

Schema changes are **not** Terraform — they're Supabase migrations applied with the
CLI or, for the Singapore prod project, the Supabase MCP `apply_migration` (CLI
`db push` fails SASL there). See
[Data → migrations workflow](../07-data-and-db/migrations-workflow.md).

## See also

- [gcp-cloud-run.md](./gcp-cloud-run.md) — the compute side (Cloud Run).
- [cloudflare.md](./cloudflare.md) — the edge/cache config Terraform applies.
