# 🏗️ Terraform Production Deployment Guide

This guide shows how to use Terraform to deploy your complete infrastructure (database + storage) from dev to production.

## 📋 Prerequisites

- [x] Terraform >= 1.5.0 installed
- [x] Supabase CLI installed (`npm install supabase --save-dev`)
- [x] Supabase CLI logged in (`npx supabase login`)
- [x] Dev environment tested and working
- [ ] Production Supabase credentials ready
- [ ] Terraform access token from Supabase

---

## 🎯 What Terraform Manages

### ✅ Managed by Terraform

- Storage buckets (project-files, avatars)
- Storage bucket policies (RLS)
- Database migrations (via local-exec provisioner)
- Environment-specific configurations

### ℹ️ Not Managed by Terraform

- Supabase projects themselves (created via dashboard)
- Auth providers (configured via dashboard)
- Real-time subscriptions (automatic)

---

## Part 1: Get Required Credentials

### 1. Get Terraform Access Token

1. Go to: https://supabase.com/dashboard/account/tokens
2. Click "Generate new token"
3. Name: `terraform-access`
4. Copy and save the token securely

### 2. Get Production Database Password

1. Go to: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/settings/database
2. Copy the database password (or reset if needed)

### 3. Get Production API Keys

Visit: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/settings/api

Copy:

- **Project URL**: `https://dlfsqsjzqiuoaekzvhrd.supabase.co`
- **Anon public key**
- **Service role key** (secret)

---

## Part 2: Set Environment Variables

```powershell
# Terraform credentials
$env:TF_VAR_supabase_access_token = "your-terraform-access-token"
$env:TF_VAR_supabase_db_password = "your-prod-db-password"

# Optional: Save to persistent profile (careful with secrets!)
# Add to $PROFILE for persistence
```

**Security Note**: Never commit these values. They're sensitive secrets.

---

## Part 3: Initialize Terraform (First Time Only)

### Dev Environment

```powershell
cd infra/environments/dev

# Initialize
terraform init

# Validate configuration
terraform validate

# Format files
terraform fmt -recursive
```

### Prod Environment

```powershell
cd ../prod

# Initialize
terraform init

# Validate
terraform validate
```

---

## Part 4: Deploy to Development (Test First)

```powershell
cd infra/environments/dev

# Preview changes
terraform plan

# Apply infrastructure
terraform apply
```

This will:

1. ✅ Create storage buckets
2. ✅ Apply storage bucket policies
3. ✅ Run database migrations via Supabase CLI

**Verify**:

1. Check Supabase dashboard for storage buckets
2. Verify tables in database editor
3. Check RLS policies are active

---

## Part 5: Deploy to Production

### Option A: Interactive Deployment (Recommended)

```powershell
cd infra/environments/prod

# Preview ALL changes before applying
terraform plan -out=prod.tfplan

# Review the plan carefully
# Look for:
# - Storage buckets to be created
# - Migrations to be applied
# - No unexpected deletions

# Apply the saved plan
terraform apply prod.tfplan
```

### Option B: Auto-approve (Use with caution)

```powershell
cd infra/environments/prod

# Apply without confirmation (dangerous!)
terraform apply -auto-approve
```

---

## Part 6: Verify Production Deployment

### 1. Check Storage Buckets

Visit: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/storage/buckets

Expected:

- ✅ `project-files` bucket (private)
- ✅ `avatars` bucket (public)

### 2. Check Database Tables

Visit: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/editor

Expected tables:

- ✅ profiles
- ✅ projects
- ✅ project_members
- ✅ work_items
- ✅ milestones
- ✅ payment_checkpoints
- ✅ meetings
- ✅ chat_messages
- ✅ files

### 3. Check RLS Policies

Visit: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/auth/policies

Each table should have multiple policies (40+ total).

### 4. Test Storage Bucket Access

```powershell
# Create a test file upload via Supabase dashboard
# Storage > project-files > Upload
# Verify RLS prevents unauthorized access
```

---

## 🔄 Updating Production

When you make changes (new migrations, bucket changes):

```powershell
cd infra/environments/prod

# 1. Pull latest code
git pull origin main

# 2. Preview changes
terraform plan

# 3. Apply changes
terraform apply
```

Terraform will:

- Detect new migration files (via hash change)
- Apply only new migrations
- Update modified resources

---

## 🔍 Managing Terraform State

### Current Setup: Local State

Each environment has its own local state file:

- `infra/environments/dev/terraform.tfstate`
- `infra/environments/prod/terraform.tfstate`

**⚠️ Important**:

- Don't commit `terraform.tfstate` to git
- Back up state files regularly
- Only one person should apply Terraform at a time

### Upgrade to Remote State (Recommended for Teams)

#### Option 1: Terraform Cloud

```hcl
# infra/environments/prod/backend.tf
terraform {
  cloud {
    organization = "your-org"
    workspaces {
      name = "prodigi-prod"
    }
  }
}
```

#### Option 2: S3 Backend

```hcl
# infra/environments/prod/backend.tf
terraform {
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "prodigi/prod/terraform.tfstate"
    region = "us-east-1"
  }
}
```

