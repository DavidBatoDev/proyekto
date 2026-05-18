# Infrastructure

This folder contains Terraform configuration for:

- Supabase infrastructure across environments
- Cloudflare edge/cache setup for the API (`infra/cloudflare`)

## Prerequisites

- Terraform >= 1.5.0
- Supabase CLI installed (`npm install supabase --save-dev`)
- Supabase access token

## Structure

```text
infra/
|- modules/       # Reusable Terraform modules (Supabase)
|- environments/  # Environment-specific configs (dev/prod)
|- cloudflare/    # Cloudflare DNS + cache rules for api.proyekto.tech
|- shared/        # Shared provider configuration
`- scripts/       # Deployment scripts
```

## Supabase Setup

### 1. Get Supabase Access Token

```powershell
# Generate an access token from Supabase dashboard
# Settings > API > Generate new token
```

### 2. Set Environment Variables

```powershell
# Development
$env:TF_VAR_supabase_access_token = "your-access-token"
$env:TF_VAR_supabase_db_password = "your-db-password"
```

### 3. Initialize Terraform

```powershell
cd infra/environments/dev
terraform init
```

### 4. Apply Infrastructure

```powershell
terraform plan
terraform apply
```

## Database Migrations

Database schema is managed via Supabase CLI, not Terraform. This separation allows for better version control and migration management.

### Apply Migrations

```powershell
cd api
npx supabase db push
```

### Create New Migration

```powershell
cd api
npx supabase migration new migration_name
```

## What Terraform Manages (Supabase stack)

- Storage buckets (project-files, avatars)
- Storage bucket policies
- Project settings
- Database schema is **not** managed here (use Supabase CLI migrations)
- Auth providers are **not** managed here (configure via Supabase dashboard)

## Environments

### Development

- Project: `prodigitality-dev-supabase`
- Ref: `ftuiloyegcipkupbtias`
- Region: South Asia (Mumbai)

### Production

- Project: `prodigitality-prod-supabase`
- Ref: `dlfsqsjzqiuoaekzvhrd`
- Region: Oceania (Sydney)

## Notes

- Never commit sensitive values (tokens, passwords) to version control
- Use `TF_VAR_` environment variables for secrets
- Storage bucket policies reference database tables, so apply migrations first
- For Cloudflare rollout instructions, see `infra/cloudflare/README.md`
