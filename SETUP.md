# Proyekto Work Hub - Infrastructure Setup Guide

Complete setup guide for the Supabase + Express.js infrastructure.

## ðŸŽ¯ Overview

- **Database & Auth**: Supabase (RLS-based multi-tenant)
- **Backend**: Express.js (Vercel serverless â†’ Cloud Run)
- **Frontend**: React + Vite + TanStack
- **Infrastructure**: Terraform (storage buckets, policies)
- **Migrations**: Supabase CLI (version-controlled SQL)

## ðŸ“‹ Prerequisites

- Node.js >= 20.16.0
- Terraform >= 1.5.0
- Supabase account with 2 projects:
  - `prodigitality-dev-supabase` (ftuiloyegcipkupbtias)
  - `prodigitality-prod-supabase` (dlfsqsjzqiuoaekzvhrd)

## ðŸš€ Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd proyekto

# Install API dependencies
cd api
npm install

# Install Web dependencies
cd ../web
npm install
```

### 2. Setup Supabase CLI

```bash
cd api

# Login to Supabase
npx supabase login

# Link to dev project
npx supabase link --project-ref ftuiloyegcipkupbtias
```

### 3. Apply Database Migrations

```bash
# From api/ directory
npm run db:push
```

This creates:

- âœ… All database tables (profiles, projects, work_items, etc.)
- âœ… All RLS policies
- âœ… Indexes and triggers

### 4. Get Supabase Credentials

Go to [Supabase Dashboard](https://supabase.com/dashboard/project/ftuiloyegcipkupbtias/settings/api):

- Copy **Project URL** â†’ `SUPABASE_URL`
- Copy **anon public** key â†’ `SUPABASE_ANON_KEY`
- Copy **service_role** key â†’ `SUPABASE_SERVICE_ROLE_KEY`

### 5. Configure API Environment

```bash
cd api
cp .env.example .env
```

Edit `api/.env`:

```env
SUPABASE_URL=https://ftuiloyegcipkupbtias.supabase.co
SUPABASE_ANON_KEY=eyJ... (your anon key)
SUPABASE_SERVICE_ROLE_KEY=eyJ... (your service role key)
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:5173
```

### 6. Configure Web Environment

```bash
cd ../web
cp .env.example .env
```

Edit `web/.env`:

```env
VITE_SUPABASE_URL=https://ftuiloyegcipkupbtias.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ... (your anon key)
VITE_API_URL=http://localhost:3000
```

### 7. Run Development Servers

```bash
# Terminal 1: API server
cd api
npm run dev

# Terminal 2: Web server
cd web
npm run dev
```

## ðŸ—ï¸ Terraform Setup (Optional - Storage Buckets)

### 1. Get Supabase Access Token

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/account/tokens)
2. Generate new access token
3. Copy the token

### 2. Set Environment Variables

```powershell
# PowerShell
$env:TF_VAR_supabase_access_token = "sbp_..."
$env:TF_VAR_supabase_db_password = "your-db-password"
```

### 3. Initialize Terraform

```bash
cd infra/environments/dev
terraform init
```

### 4. Apply Infrastructure

```bash
terraform plan
terraform apply
```

This creates:

- âœ… `project-files` storage bucket (private)
- âœ… `avatars` storage bucket (public)
- âœ… Storage bucket policies

## ðŸ“Š Database Schema

### Core Tables

| Table                 | Description                                  |
| --------------------- | -------------------------------------------- |
| `profiles`            | User profiles with persona flags             |
| `projects`            | Project containers                           |
| `project_members`     | Team membership + permissions                |
| `work_items`          | Tasks, deliverables, bugs                    |
| `milestones`          | Project milestones                           |
| `payment_checkpoints` | Payment ledger (pending/completed)           |
| `meetings`            | Scheduled meetings                           |
| `chat_messages`       | Real-time chat (all-hands, dev-team, direct) |
| `files`               | File metadata + storage paths                |

### RLS Policy Summary

- **Profiles**: Self + project teammates
- **Projects**: Project members only
- **Work Items**: Members (filtered by `is_client_visible`)
- **Chat**: Channel-based (dev-team excludes client)
- **Payments**: Members read, Consultant/Admin write

## ðŸ”‘ Authentication Flow

### 1. User Registration (Supabase Auth)

```typescript
// Frontend
const { data, error } = await supabase.auth.signUp({
  email: "user@example.com",
  password: "password",
});
```

### 2. Onboarding (Set Initial Persona)

```typescript
// POST /api/auth/onboarding
const response = await fetch("/api/auth/onboarding", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    active_persona: "client", // or 'freelancer'
    display_name: "John Doe",
  }),
});
```

### 3. Switch Persona

```typescript
// PATCH /api/auth/persona
const response = await fetch("/api/auth/persona", {
  method: "PATCH",
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    active_persona: "consultant", // requires verification
  }),
});
```

## ðŸ§ª Testing the Setup

### 1. Test Auth Endpoint

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","timestamp":"..."}`

