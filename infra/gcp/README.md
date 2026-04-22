# GCP Bootstrap — Backend (Cloud Run)

One-time setup for hosting [backend/](../../backend/) on Cloud Run. Run these commands once per GCP project; the GitHub Actions workflow in [.github/workflows/backend-deploy.yml](../../.github/workflows/backend-deploy.yml) handles everything afterward.

## Prerequisites

- `gcloud` CLI authenticated against an account with `roles/owner` or equivalent on the target project.
- Target region chosen (default: `us-central1` — pick the region closest to the Supabase project to minimise DB egress latency).
- GitHub repo slug known (used for OIDC binding). All examples below use `DavidBatoDev/prdigy`.

## Variables used below

```bash
export PROJECT_ID="planar-rarity-494104-n4"
export REGION="us-central1"
export AR_REPO="proyekto"
export SERVICE_NAME="proyekto-backend"
export DEPLOYER_SA="proyekto-deployer"
export RUNTIME_SA="proyekto-backend-sa"
export GH_REPO="DavidBatoDev/prdigy"
export WIF_POOL="github-pool"
export WIF_PROVIDER="github-provider"

gcloud config set project "$PROJECT_ID"
```

## 1. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudresourcemanager.googleapis.com \
  sts.googleapis.com
```

## 2. Artifact Registry (container images)

```bash
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Proyekto container images"
```

## 3. Service accounts

**Deployer** — used by GitHub Actions to build/push images and deploy revisions:

```bash
gcloud iam service-accounts create "$DEPLOYER_SA" \
  --display-name="Proyekto CI deployer"

DEPLOYER_EMAIL="${DEPLOYER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

for role in roles/run.admin \
            roles/artifactregistry.writer \
            roles/iam.serviceAccountUser \
            roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${DEPLOYER_EMAIL}" \
    --role="$role"
done
```

**Runtime** — the identity Cloud Run runs as (what pulls secrets at cold start):

```bash
gcloud iam service-accounts create "$RUNTIME_SA" \
  --display-name="Proyekto backend runtime"

RUNTIME_EMAIL="${RUNTIME_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

## 4. Workload Identity Federation (GitHub OIDC)

Avoids long-lived JSON keys. GitHub Actions presents an OIDC token; GCP trades it for a short-lived access token scoped to the deployer SA.

```bash
# Create pool
gcloud iam workload-identity-pools create "$WIF_POOL" \
  --location=global \
  --display-name="GitHub Actions pool"

POOL_ID=$(gcloud iam workload-identity-pools describe "$WIF_POOL" \
  --location=global --format='value(name)')

# Create provider (only allow tokens from the target repo)
gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
  --location=global \
  --workload-identity-pool="$WIF_POOL" \
  --display-name="GitHub OIDC" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${GH_REPO}'" \
  --issuer-uri="https://token.actions.githubusercontent.com"

# Allow the GH repo to impersonate the deployer SA
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GH_REPO}"

# Print the provider resource name — you'll need this in GitHub Actions
gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
  --location=global \
  --workload-identity-pool="$WIF_POOL" \
  --format='value(name)'
```

Copy the printed `projects/.../providers/github-provider` value — it's `GCP_WORKLOAD_IDENTITY_PROVIDER`.

## 5. Secret Manager

Create one secret per env var the backend needs. Values map 1:1 to what's currently in Vercel's env config and [backend/src/config/env.validation.ts](../../backend/src/config/env.validation.ts).

```bash
# Required
echo -n "<value>" | gcloud secrets create SUPABASE_URL              --data-file=-
echo -n "<value>" | gcloud secrets create SUPABASE_ANON_KEY         --data-file=-
echo -n "<value>" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=-
echo -n "<value>" | gcloud secrets create CLIENT_URL                --data-file=-
echo -n "<value>" | gcloud secrets create CORS_ORIGINS              --data-file=-

# Upstash (required in prod — throttler falls back to in-memory without them)
echo -n "<value>" | gcloud secrets create UPSTASH_REDIS_REST_URL    --data-file=-
echo -n "<value>" | gcloud secrets create UPSTASH_REDIS_REST_TOKEN  --data-file=-

# Optional
echo -n "<value>" | gcloud secrets create OPENAI_API_KEY            --data-file=-
```

**Rotations:** add a new version with `gcloud secrets versions add <NAME> --data-file=-`. The Cloud Run service mounts `latest`, so new revisions pick up the new version automatically.

## 6. GitHub Actions configuration

In the GitHub repo → **Settings → Secrets and variables → Actions → Variables** (not Secrets — WIF means nothing sensitive leaves GCP):

| Variable | Value |
|---|---|
| `GCP_PROJECT_ID` | `planar-rarity-494104-n4` |
| `GCP_REGION` | `us-central1` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | full resource name printed in step 4 |
| `GCP_DEPLOYER_SA` | `proyekto-deployer@planar-rarity-494104-n4.iam.gserviceaccount.com` |
| `GCP_RUNTIME_SA` | `proyekto-backend-sa@planar-rarity-494104-n4.iam.gserviceaccount.com` |
| `GCP_AR_REPO` | `proyekto` |
| `GCP_SERVICE_NAME` | `proyekto-backend` |

## 7. First deploy

Push to `main` (or trigger the workflow manually from the Actions tab). The workflow builds the image, pushes to Artifact Registry, and deploys to Cloud Run. The service URL is printed in the workflow summary.

## Smoke checks after first deploy

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region="$REGION" --format='value(status.url)')

# Health (unauthenticated; GET / is excluded from the /api prefix in main.ts)
curl -s "$SERVICE_URL/" | jq .

# Env sourced from Secret Manager (no raw values, just references)
gcloud run services describe "$SERVICE_NAME" --region="$REGION" \
  --format='value(spec.template.spec.containers[0].env)'
