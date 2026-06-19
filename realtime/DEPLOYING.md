# Deploying realtime (Durable Objects) to production

The realtime feature is **three independently-deployable pieces**, and the
cutover is gated by a single web env var — so you can roll it out, and roll it
back, safely.

1. **`realtime/` Worker + Durable Objects** → Cloudflare (runs on the **Free
   plan / $0**; see [UPGRADING.md](./UPGRADING.md) for when to go Paid).
2. **Backend** (NestJS on Cloud Run) → publishes events to the Worker.
3. **Web** → connects clients to the Worker. **Setting `VITE_REALTIME_URL` is
   the actual cutover** (without it, web falls back to Supabase Realtime).

```
Browser ──wss──> Worker ──> Durable Object        (presence/cursors/drag/typing)
   │                 └─ verifies Supabase JWT + calls backend /authorize
Backend ──POST /publish (shared token)──> Worker ──> DO ──> connected clients
```

## Prerequisites

- A **Cloudflare account** (Free is fine — the Worker uses SQLite-backed DOs).
  For CI deploys you'll want an **API token** with "Edit Workers" + the
  **Account ID**.
- The **live production Supabase** URL + JWT secret. The Worker verifies tokens
  with **HS256 *or* ES256/JWKS**, so it works regardless of which signing scheme
  your prod project uses — just provide both `SUPABASE_URL` and
  `SUPABASE_JWT_SECRET`.
- Prod origins: web `https://proyekto.tech`, backend
  `https://api.proyekto.tech`.
- **Land the branch first.** Everything (incl. `realtime/package-lock.json`,
  needed for CI `npm ci`) is on `feat/realtime-durable-objects`. Merge to `main`
  to trigger the deploy workflows, or deploy manually as below.

## Step 1 — Worker (Cloudflare)

Set non-secret prod config (in `wrangler.toml`, e.g. an `[env.production]`
block, or the dashboard):

- `BACKEND_AUTHORIZE_URL = "https://api.proyekto.tech/api/realtime/authorize"`
- `ALLOWED_ORIGINS = "https://proyekto.tech"`
- `SUPABASE_URL = "https://<prod-ref>.supabase.co"`  (used for JWKS)

Set secrets and deploy:

```bash
cd realtime && npm ci
wrangler secret put SUPABASE_JWT_SECRET       # prod project JWT secret
wrangler secret put REALTIME_PUBLISH_TOKEN    # generate: openssl rand -hex 32
npm run deploy
```

Note the deployed URL (e.g. `https://proyekto-realtime.<acct>.workers.dev`).
A custom domain (`realtime.proyekto.tech`) requires the domain on Cloudflare
DNS — yours is on Namecheap, so the `*.workers.dev` URL is the simplest path
(CORS still gates who can connect). Verify:

```bash
curl https://<worker-url>/health   # → ok
```

**CI alternative:** [`.github/workflows/realtime-deploy.yml`](../.github/workflows/realtime-deploy.yml)
deploys on pushes to `main` touching `realtime/**`; it needs repo secrets
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. (Secrets above are still set
once via `wrangler secret put`; they persist across deploys.)

## Step 2 — Backend (Cloud Run)

[`.github/workflows/backend-deploy.yml`](../.github/workflows/backend-deploy.yml)
is already wired and **gated on a repo var** (so it stays dormant until you set
it):

1. Create a **Secret Manager** secret **`REALTIME_PUBLISH_TOKEN`** — the *same*
   value you set on the Worker.
2. Set the GitHub **repo variable `REALTIME_WORKER_URL`** = the deployed Worker
   URL.
3. `SUPABASE_JWT_SECRET` is already a Cloud Run secret.

Push to `main` → the deploy attaches `REALTIME_WORKER_URL` (env) +
`REALTIME_PUBLISH_TOKEN` (secret). After this the backend publishes events to
the Worker — a **no-op until web clients connect via DO**, so it's safe to land
before the web cutover.

## Step 3 — Web (the cutover)

The feature flags are already `"durable-objects"`, gated by
`isRealtimeConfigured()`. Flipping the switch is one env var in your web host's
build config:

- Set **`VITE_REALTIME_URL = https://<worker-url>`** and redeploy web.
- **Leave it unset to stay on Supabase Realtime** — that's the safety valve.

## Recommended order (and why it's safe)

**Worker → Backend → Web.** During the transition the Supabase roadmap/chat
realtime is still intact (the Phase-3 cleanup that removes it is deliberately
deferred), so:

- After Steps 1–2, the backend publishes to the Worker but no clients are on DO
  yet → harmless; web users keep working on Supabase.
- Step 3 is the real cutover. Do it in a low-traffic window.

## Verify in production

- Two browsers on a shared roadmap: presence avatars, smooth cursors, live drag
  preview; open a chat room: message + typing.
- DevTools → Network: a `wss://<worker-url>/ws` connection, and **no**
  `…supabase.co/realtime/v1/websocket` for roadmap/chat.
- `wrangler tail` for live logs; Cloudflare dashboard → your Worker → Metrics
  for DO requests / duration / errors.

## Rollback

**Unset `VITE_REALTIME_URL`** in the web build and redeploy → instant fallback
to Supabase Realtime. No backend or Worker change needed. (Plan/billing changes
are separate — see [UPGRADING.md](./UPGRADING.md).)

## Notes

- **Canary vs all-or-nothing.** The transport flag is build-time, so setting
  `VITE_REALTIME_URL` cuts over **100% of users at once**. For a real percentage
  canary (e.g. 10% first), gate the transport on a per-user bucket instead of a
  constant — small change, ask if you want it.
- **Cost.** Free covers dev/staging/canary and small-team prod; watch the
  Cloudflare DO metrics and upgrade per [UPGRADING.md](./UPGRADING.md) when you
  approach the daily caps.
- **Don't forget** the matching `REALTIME_PUBLISH_TOKEN` on **both** the Worker
  (secret) and the backend (Secret Manager) — they must be identical or
  `/publish` returns 401.
