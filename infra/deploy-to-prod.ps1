#!/usr/bin/env pwsh
# Deploy infrastructure to production using Terraform
# This replaces the manual migration deployment approach

param(
    [switch]$PlanOnly = $false,
    [switch]$AutoApprove = $false
)

Write-Host "Proyekto Work Hub - Terraform Production Deployment" -ForegroundColor Cyan
Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-Not (Test-Path "infra/environments/prod")) {
    Write-Host "Error: Run this script from the project root directory" -ForegroundColor Red
    exit 1
}

# Check Terraform is installed
if (-Not (Get-Command terraform -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Terraform is not installed" -ForegroundColor Red
    Write-Host "   Install from: https://www.terraform.io/downloads" -ForegroundColor Yellow
    exit 1
}

# Check environment variables
if (-Not $env:TF_VAR_supabase_access_token) {
    Write-Host "Error: TF_VAR_supabase_access_token not set" -ForegroundColor Red
    Write-Host "   Set it with: `$env:TF_VAR_supabase_access_token = 'your-token'" -ForegroundColor Yellow
    exit 1
}

if (-Not $env:TF_VAR_supabase_db_password) {
    Write-Host "Error: TF_VAR_supabase_db_password not set" -ForegroundColor Red
    Write-Host "   Set it with: `$env:TF_VAR_supabase_db_password = 'your-password'" -ForegroundColor Yellow
    exit 1
}

Set-Location infra/environments/prod

# Initialize if needed
if (-Not (Test-Path ".terraform")) {
    Write-Host "ðŸ”§ Initializing Terraform..." -ForegroundColor Yellow
    terraform init
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Terraform init failed" -ForegroundColor Red
        Set-Location ../../..
        exit 1
    }
}

# Validate configuration
Write-Host ""
Write-Host "âœ… Validating Terraform configuration..." -ForegroundColor Yellow
terraform validate
if ($LASTEXITCODE -ne 0) {
    Write-Host "Terraform validation failed" -ForegroundColor Red
    Set-Location ../../..
    exit 1
}

# Run terraform plan
Write-Host ""
Write-Host "Planning infrastructure changes..." -ForegroundColor Yellow
Write-Host ""

if ($PlanOnly) {
    terraform plan
    Set-Location ../../..
    exit 0
}

terraform plan -out=prod.tfplan

if ($LASTEXITCODE -ne 0) {
    Write-Host "Terraform plan failed" -ForegroundColor Red
    Set-Location ../../..
    exit 1
}

# Confirmation
if (-Not $AutoApprove) {
    Write-Host ""
    Write-Host "âš ï¸  WARNING: You are about to deploy to PRODUCTION!" -ForegroundColor Yellow
    Write-Host "   This will:" -ForegroundColor Yellow
    Write-Host "   â€¢ Create storage buckets" -ForegroundColor White
    Write-Host "   â€¢ Apply database migrations" -ForegroundColor White
    Write-Host "   â€¢ Configure RLS policies" -ForegroundColor White
    Write-Host ""
    $confirmation = Read-Host "Type 'APPLY' to continue"
    
    if ($confirmation -ne "APPLY") {
        Write-Host "Deployment cancelled" -ForegroundColor Red
        Remove-Item prod.tfplan -ErrorAction SilentlyContinue
        Set-Location ../../..
        exit 0
    }
}

# Apply terraform
Write-Host ""
Write-Host "ðŸš€ Applying Terraform plan..." -ForegroundColor Yellow
terraform apply prod.tfplan

if ($LASTEXITCODE -ne 0) {
    Write-Host "Terraform apply failed" -ForegroundColor Red
    Set-Location ../../..
    exit 1
}

# Cleanup
Remove-Item prod.tfplan -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Production deployment complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Verification steps:" -ForegroundColor Cyan
Write-Host "   1. Check storage buckets: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/storage/buckets" -ForegroundColor White
Write-Host "   2. Verify database tables: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/editor" -ForegroundColor White
Write-Host "   3. Check RLS policies: https://supabase.com/dashboard/project/dlfsqsjzqiuoaekzvhrd/auth/policies" -ForegroundColor White
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "   1. Configure production .env files (api/.env.production, web/.env.production)" -ForegroundColor White
Write-Host "   2. Deploy API to Vercel/Cloud Run" -ForegroundColor White
Write-Host "   3. Deploy frontend to Vercel" -ForegroundColor White
Write-Host ""

Set-Location ../../..