#### Option 3: Supabase Storage Backend

```hcl
# infra/environments/prod/backend.tf
terraform {
  backend "http" {
    address = "https://your-project.supabase.co/storage/v1/object/terraform-state/prod.tfstate"
    lock_address = "https://your-project.supabase.co/storage/v1/object/terraform-state/prod.tfstate.lock"
  }
}
```

---

## 🎨 Advanced Terraform Commands

### Show Current State

```powershell
terraform show
```

### List All Resources

```powershell
terraform state list
```

### Inspect Specific Resource

```powershell
terraform state show supabase_storage_bucket.project_files
```

### Import Existing Resources

If you created resources manually and want Terraform to manage them:

```powershell
terraform import supabase_storage_bucket.project_files project-files
```

### Refresh State

```powershell
terraform refresh
```

### Target Specific Resources

```powershell
# Apply only storage buckets
terraform apply -target=supabase_storage_bucket.project_files

# Apply only migrations
terraform apply -target=null_resource.apply_migrations
```

---

## 🚨 Rollback & Recovery

### Rollback Last Apply

```powershell
# View previous state versions
terraform state pull

# Manually restore from backup
# Copy terraform.tfstate.backup to terraform.tfstate
```

### Destroy Specific Resources

```powershell
# Destroy storage bucket
terraform destroy -target=supabase_storage_bucket.project_files

# Destroy all resources in environment
terraform destroy
```

### Re-apply Migrations

```powershell
# Taint the migrations resource to force re-run
terraform taint null_resource.apply_migrations

# Apply
terraform apply
```

---

## 📊 Environment Comparison

| Resource            | Dev                  | Prod                 |
| ------------------- | -------------------- | -------------------- |
| **Project Ref**     | ftuiloyegcipkupbtias | dlfsqsjzqiuoaekzvhrd |
| **Region**          | Mumbai               | Sydney               |
| **Storage Buckets** | Same config          | Same config          |
| **Migrations**      | Test first           | Apply after dev      |
| **Terraform State** | Local                | Local (or remote)    |

---

## 🔐 Security Best Practices

### Environment Variables

```powershell
# Never commit these!
$env:TF_VAR_supabase_access_token = "secret"
$env:TF_VAR_supabase_db_password = "secret"
```

### Sensitive Outputs

Mark sensitive values in `outputs.tf`:

```hcl
output "supabase_url" {
  value     = "https://${var.project_ref}.supabase.co"
  sensitive = false  # OK to show
}

output "service_role_key" {
  value     = var.service_role_key
  sensitive = true   # Never show in logs
}
```

### State File Security

- Encrypt state files if using remote backend
- Use RBAC to control who can apply Terraform
- Enable state locking to prevent concurrent modifications

---

## 🐛 Troubleshooting

### "Error: Provider configuration not present"

```powershell
# Re-initialize
terraform init -reconfigure
```

### "Error: Resource already exists"

```powershell
# Import the existing resource
terraform import supabase_storage_bucket.project_files project-files
```

### "Error: Migration failed"

```powershell
# Check Supabase CLI is logged in
npx supabase login

# Manually test migration
cd api
npx supabase link --project-ref dlfsqsjzqiuoaekzvhrd
npx supabase db push
```

### "Error: Access token invalid"

```powershell
# Generate new token
# https://supabase.com/dashboard/account/tokens

# Update environment variable
$env:TF_VAR_supabase_access_token = "new-token"
```

---

## 📝 Terraform Workflow Summary

```powershell
# Standard workflow for production changes:

# 1. Make changes in dev first
cd infra/environments/dev
terraform plan
terraform apply

# 2. Test thoroughly in dev
# Verify in Supabase dashboard

# 3. Apply to production
cd ../prod
terraform plan -out=prod.tfplan
# Review plan carefully
terraform apply prod.tfplan

# 4. Verify production
# Check Supabase dashboard
# Test API endpoints
# Monitor for errors
```

---

## 🎓 Learn More

- [Terraform Supabase Provider Docs](https://registry.terraform.io/providers/supabase/supabase/latest/docs)
- [Terraform Best Practices](https://www.terraform.io/docs/cloud/guides/recommended-practices/index.html)
- [Supabase CLI Reference](https://supabase.com/docs/reference/cli/introduction)
- [Managing Terraform State](https://www.terraform.io/docs/language/state/index.html)

---

## ✅ Deployment Checklist

### Before Deploying to Production

- [ ] All changes tested in dev environment
- [ ] Terraform plan reviewed (no unexpected changes)
- [ ] Environment variables set correctly
- [ ] Supabase CLI logged in
- [ ] Backup of current production state
- [ ] Team notified (if applicable)

### After Deploying to Production

- [ ] Storage buckets created successfully
- [ ] All database tables present
- [ ] RLS policies active
- [ ] Test API health endpoint
- [ ] Test storage bucket access
- [ ] Monitor error logs
- [ ] Update documentation
- [ ] Tag release in git

---

**Last Updated**: 2025-12-11
**Terraform Version**: 1.5.0+
**Provider Version**: supabase ~> 1.0