### 2. Create Test User via Supabase Dashboard

1. Go to Authentication > Users
2. Add user manually
3. Copy UID

### 3. Test API with Supabase JWT

```bash
# Get JWT from Supabase dashboard or login flow
curl -H "Authorization: Bearer <jwt>" \
  http://localhost:3000/api/users/me
```

## ðŸ“ Project Structure

```
proyekto/
â”œâ”€â”€ api/                    # Express.js backend
â”‚   â”œâ”€â”€ src/
â”‚   â”‚   â”œâ”€â”€ app.js         # Express app
â”‚   â”‚   â”œâ”€â”€ index.js       # Cloud Run entry
â”‚   â”‚   â”œâ”€â”€ lib/           # Supabase clients
â”‚   â”‚   â”œâ”€â”€ middleware/    # Auth middleware
â”‚   â”‚   â””â”€â”€ routes/        # API routes
â”‚   â”œâ”€â”€ api/
â”‚   â”‚   â””â”€â”€ index.js       # Vercel serverless entry
â”‚   â”œâ”€â”€ supabase/
â”‚   â”‚   â”œâ”€â”€ config.toml
â”‚   â”‚   â””â”€â”€ migrations/    # SQL migrations
â”‚   â””â”€â”€ vercel.json
â”œâ”€â”€ web/                    # React frontend
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ lib/
â”‚       â”‚   â””â”€â”€ supabase.ts
â”‚       â””â”€â”€ routes/
â”œâ”€â”€ infra/                  # Terraform IaC
â”‚   â”œâ”€â”€ modules/           # Reusable modules
â”‚   â”œâ”€â”€ environments/      # Dev/Prod configs
â”‚   â””â”€â”€ shared/            # Provider config
â””â”€â”€ documentation/          # Project docs
```

## ðŸš¢ Deployment

### Vercel (Current)

```bash
cd api
vercel --prod
```

Environment variables in Vercel dashboard:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CLIENT_URL`

### Cloud Run (Future)

1. Build:

```bash
docker build -t gcr.io/<project-id>/prodigi-api .
```

2. Push:

```bash
docker push gcr.io/<project-id>/prodigi-api
```

3. Deploy:

```bash
gcloud run deploy prodigi-api \
  --image gcr.io/<project-id>/prodigi-api \
  --platform managed \
  --region us-central1
```

## ðŸ”§ Common Tasks

### Add New Migration

```bash
cd api
npm run db:migration add_new_field
# Edit supabase/migrations/<timestamp>_add_new_field.sql
npm run db:push
```

### Reset Database (Dev Only)

```bash
npm run db:reset
```

### Switch to Prod Environment

```bash
# Link to prod project
npx supabase link --project-ref dlfsqsjzqiuoaekzvhrd

# Apply migrations
npm run db:push
```

## ðŸ“ž Support

- [Supabase Docs](https://supabase.com/docs)
- [Express.js Docs](https://expressjs.com/)
- [Terraform Supabase Provider](https://registry.terraform.io/providers/supabase/supabase/latest/docs)


