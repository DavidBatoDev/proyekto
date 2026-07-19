# realtime/ - Cloudflare Worker + Durable Objects

Local context for the realtime unit. Cross-cutting rules live in the root CLAUDE.md.

## Status: shipped DORMANT

This worker is deployed but inactive behind transport flags (backend/agent enable it via REALTIME_WORKER_URL and related gates). Code changes here do not affect prod behavior until the flags flip - but keep typecheck and tests green anyway; activation should never be blocked by rot.

## Commands (run from realtime/)

- npm run typecheck - tsc --noEmit (the primary gate; no lint config here)
- npm test - Vitest with @cloudflare/vitest-pool-workers
- npm run dev - wrangler dev (local vars from .dev.vars)
- NEVER run `npm run deploy` / `wrangler deploy` from a session - deploys go exclusively through .github/workflows/realtime-deploy.yml (permissions deny it).

## Layout and bindings

- src/index.ts - Worker entry: GET /health, GET /ws (WebSocket upgrade), POST /publish (backend fan-out, shared secret x-realtime-token), POST /uploads (multipart -> R2).
- src/room.ts - RealtimeRoom Durable Object (binding ROOMS, SQLite-backed, WebSocket Hibernation API).
- R2 bindings: MEDIA -> proyekto-media, PRIVATE -> proyekto-private. Upload size/MIME limits mirror the backend BUCKET_CONFIG - change both together.
- Secrets (SUPABASE_JWT_SECRET, REALTIME_PUBLISH_TOKEN, SUPABASE_URL) are set once via `wrangler secret put` and persist across deploys.

## Security note

/ws verifies Supabase JWTs via jose - HS256 secret or ES256 JWKS selected by the alg header; user:{id} rooms are self-scoped, everything else authorizes through backend POST /api/realtime/authorize. Changes to this path are security-sensitive - have the security-auditor agent review them.