```

## Free-tier extras (recommended after first deploy)

These are zero-cost and give you baseline operability. Run them once the service is live.

### Uptime check + email alert on 5xx

```bash
# Uptime check: GET / every 5 min from multiple regions
gcloud monitoring uptime create proyekto-backend-uptime \
  --resource-type=uptime-url \
  --resource-labels=host="$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" --format='value(status.url)' | sed 's|https://||')",project_id="$PROJECT_ID" \
  --http-check-path="/" \
  --period=5

# Notification channel (email). Replace <EMAIL>.
gcloud alpha monitoring channels create \
  --display-name="Proyekto on-call" \
  --type=email \
  --channel-labels=email_address=<EMAIL>

# Alert when 5xx rate exceeds threshold (console is easier for the policy JSON;
# command below is the shape — tune thresholds there).
# Metric: run.googleapis.com/request_count filtered by response_code_class="5xx"
```

For the alert policy, the console path is: **Monitoring → Alerting → Create Policy → Metric: Cloud Run Revision → `request_count` with filter `response_code_class = 5xx` → threshold ~1% over 5 min**. Bind the email channel created above.

### Custom domain: `api.proyekto.tech` (Namecheap DNS, managed SSL, free)

Apex `proyekto.tech` is left for the web frontend; the backend goes on the `api.` subdomain because Cloud Run domain mappings rely on a single CNAME (DNS doesn't allow CNAME at the apex).

**Step 1 — Verify the apex domain in Google Search Console**

Cloud Run domain mappings require ownership of `proyekto.tech` to be verified under the same Google account that owns the GCP project.

1. Open https://search.google.com/search-console → **Add property** → Domain → `proyekto.tech` (not URL prefix — use the Domain option so Cloud Run picks it up).
2. Google will display a TXT record string like `google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXX`. Copy it.
3. In Namecheap → **Domain List → proyekto.tech → Manage → Advanced DNS**, add a new record:
   - **Type:** `TXT Record`
   - **Host:** `@`
   - **Value:** the full `google-site-verification=...` string
   - **TTL:** Automatic
4. Back in Search Console → **Verify**. Propagation is usually under 5 min on Namecheap. Re-click Verify until it succeeds.

**Step 2 — Create the Cloud Run domain mapping**

```bash
gcloud run domain-mappings create \
  --service="$SERVICE_NAME" \
  --domain=api.proyekto.tech \
  --region="$REGION"
```

The command prints the DNS record you need to add. For a subdomain it will be a single CNAME pointing to `ghs.googlehosted.com.`.

**Step 3 — Add the CNAME in Namecheap**

In the same Advanced DNS panel:
- **Type:** `CNAME Record`
- **Host:** `api`
- **Value:** `ghs.googlehosted.com.`  (trailing dot is fine; Namecheap strips it)
- **TTL:** Automatic (or 300s if you want faster iteration)

If there's an existing URL Redirect / A record at `api`, delete it first — Namecheap silently ignores CNAMEs that collide with other record types on the same host.

**Step 4 — Wait for the managed cert**

Google provisions a Let's Encrypt–backed cert automatically once DNS resolves. Typical wait: 15–60 min. Check status:

```bash
gcloud run domain-mappings describe \
  --domain=api.proyekto.tech --region="$REGION" \
  --format='value(status.conditions)'

# Ready when CertificateProvisioned = True
curl -I https://api.proyekto.tech/
```

**Step 5 — Update `CORS_ORIGINS` and the web client**

Add the web frontend's production origin(s) to the `CORS_ORIGINS` secret. Bump the secret and redeploy (Cloud Run picks up the new secret version on the next revision, not live):

```bash
# Example: web is served at https://proyekto.tech and https://www.proyekto.tech
echo -n "https://proyekto.tech,https://www.proyekto.tech" | \
  gcloud secrets versions add CORS_ORIGINS --data-file=-

gcloud run services update "$SERVICE_NAME" --region="$REGION"
```

Then update the web client's API base URL to `https://api.proyekto.tech/api` (the `/api` prefix is the NestJS global prefix from [backend/src/main.ts:48-50](../../backend/src/main.ts#L48-L50)).

**What's still left at the apex**

`proyekto.tech` itself is not touched by any of this — point it at your web host (Vercel, Cloud Run web service, wherever the frontend ends up) with whatever A/AAAA records that host gives you. The `api` CNAME and apex records coexist independently.

### Staging service (separate revision, $0 at min=0)

Reuse the same image and secrets but a different service name for pre-cutover validation:

```bash
gcloud run deploy proyekto-backend-staging \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/backend:latest" \
  --region="$REGION" \
  --platform=managed \
  --execution-environment=gen2 \
  --cpu-boost \
  --service-account="$RUNTIME_EMAIL" \
  --allow-unauthenticated \
  --min-instances=0 --max-instances=3 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="$(gcloud run services describe "$SERVICE_NAME" --region="$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -o '[A-Z_]*=projects/[^,]*' | paste -sd, -)"
```

To wire staging into CI, copy [.github/workflows/backend-deploy.yml](../../.github/workflows/backend-deploy.yml) as `backend-deploy-staging.yml` with `branches: [staging]` and `GCP_SERVICE_NAME: proyekto-backend-staging` — or add a matrix input.

## Rollback

```bash
# List revisions
gcloud run revisions list --service="$SERVICE_NAME" --region="$REGION"

# Send 100% traffic to a previous revision
gcloud run services update-traffic "$SERVICE_NAME" \
  --region="$REGION" \
  --to-revisions=<previous-revision-name>=100
```

If the issue is platform-wide rather than a bad revision, flip the web client's API base URL back to the Vercel deployment (which stays live until Phase 3 cleanup per the migration plan).
