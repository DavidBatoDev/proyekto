# Environment Variables

> **Last updated:** 2026-07-09 · **Status:** current

A cross-service map of the environment variables each unit needs. The **full,
authoritative reference per service** lives in that service's docs (linked below) —
this page is the orientation: which service reads what, and where the values come from
in production.

> Each unit has its own `.env.example` — copy it to `.env` and fill in. In
> production, backend/agent secrets come from **GCP Secret Manager** (injected at
> deploy), web `VITE_*` come from `web/.env.production`, and the realtime Worker's
> secrets are set with `wrangler secret put`.

## Backend (`backend/.env`)

Validated at boot by `validateEnv`. Categories:

| Group | Vars |
| --- | --- |
| Supabase (required) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` |
| R2 (required) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL` |
| Redis | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `REDIS_*` tuning |
| Email (required) | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` |
| AI | `OPENAI_API_KEY` |
| Server/CORS | `PORT`, `NODE_ENV`, `CORS_ORIGINS`, `CLIENT_URL`, `PUBLIC_API_URL` |
| Optional/gated | `CLOUDFLARE_*`, `REALTIME_*`, `FIREBASE_*`, `OTA_PUBLISH_TOKEN`, `MEETINGS_CRON_SECRET`, `JITSI_BASE_URL` |

Full table: [Backend → configuration](../03-backend/configuration.md#environment-variables).

## Agent (`agent/.env`)

| Group | Vars |
| --- | --- |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL_V2`, `OPENAI_V2_*` |
| v2 loop | `AGENT_V2_MAX_TURNS`, `AGENT_V2_MAX_TOOL_CALLS`, `AGENT_ASYNC_AUTO_COMMIT_ENABLED` |
| Backend link | `NEST_API_BASE_URL`, `NEST_TIMEOUT_SECONDS` |
| Redis / sessions | `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SESSION_TTL_SECONDS`, `REDIS_SESSION_KEY_PREFIX` |
| Summarizer | `AGENT_SUMMARY_MODEL`, `AGENT_SUMMARY_TRIGGER_MESSAGES`, `_KEEP_MESSAGES`, `_MAX_CHARS` |
| Realtime (optional) | `REALTIME_WORKER_URL`, `REALTIME_PUBLISH_TOKEN`, `AGENT_REALTIME_TRACE_PUSH_ENABLED` |

Full table: [Agent → setup & deploy](../05-agent-ai/setup-and-deploy.md#configuration).

## Web (`web/.env`) — public `VITE_*` only

| Var | Points at |
| --- | --- |
| `VITE_API_URL` | Backend (`http://localhost:3001` locally, `https://api.proyekto.tech` prod) |
| `VITE_AGENT_API_URL` | Agent (`http://localhost:8010` / the agent run.app URL) |
| `VITE_REALTIME_URL` | Realtime Worker (unset → falls back to Supabase Realtime) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase (client-side, RLS-bound) |
| `VITE_UPLOAD_WORKER_URL` | R2 upload Worker |

Only public values — no secrets. See [Web → state & services](../04-web/README.md).

## Realtime Worker (secrets via `wrangler secret put`)

`SUPABASE_JWT_SECRET`, `SUPABASE_URL` (JWKS), `REALTIME_PUBLISH_TOKEN`. Vars
(`BACKEND_AUTHORIZE_URL`, `ALLOWED_ORIGINS`, `R2_PUBLIC_BASE_URL`) are in
`wrangler.toml`. See [Realtime](../06-realtime/README.md).

## Edge functions (Supabase)

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — see the
[Google OAuth email runbook](../12-runbooks/google-oauth-email.md).

## Where values live in production

| Unit | Source |
| --- | --- |
| Backend / agent | GCP **Secret Manager** (`--set-secrets`) + plain `--set-env-vars` |
| Web | `web/.env.production` (baked into the Vite build) |
| Realtime | `wrangler secret put` + `wrangler.toml` vars |
| Edge functions | Supabase project secrets |

See [Architecture → deploy topology](../02-architecture/deploy-topology.md).
